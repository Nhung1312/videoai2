import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { diagnosticPackage } from './fixtures.mjs';
import { loadPackage, readPackageFile } from '../src/package.mjs';
import { mediaEnvironment, acquireWorkerLock } from '../src/runtime.mjs';
import { isPublicAddress } from '../scripts/collect-assets.mjs';

test('binary audio package loads without TTS and detects missing final cue', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'package-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const { manifest } = await diagnosticPackage(dir);
  const pkg = await loadPackage(dir); assert.equal(pkg.cues.length, 18);
  await fs.unlink(path.join(dir, manifest.cues.at(-1).file));
  await assert.rejects(loadPackage(dir), error => error.code === 'audio-error' && error.details.cueId === 'cue_18');
});
test('reject symlinks escaping package root', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'package-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.symlink('/etc/passwd', path.join(dir, 'escape'));
  await assert.rejects(readPackageFile(dir, 'escape', 100000), /ngoài package/);
});
test('media child environment excludes app keys and tokens', () => {
  process.env.GEMINI_API_KEY = 'test-placeholder'; process.env.UNRELATED_TOKEN = 'test-placeholder';
  const env = mediaEnvironment();
  assert.equal(env.GEMINI_API_KEY, undefined); assert.equal(env.UNRELATED_TOKEN, undefined);
  delete process.env.GEMINI_API_KEY; delete process.env.UNRELATED_TOKEN;
});
test('one worker cannot acquire a second render slot', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const release = await acquireWorkerLock(dir);
  await assert.rejects(acquireWorkerLock(dir), error => error.code === 'worker-busy');
  await release(); await (await acquireWorkerLock(dir))();
});
test('asset stager rejects metadata/private/mapped addresses', () => {
  for (const ip of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '172.16.4.1', '192.168.1.1', '100.100.100.200', '::ffff:127.0.0.1', '::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('1.1.1.1'), true);
});
