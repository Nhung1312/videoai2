// Run against the production bundle, with synthetic audio and no Gemini calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from '../render-worker/node_modules/playwright-core/index.mjs';
import { SAMPLE_GEOMETRY_LESSON } from '../src/lib/sampleLessons.ts';
import { AudioEngine } from '../src/lib/audioEngine.ts';
import { getTtsProfile } from '../src/lib/ttsProfile.ts';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(16000, 40);
for (let i = 0; i < 8000; i++) wav.writeInt16LE(Math.round(2000 * Math.sin(i * 2 * Math.PI * 440 / 8000)), 44 + i * 2);
const audioBase64 = wav.toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="visual">Lời giải x² = 4</div><script>
const narrationScript={used:'Lời được gọi.',unused:'Khai báo dư.',branch:'Nhánh không chạy.'};
async function cue(id){await window.onNarrationCue(id,narrationScript[id]);}
async function withCue(id,fn){await Promise.all([cue(id),fn()]);}
async function startAnimation(){for(const id of ['used'])await withCue(id,async()=>{await new Promise(r=>setTimeout(r,30));document.getElementById('visual').style.display='none';});if(false)await cue('branch');}
window.addEventListener('load',()=>startAnimation());</script></body></html>`;
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch('http://127.0.0.1:4173')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'production preview must start');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ acceptDownloads: true });
  const errors = [], requests = [];
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  await context.route('**/api/tts', route => {
    const request = route.request().postDataJSON(); requests.push(request.text);
    return route.fulfill({ json: { audioBase64, mimeType: 'audio/wav', ttsProfile: request.ttsProfile } });
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/?html-kore-export=bootstrap');
  const first = SAMPLE_GEOMETRY_LESSON.steps[0];
  await page.evaluate(async clip => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('GeoLessonAudioCacheDB', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio_clips', { keyPath: 'cacheKey' });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => { const tx = db.transaction('audio_clips', 'readwrite'); tx.objectStore('audio_clips').put(clip); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, { cacheKey: AudioEngine.getCacheKey(first.id, first.narration, 'Kore'), audioBase64, mimeType: 'audio/wav', duration: 1, ttsProfile: getTtsProfile('Kore'), timestamp: Date.now() });

  // Top-level production UI: first manual click prepares; another early click
  // neither packages a partial lesson nor restarts the playing audio.
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'HTML + Kore', exact: true }).click();
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'readiness.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  const manual = page.getByRole('button', { name: 'Tải HTML + Kore để quay thủ công', exact: true });
  const video = page.getByRole('button', { name: 'Xuất video 9:16', exact: true });
  let downloads = 0; page.on('download', () => downloads++);
  await manual.click();
  const frame = page.frameLocator('iframe[title="HTML lesson preview with Kore narration"]');
  await frame.locator('#visual').waitFor();
  await video.click();
  await page.getByText(/Bài đang chuẩn bị\/chạy Kore/).waitFor();
  assert.equal(context.pages().length, 1, 'early export must not open/background the preparing lesson');
  assert.equal(downloads, 0, 'never download partial HTML');
  await page.getByText(/Đã cache 1 cue thực sự được gọi/).waitFor();
  assert.deepEqual(requests, ['Lời được gọi.']);
  const [download] = await Promise.all([page.waitForEvent('download'), manual.click()]);
  const offline = await fs.readFile(await download.path(), 'utf8');
  assert.deepEqual(JSON.parse(offline.match(/const CLIPS = ([^\n]+);/)[1]).map(clip => clip.id), ['used']);
  const [popup] = await Promise.all([page.waitForEvent('popup'), video.click()]);
  await popup.getByText('Kore đã sẵn sàng. Bấm “Bắt đầu xuất video”.', { exact: true }).waitFor();
  assert.ok(await popup.getByRole('button', { name: 'Bắt đầu xuất video 9:16', exact: true }).isEnabled());
  await popup.close();
  // The downloaded runtime was serialized from minified production code.
  await context.route('**/offline-production', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: offline }));
  const local = await context.newPage(); await local.goto('http://127.0.0.1:4173/offline-production');
  await local.getByRole('button', { name: 'Bắt đầu bài giảng có tiếng', exact: true }).click();
  await local.waitForTimeout(200); assert.ok(await local.locator('#visual').isVisible());
  await local.waitForFunction(() => document.getElementById('visual').style.display === 'none'); await local.close();

  // AI Studio style iframe: first video click prepares in-place; second opens
  // the existing about:blank shell, with actual cached cue bytes only.
  await context.route('**/embedded-production', route => route.fulfill({ contentType: 'text/html', body: '<iframe title="Preview" src="/" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" style="width:100%;height:100vh"></iframe>' }));
  await page.goto('http://127.0.0.1:4173/embedded-production');
  const app = page.frameLocator('iframe[title="Preview"]');
  await app.getByRole('button', { name: 'HTML + Kore', exact: true }).click();
  await app.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'readiness.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  const embeddedVideo = app.getByRole('button', { name: 'Xuất video 9:16', exact: true });
  await embeddedVideo.click(); await app.getByText(/Đã cache 1 cue thực sự được gọi/).waitFor();
  const [blank] = await Promise.all([page.waitForEvent('popup'), embeddedVideo.click()]);
  assert.equal(blank.url(), 'about:blank');
  await blank.getByText('Đã nhận 1 đoạn Kore. Sẵn sàng xuất video.', { exact: true }).waitFor(); await blank.close();
  const escapedDownload = context.waitForEvent('page').then(popup => popup.waitForEvent('download'));
  const [downloadWindow, embeddedDownload] = await Promise.all([page.waitForEvent('popup'), escapedDownload, app.getByRole('button', { name: 'Tải HTML + Kore để quay thủ công', exact: true }).click()]);
  assert.equal(downloadWindow.url(), 'about:blank');
  assert.ok((await fs.readFile(await embeddedDownload.path(), 'utf8')).includes(audioBase64));
  assert.ok(await downloadWindow.getByRole('link', { name: 'Tải HTML + Kore để quay thủ công', exact: true }).isVisible());
  await downloadWindow.close();
  assert.deepEqual(requests, ['Lời được gọi.'], 'export, replay, skipped branch and unused declaration make no further TTS calls');
  assert.deepEqual(errors, []);
  const broken = html.replace('async function startAnimation(){', "async function startAnimation(){throw new Error('Synthetic animation failure');");
  await app.locator('input[type=file][accept*=".html"]').setInputFiles({ name: 'broken.html', mimeType: 'text/html', buffer: Buffer.from(broken) });
  await app.getByRole('button', { name: 'Tải HTML + Kore để quay thủ công', exact: true }).click();
  await app.getByText('HTML bài giảng gặp lỗi: Synthetic animation failure', { exact: true }).waitFor();
  assert.ok(await app.getByRole('button', { name: 'Chuẩn bị Kore & Chạy', exact: true }).isEnabled(), 'a script failure must not disable retry');
  assert.equal(context.pages().length, 1, 'failed lesson never opens a download/export window');
  assert.deepEqual(requests, ['Lời được gọi.']);
  assert.deepEqual(errors, ['Synthetic animation failure']);
  console.log('PASS production: early/manual/video export readiness, actual cues only, cached replay, minified offline player, normal route and embedded about:blank; mocked TTS calls=1.');
} finally { await browser?.close(); server.kill(); }
