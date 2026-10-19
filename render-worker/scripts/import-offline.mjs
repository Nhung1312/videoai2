import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { parse as parseHtml } from 'parse5';
import { sha256 } from '../src/package.mjs';
import { assertRender } from '../src/errors.mjs';

export async function importOffline(htmlFile, destination) {
  const html = await fs.readFile(htmlFile, 'utf8');
  const document = parseHtml(html, { sourceCodeLocationInfo: true });
  let clips;
  let playbackRate;
  const removals = [];
  const walk = node => {
    const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
    if (node.nodeName === 'script' && 'data-videoai2-offline-kore' in attrs) {
      const source = html.slice(node.sourceCodeLocation.startTag.endOffset, node.sourceCodeLocation.endTag.startOffset);
      const ast = parse(source, { ecmaVersion: 'latest' });
      const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (value.type === 'VariableDeclarator' && value.id?.name === 'CLIPS' && value.init?.type === 'ArrayExpression') {
          // The exported payload is JSON. Never eval uploaded JavaScript.
          clips = JSON.parse(source.slice(value.init.start, value.init.end));
        }
        if (value.type === 'VariableDeclarator' && value.id?.name === 'PLAYBACK_RATE' && value.init?.type === 'Literal') playbackRate = value.init.value;
        for (const child of Object.values(value)) {
          if (Array.isArray(child)) child.forEach(visit);
          else if (child && typeof child === 'object') visit(child);
        }
      };
      visit(ast);
      removals.push(node.sourceCodeLocation);
    }
    if (node.nodeName === 'style' && 'data-videoai2-offline-kore-ui' in attrs) removals.push(node.sourceCodeLocation);
    for (const child of node.childNodes || []) walk(child);
  };
  walk(document);
  assertRender(Array.isArray(clips) && clips.length && Number.isFinite(playbackRate), 'package-error', 'Cần file HTML + Kore đã nhúng audio từ app. Không gọi TTS để bổ sung clip thiếu.');
  await fs.mkdir(path.join(destination, 'audio'), { recursive: true });
  const cues = [];
  for (const [index, clip] of clips.entries()) {
    assertRender(typeof clip.audioBase64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(clip.audioBase64), 'audio-error', `Kore không hợp lệ: ${clip.id}`);
    const bytes = Buffer.from(clip.audioBase64, 'base64');
    const file = `audio/${String(index).padStart(3, '0')}.wav`;
    await fs.writeFile(path.join(destination, file), bytes);
    cues.push({ id: clip.id, file, mimeType: clip.mimeType, sha256: sha256(bytes) });
  }
  let lesson = html;
  // Only the temporary package copy loses the manual-player gate/UI. The
  // user's downloaded HTML stays byte-for-byte unchanged.
  for (const loc of removals.sort((a, b) => b.startOffset - a.startOffset)) lesson = lesson.slice(0, loc.startOffset) + lesson.slice(loc.endOffset);
  await fs.writeFile(path.join(destination, 'lesson.html'), lesson);
  const manifest = { version: 1, width: 720, height: 1280, fps: 30, playbackRate, voiceName: 'Kore', lesson: 'lesson.html', source: { kind: 'frontend-cached-kore', originalHtmlSha256: sha256(Buffer.from(html)) }, cues, assets: [] };
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [input, output] = process.argv.slice(2);
  try {
    if (!input || !output) throw new Error('Dùng: npm run package:offline -- bài-Kore.html thư-mục-package');
    const manifest = await importOffline(input, output);
    console.log(JSON.stringify({ cues: manifest.cues.length, package: path.resolve(output), ttsCalls: 0 }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
