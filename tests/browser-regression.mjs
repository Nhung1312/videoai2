// Start Vite, then run with PLAYWRIGHT_MODULE pointing at an installed playwright package.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const server = process.env.START_VITE === '1' ? spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'ignore' }) : undefined;
if (server) {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch('http://127.0.0.1:4173/tests/fixture.html')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) { server.kill(); throw new Error('Vite did not start'); }
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let launchOptions = { headless: true, args: ['--no-sandbox'] };
if (process.env.CHROMIUM_MODULE) {
  const bundledModule = require(process.env.CHROMIUM_MODULE);
  const bundled = bundledModule.default || bundledModule;
  launchOptions = { headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || await bundled.executablePath(), args: [...bundled.args, '--disable-accelerated-2d-canvas'] };
}
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(process.env.REGRESSION_URL || 'http://127.0.0.1:4173/tests/fixture.html');
  await page.waitForFunction(() => window.runTypography && document.querySelector('#preview-10 .mixed-math-text'));
  const typography = await page.evaluate(() => window.runTypography());
  for (let i = 0; i < typography.length; i++) {
    const result = typography[i];
    assert.equal(result.katexErrors, 0, result.name);
    assert.ok(result.height > 0 && result.height <= 160, result.name);
    assert.ok(result.calls.length > 0, result.name);
    for (const call of result.calls) {
      assert.equal(call.baseline, 'alphabetic', result.name);
      assert.ok(Number.isFinite(call.ascent) && Number.isFinite(call.descent), result.name);
      assert.ok(call.x >= -0.01 && call.x + call.width <= result.width + 1, `${result.name}: overflow ${call.text}`);
    }
    for (const font of result.proseFonts) {
      assert.match(font.font, /Segoe UI|Arial|Noto Sans/);
      assert.equal(font.italic, 'normal');
    }
    if ([0, 1, 2, 4, 6, 9].includes(i)) {
      const ys = result.calls.map(c => c.y);
      assert.ok(Math.max(...ys) - Math.min(...ys) < 0.01, `${result.name}: mixed baseline mismatch`);
    }
    console.log(`PASS: ${result.name} — real Canvas metrics / React rendering`);
  }
  const long = typography[7];
  const baselines = [...new Set(long.calls.map(c => c.y.toFixed(3)))].map(Number).sort((a, b) => a - b);
  assert.ok(baselines.length >= 2, 'Long mixed line must wrap');
  for (let i = 1; i < baselines.length; i++) {
    const previous = long.calls.filter(c => Math.abs(c.y - baselines[i - 1]) < 0.01);
    const next = long.calls.filter(c => Math.abs(c.y - baselines[i]) < 0.01);
    assert.ok(baselines[i - 1] + Math.max(...previous.map(c => c.descent)) < baselines[i] - Math.max(...next.map(c => c.ascent)), 'Wrapped lines overlap');
  }
  const stable = await page.evaluate(() => {
    const text = 'I là trung điểm của AB. Ta có $x = 6$ nên kết quả này cần được kiểm tra bằng một dòng khá dài.';
    return [0.1, 0.4, 0.8, 1].map(p => window.drawProgress(text, p));
  });
  assert.ok(stable.every(s => s.height === stable[0].height), 'Layout must stay stable while revealing');
  const firstBaseline = stable[0].calls[0].y;
  assert.ok(stable.every(s => Math.abs(s.calls[0].y - firstBaseline) < 0.01));
  const fallback = await page.evaluate(() => window.drawProgress('I là trung điểm của AB', 1, 520, true));
  assert.ok(fallback.height > 0);
  assert.ok(fallback.calls.every(c => Number.isFinite(c.y) && c.baseline === 'alphabetic'));
  const fallbackY = fallback.calls.map(c => c.y);
  assert.ok(Math.max(...fallbackY) - Math.min(...fallbackY) < 0.01);
  assert.deepEqual(errors, []);
  const screenshot = process.env.REGRESSION_SCREENSHOT;
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
  const exports = [];
  if (process.env.TEST_VIDEO_EXPORT === '1') {
    for (const lessonType of ['geometry', 'algebra']) {
      for (const aspectRatio of ['16:9', '9:16']) {
        const result = await page.evaluate(async ({ lessonType, aspectRatio }) => {
          const { VideoExporter } = await import('/src/lib/videoExporter.ts');
          const lessons = await import('/src/lib/sampleLessons.ts');
          const { AudioEngine } = await import('/src/lib/audioEngine.ts');
          AudioEngine.settings.enabled = false;
          const lesson = lessonType === 'geometry' ? lessons.SAMPLE_GEOMETRY_LESSON : lessons.SAMPLE_ALGEBRA_LESSON;
          const exporter = new VideoExporter();
          let lastProgress;
          // A 2-fps smoke export exercises the original full-length timeline and
          // MP4 pipeline without spending minutes on headless software rasterization.
          const blob = await exporter.exportVideo(lesson, {}, { resolution: '720p', aspectRatio, fps: 2, includeAudio: false, includeSubtitles: false }, p => { lastProgress = p; });
          const video = document.createElement('video');
          const url = URL.createObjectURL(blob); video.src = url;
          await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Exported video could not decode')); });
          const result = { lessonType, aspectRatio, fps: 2, includeAudio: false, mimeType: blob.type, sizeBytes: blob.size, width: video.videoWidth, height: video.videoHeight, duration: video.duration, stage: lastProgress.stage, expectedDuration: VideoExporter.calculateTimelinePlan(lesson).totalDuration };
          URL.revokeObjectURL(url);
          return result;
        }, { lessonType, aspectRatio });
        assert.equal(result.stage, 'completed');
        assert.equal(result.mimeType, 'video/mp4');
        assert.ok(result.sizeBytes > 1000);
        assert.equal(result.width, aspectRatio === '16:9' ? 1280 : 720);
        assert.equal(result.height, aspectRatio === '16:9' ? 720 : 1280);
        assert.ok(Math.abs(result.duration - result.expectedDuration) < 1 / result.fps + 0.01);
        exports.push(result);
        console.log(`PASS: real ${lessonType} MP4 export ${aspectRatio}: ${result.width}×${result.height}, ${result.duration.toFixed(2)}s`);
      }
    }
  }
  fs.writeFileSync(new URL('./browser-results.json', import.meta.url), JSON.stringify({ typography, wrappedBaselines: baselines, stableReveal: 'PASS', fallbackMetrics: 'PASS', exports, browserErrors: errors, apiCalls: 0 }, null, 2));
  console.log('PASS: wrapping, stable baselines during reveal, fallback metrics. Gemini API calls: 0');
} finally {
  await browser.close();
  server?.kill();
}
