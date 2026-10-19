// UI integration only: use cached diagnostic audio, never request Gemini TTS
// or exercise/change the existing screen recording implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from '../render-worker/node_modules/playwright-core/index.mjs';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
let browser;
const html = `<!doctype html><html><head><title>Entry test</title></head><body><p>Bài kiểm tra</p><script>
const narrationScript = { intro: 'Kiểm tra giọng đã lưu.' };
async function cue(id) { await window.onNarrationCue(id); }
async function startAnimation() { await cue('intro'); }
startAnimation();</script></body></html>`;
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
for (let i = 0; i < 8000; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * 2000), 44 + i * 2);

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch('http://127.0.0.1:4173')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Vite must start');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true });
  let apiCalls = 0;
  await context.route('**/api/tts', route => { apiCalls++; return route.abort(); });
  const errors = [];
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/?entry-test=keep');
  await page.getByRole('button', { name: 'HTML + Kore', exact: true }).click();
  const entry = page.getByRole('button', { name: 'Xuất video 9:16', exact: true });
  const manual = page.getByRole('button', { name: 'Tải HTML + Kore để quay thủ công', exact: true });
  assert.ok(await entry.isDisabled()); assert.ok(await manual.isDisabled());
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'lesson-test.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await page.getByText('Đã nhận 1 cue lời đọc.', { exact: true }).waitFor();
  assert.ok(await entry.isEnabled()); assert.ok(await manual.isEnabled());

  await page.evaluate(() => {
    window.__open = window.open; window.__set = Storage.prototype.setItem;
    window.__openCalls = 0; window.open = () => { window.__openCalls++; return null; };
    Storage.prototype.setItem = () => { throw new DOMException('Test storage full', 'QuotaExceededError'); };
  });
  await entry.click(); await page.getByText('Test storage full', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__openCalls), 0);
  await page.evaluate(() => { Storage.prototype.setItem = window.__set; });
  await entry.click(); await page.getByText(/Trình duyệt đã chặn tab xuất video/).waitFor();
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('videoai2-html-export:')).length), 0);
  await page.evaluate(() => { window.open = window.__open; });

  await page.evaluate(async ({ html, audioBase64 }) => {
    const { AudioEngine } = await import('/src/lib/audioEngine.ts');
    const { stableHtmlLessonId, normalizeHtmlNarration } = await import('/src/lib/htmlLessonBridge.ts');
    const { saveStoredAudioClip } = await import('/src/lib/ttsStorage.ts');
    const { getTtsProfile } = await import('/src/lib/ttsProfile.ts');
    await saveStoredAudioClip({ cacheKey: AudioEngine.getCacheKey(stableHtmlLessonId(html) + ':intro', normalizeHtmlNarration('Kiểm tra giọng đã lưu.'), 'Kore'), audioBase64, mimeType: 'audio/wav', duration: 1, ttsProfile: getTtsProfile('Kore'), timestamp: Date.now() });
  }, { html, audioBase64: wav.toString('base64') });
  await page.getByRole('button', { name: 'Chuẩn bị Kore & Chạy', exact: true }).click();
  await page.getByTitle('HTML lesson preview with Kore narration').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Xuất video 9:16') && !b.disabled));
  const [popup] = await Promise.all([page.waitForEvent('popup'), entry.click()]);
  await popup.getByRole('heading', { name: 'Xuất video HTML + Kore', exact: true }).waitFor();
  await popup.getByText('Kore đã sẵn sàng. Bấm “Bắt đầu xuất video”.', { exact: true }).waitFor();
  assert.ok(await popup.getByRole('button', { name: 'Bắt đầu xuất video 9:16', exact: true }).isEnabled());
  const url = new URL(popup.url()); assert.equal(url.searchParams.get('entry-test'), 'keep');
  const payload = await popup.evaluate(id => JSON.parse(localStorage.getItem('videoai2-html-export:' + id)), url.searchParams.get('html-kore-export'));
  assert.equal(payload.rawHtml, html); assert.equal(payload.fileName, 'lesson-test.html'); assert.ok(payload.createdAt > 0);
  assert.equal(await page.getByTitle('HTML lesson preview with Kore narration').count(), 0);
  assert.ok(await manual.isEnabled()); await popup.close();

  const [download] = await Promise.all([page.waitForEvent('download'), manual.click()]);
  assert.equal(download.suggestedFilename(), 'lesson-test-Kore-QUAY-THU-CONG.html');
  const content = await fs.readFile(await download.path(), 'utf8');
  assert.ok(content.includes(wav.toString('base64'))); assert.ok(content.includes('Bắt đầu bài giảng có tiếng'));
  assert.ok(content.includes('data-videoai2-offline-kore'));

  const missingHtml = html.replaceAll('intro', 'missing-cache');
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'unprepared.html', mimeType: 'text/html', buffer: Buffer.from(missingHtml) });
  await page.getByText('unprepared.html', { exact: true }).waitFor();
  await page.getByText('Đã nhận HTML hợp lệ: 1 đoạn lời đọc.', { exact: true }).waitFor();
  const [missing] = await Promise.all([page.waitForEvent('popup'), entry.click()]);
  await missing.getByText(/Chưa tìm thấy Kore trong cache/).waitFor(); await missing.close();
  assert.equal(apiCalls, 0); assert.deepEqual(errors, []);
  console.log('PASS: disabled state, storage/popup errors, existing exporter route + cached Kore, preview stop, manual HTML download, missing cache; TTS API calls=0.');
} finally { await browser?.close(); server.kill(); }
