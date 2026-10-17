import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importOffline } from '../scripts/import-offline.mjs';
import { wavTone } from './fixtures.mjs';
import { loadPackage } from '../src/package.mjs';

test('offline importer reuses exact clip bytes and never edits source HTML', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-import-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const audio = wavTone();
  const original = `<html><head><style data-videoai2-offline-kore-ui>body{margin:0}</style></head><body><script>const narrationScript={a:'Xin chào'};async function startAnimation(){await window.onNarrationCue('a');}startAnimation();</script><script data-videoai2-offline-kore>(()=>{const CLIPS=${JSON.stringify([{ id: 'a', mimeType: 'audio/wav', audioBase64: audio.toString('base64') }])};const PLAYBACK_RATE=0.85;})();</script></body></html>`;
  const source = path.join(directory, 'source.html');
  const target = path.join(directory, 'package');
  await fs.writeFile(source, original);
  await importOffline(source, target);
  assert.equal(await fs.readFile(source, 'utf8'), original);
  const pkg = await loadPackage(target);
  assert.equal(pkg.manifest.playbackRate, 0.85);
  assert.deepEqual(pkg.files.get(pkg.cues[0].url).bytes, audio);
  assert.ok(!pkg.html.includes('data-videoai2-offline-kore'));
  assert.ok(pkg.html.includes('async function startAnimation(){await window.onNarrationCue'));
});
