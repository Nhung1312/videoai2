import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertRender, RenderError } from './errors.mjs';
import { inspectLesson } from './transform.mjs';

export const ORIGIN = 'https://lesson.invalid';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_PACKAGE_BYTES = 400 * 1024 * 1024;

export async function readPackageFile(root, relative, maxBytes) {
  assertRender(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative) && !relative.includes('\\'), 'package-error', 'Đường dẫn tệp không hợp lệ.');
  const target = await fs.realpath(path.resolve(root, relative)).catch(() => null);
  assertRender(target && target.startsWith(root + path.sep), 'package-error', `Tệp không tồn tại hoặc nằm ngoài package: ${relative}`);
  const stat = await fs.stat(target);
  assertRender(stat.isFile() && stat.size <= maxBytes, 'package-error', `Tệp quá lớn hoặc không hợp lệ: ${relative}`);
  return { bytes: await fs.readFile(target), path: target };
}

export async function loadPackage(directory) {
  const root = await fs.realpath(directory);
  const manifestFile = await readPackageFile(root, 'manifest.json', 1024 * 1024);
  let manifest;
  try { manifest = JSON.parse(manifestFile.bytes); }
  catch { throw new RenderError('package-error', 'manifest.json không phải JSON hợp lệ.'); }
  assertRender(manifest.version === 1, 'package-error', 'Chỉ hỗ trợ manifest version 1.');
  assertRender(manifest.width === 720 && manifest.height === 1280 && manifest.fps === 30, 'package-error', 'Prototype chỉ xuất 720×1280, 30 fps.');
  assertRender(Number.isFinite(manifest.playbackRate) && manifest.playbackRate >= 0.5 && manifest.playbackRate <= 2, 'package-error', 'playbackRate phải nằm trong khoảng 0.5–2.');
  assertRender(Array.isArray(manifest.cues) && manifest.cues.length > 0 && manifest.cues.length <= 500, 'package-error', 'Package phải có từ 1 đến 500 cue.');
  assertRender(manifest.voiceName === 'Kore', 'package-error', 'Package phải sử dụng các clip Kore đã cache.');
  const lesson = await readPackageFile(root, manifest.lesson || 'lesson.html', 2 * 1024 * 1024);
  const html = lesson.bytes.toString('utf8');
  const inspection = inspectLesson(html);
  const files = new Map();
  const cues = [];
  let total = manifestFile.bytes.length + lesson.bytes.length;
  const ids = new Set();
  for (const [index, cue] of manifest.cues.entries()) {
    assertRender(typeof cue.id === 'string' && cue.id.length > 0 && cue.id.length <= 200 && !ids.has(cue.id), 'package-error', `Cue bị trùng hoặc không hợp lệ: ${cue.id}`);
    ids.add(cue.id);
    let file;
    try { file = await readPackageFile(root, cue.file, 64 * 1024 * 1024); }
    catch { throw new RenderError('audio-error', `Thiếu hoặc không đọc được Kore của cue: ${cue.id}`, { cueId: cue.id }); }
    assertRender(cue.sha256 === sha256(file.bytes), 'audio-error', `Kore bị thiếu/hỏng checksum: ${cue.id}`, { cueId: cue.id });
    assertRender(typeof cue.mimeType === 'string' && /^audio\/(wav|x-wav|mpeg|ogg|mp4|flac)$/.test(cue.mimeType), 'package-error', `MIME audio không hỗ trợ: ${cue.id}`);
    const url = `${ORIGIN}/__render/audio/${index}`;
    files.set(url, { ...file, contentType: cue.mimeType });
    cues.push({ id: cue.id, url, sha256: cue.sha256 });
    total += file.bytes.length;
  }
  for (const id of inspection.cueIds) assertRender(ids.has(id), 'audio-error', `Thiếu Kore đã cache của cue: ${id}`, { cueId: id });
  assertRender(inspection.cueIds.length > 0, 'package-error', 'Không đọc được narrationScript tĩnh trong HTML.');
  for (const asset of manifest.assets || []) {
    let url;
    try { url = new URL(asset.url, ORIGIN); } catch { throw new RenderError('package-error', 'URL tài nguyên không hợp lệ.'); }
    assertRender(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'package-error', 'URL tài nguyên phải là HTTP(S), không có thông tin đăng nhập.');
    const key = url.href;
    assertRender(!files.has(key) && !key.startsWith(`${ORIGIN}/__render/`) && key !== `${ORIGIN}/`, 'package-error', 'Tài nguyên trùng URL hoặc dùng URL dành riêng.');
    const file = await readPackageFile(root, asset.file, 32 * 1024 * 1024);
    assertRender(asset.sha256 === sha256(file.bytes), 'package-error', `Sai checksum tài nguyên: ${asset.url}`);
    assertRender(typeof asset.contentType === 'string' && !/[\r\n]/.test(asset.contentType), 'package-error', 'Content-Type tài nguyên không hợp lệ.');
    files.set(key, { ...file, contentType: asset.contentType });
    total += file.bytes.length;
  }
  assertRender(total <= MAX_PACKAGE_BYTES, 'package-error', 'Package vượt quá 400 MiB.');
  return { root, manifest, html, files, cues, inspection, htmlSha256: sha256(lesson.bytes) };
}
