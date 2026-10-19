import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { diagnosticPackage } from '../fixtures.mjs';
import { loadPackage } from '../../src/package.mjs';
import { openRunner } from '../../src/browser.mjs';
import { createRuntime } from '../../src/runtime.mjs';
import { BRIDGE_KEY } from '../../src/transform.mjs';

test('native phone font size, long step tail, sticky heading and cue gate', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'readable-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await diagnosticPackage(dir, { count: 1, firstSeconds: 0.2, lastSeconds: 0.2, staticSeconds: 0 });
  const pkg = await loadPackage(dir);
  const words = 'Một dòng lời giải cần đọc rõ trên điện thoại. '.repeat(24);
  pkg.html = `<!doctype html><html><head><style>
    html{font-size:18px}body{margin:0;font-family:sans-serif}.container{height:100vh;display:flex;flex-direction:column;padding:15px 10px;box-sizing:border-box;background:#111424;color:white}
    .header{font-size:22px}.prob-wrap{font-size:16px;margin:10px 0}.board{position:relative;display:flex;flex-direction:column;overflow:auto}.step-box{padding:10px;border-left:3px solid yellow}.step-title{font-size:18px;margin-bottom:8px}.line{font-size:17px;line-height:1.5}.math-line{font-size:18px}
    </style></head><body><div class="container"><div class="header">TIÊU ĐỀ BÀI GIẢNG</div><div class="prob-wrap">Đề bài luôn ở phía trên.</div><div id="board" class="board"><div id="scroll-content"><div id="old" class="step-box">Bước đã giảng<br>${words}</div><div id="current" class="step-box"><div class="step-title" id="heading">Bước đang giảng</div><div id="tail" class="line">${words}</div></div></div></div></div>
    <script>const narrationScript={cue_1:'chẩn đoán'};async function startAnimation(){await window.onNarrationCue('cue_1');}</script></body></html>`;
  const runtime = await createRuntime(); t.after(() => runtime.close());
  const runner = await openRunner(pkg, runtime, { chromiumPath: process.env.CHROMIUM_BIN, compositorWarmupMs: 100 }); t.after(() => runner.browser.close());
  const before = await runner.snapshot();
  assert.equal(before.state, 'READY'); assert.equal(before.viewport.captureWidth, 720); assert.equal(before.viewport.captureHeight, 1280);
  assert.equal(before.viewport.deviceScaleFactor, 2.5); assert.ok(!before.events.some(e => e.type === 'cue-start'));
  const measured = await runner.page.evaluate(() => {
    window.__videoai2PortraitLayout.fit();
    const s=window.__videoai2PortraitLayout.snapshot();
    const h=document.getElementById('heading').getBoundingClientRect();
    return {s,heading:{top:h.top,bottom:h.bottom},fontPixels:parseFloat(getComputedStyle(document.getElementById('tail')).fontSize)*devicePixelRatio,visibleText:document.getElementById('tail').textContent};
  });
  assert.equal(measured.s.activeId, 'current'); assert.equal(measured.s.scrollInside, true);
  assert.ok(measured.fontPixels >= 40); assert.equal(measured.visibleText, words);
  assert.ok(measured.s.focusOverflow < 1, JSON.stringify(measured));
  assert.ok(measured.s.focus.top >= measured.heading.bottom - 1, JSON.stringify(measured));
  assert.ok(measured.heading.top >= measured.s.board.top - 1);
  await runner.page.evaluate(key => {window[key].recordingReady();window[key].start();}, BRIDGE_KEY);
  await runner.page.waitForFunction(key => ['COMPLETE','ERROR'].includes(window[key].snapshot().state), BRIDGE_KEY);
  assert.equal((await runner.snapshot()).state, 'COMPLETE');
});
