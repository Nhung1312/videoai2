import { chromium } from 'playwright-core';
import { injectHtmlRecordingLayout } from '../../src/lib/htmlLessonBridge.ts';
import { gateLessonHtml, BRIDGE_KEY } from './transform.mjs';
import { runnerPrelude } from './runner.mjs';
import { ORIGIN } from './package.mjs';
import { RenderError } from './errors.mjs';

export function buildRunnerHtml(pkg, options = {}) {
  const gated = gateLessonHtml(pkg.html);
  const html = gated.includes('data-videoai2-recording-layout') ? gated : injectHtmlRecordingLayout(gated);
  const prelude = runnerPrelude({ bridgeKey: BRIDGE_KEY, cues: pkg.cues, requiredCueIds: pkg.inspection.cueIds, playbackRate: pkg.manifest.playbackRate, tailMs: options.tailMs ?? 700, settleTimeoutMs: options.settleTimeoutMs ?? 10000 });
  // parse5 normalizes missing head tags, but don't normalize author markup.
  // The supported package is a complete HTML document with a head element.
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new RenderError('package-error', 'HTML cần có thẻ head.');
  return html.replace(/<head(?:\s[^>]*)?>/i, match => match + prelude);
}

export async function openRunner(pkg, runtime, options = {}) {
  const rejected = [];
  const browser = await chromium.launch({
    executablePath: options.chromiumPath,
    headless: options.headless ?? false,
    chromiumSandbox: !options.allowUnsandboxed,
    env: runtime.env,
    proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>' },
    args: ['--kiosk', '--start-fullscreen', '--window-position=0,0', '--window-size=720,1280', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required', '--disable-quic', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-features=MediaRouter'],
  });
  const preparationTimer = setTimeout(() => { void browser.close(); }, options.prepareTimeoutMs ?? 60000);
  try {
    const context = await browser.newContext({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false, bypassCSP: true });
    await context.routeWebSocket('**/*', socket => { rejected.push({ url: socket.url(), kind: 'websocket' }); socket.close(); });
    const html = buildRunnerHtml(pkg, options);
    await context.route('**/*', async route => {
      const request = route.request();
      const url = request.url();
      if (request.method() !== 'GET') { rejected.push({ url, kind: 'method' }); return route.abort('blockedbyclient'); }
      if (url === ORIGIN + '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      const file = pkg.files.get(url);
      if (file) return route.fulfill({ status: 200, contentType: file.contentType, body: file.bytes });
      // No continue(), fetch(), local file server, metadata, CDN or TTS route.
      // Every asset must be in the package before offline rendering starts.
      rejected.push({ url, kind: 'resource' });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('download', download => { void download.cancel(); });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: options.prepareTimeoutMs ?? 60000 });
    if (!options.headless) {
      const session = await context.newCDPSession(page);
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
      await session.detach();
    }
    await page.evaluate(key => window[key].prepare(), BRIDGE_KEY);
    if (rejected.length || pageErrors.length) throw new RenderError('render-error', 'HTML thiếu tài nguyên đã đóng gói hoặc có lỗi JavaScript.', { rejected, pageErrors });
    // One preflight screenshot flushes Chromium's pending compositor paint
    // after fullscreen/viewport changes. It is discarded; video is exclusively
    // recorded by X11/PulseAudio, never by screenshotting DOM frames.
    await page.screenshot({ type: 'png', timeout: 10000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await new Promise(resolve => setTimeout(resolve, 250));
    return { browser, page, rejected, pageErrors, snapshot: () => page.evaluate(key => window[key].snapshot(), BRIDGE_KEY) };
  } catch (error) { await browser.close(); throw error; }
  finally { clearTimeout(preparationTimer); }
}
