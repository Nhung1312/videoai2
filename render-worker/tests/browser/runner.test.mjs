import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { diagnosticPackage } from '../fixtures.mjs';
import { loadPackage } from '../../src/package.mjs';
import { openRunner } from '../../src/browser.mjs';
import { mediaEnvironment } from '../../src/runtime.mjs';
import { BRIDGE_KEY } from '../../src/transform.mjs';

async function fixture(t, opts = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-browser-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await diagnosticPackage(dir, { count: 3, firstSeconds: 0.3, lastSeconds: 0.8, staticSeconds: 0, ...opts });
  const pkg = await loadPackage(dir);
  const runner = await openRunner(pkg, { env: mediaEnvironment() }, { chromiumPath: process.env.CHROMIUM_BIN, headless: true, allowUnsandboxed: process.env.RENDER_TRUSTED_DIAGNOSTIC === '1', tailMs: 700 });
  t.after(() => runner.browser.close());
  return { runner, dir };
}
test('eager HTML waits for RECORDING_READY, drains cues and retains the final tail', { timeout: 15000 }, async t => {
  const { runner } = await fixture(t);
  const before = await runner.snapshot();
  assert.equal(before.state, 'READY');
  assert.equal(before.events.filter(e => e.type === 'cue-start').length, 0);
  assert.equal(await runner.page.locator('#typing').textContent(), '');
  await runner.page.evaluate(key => { window[key].recordingReady(); window[key].start(); }, BRIDGE_KEY);
  await runner.page.waitForFunction(key => ['COMPLETE', 'ERROR'].includes(window[key].snapshot().state), BRIDGE_KEY);
  const after = await runner.snapshot();
  assert.equal(after.state, 'COMPLETE', JSON.stringify(after.failure));
  assert.equal(after.activeSources, 0); assert.equal(after.queued, 0);
  const starts = after.events.filter(e => e.type === 'cue-start');
  const ends = after.events.filter(e => e.type === 'cue-end');
  assert.equal(starts.length, 3); assert.equal(ends.length, 3);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].atMs >= ends[i - 1].atMs);
  const complete = after.events.find(e => e.type === 'lesson-complete');
  assert.ok(complete.atMs - ends.at(-1).atMs >= 700);
  assert.ok(ends.at(-1).atMs - starts.at(-1).atMs >= 750);
  assert.equal(await runner.page.locator('#typing').textContent(), 'Đã xong — giữ đủ hình cuối');
});
test('animation rejection is lesson-error and never lesson-complete', { timeout: 15000 }, async t => {
  const { runner } = await fixture(t, { error: true });
  await runner.page.evaluate(key => { window[key].recordingReady(); window[key].start(); }, BRIDGE_KEY);
  await runner.page.waitForFunction(key => window[key].snapshot().state === 'ERROR', BRIDGE_KEY);
  const snapshot = await runner.snapshot();
  assert.equal(snapshot.failure.code, 'lesson-error');
  assert.ok(!snapshot.events.some(e => e.type === 'lesson-complete'));
});
test('damaged audio fails preparation instead of generating a replacement', { timeout: 15000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-corrupt-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await diagnosticPackage(dir, { count: 1 });
  const pkg = await loadPackage(dir);
  pkg.files.get(pkg.cues[0].url).bytes = Buffer.from('broken wav');
  await assert.rejects(openRunner(pkg, { env: mediaEnvironment() }, { chromiumPath: process.env.CHROMIUM_BIN, headless: true, allowUnsandboxed: process.env.RENDER_TRUSTED_DIAGNOSTIC === '1' }), /decode|audio|Unable|Encoding|giải mã/i);
});
