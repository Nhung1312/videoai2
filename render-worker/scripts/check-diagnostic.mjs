import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertRender } from '../src/errors.mjs';
const exec = promisify(execFile);

export async function checkDiagnostic(file, count = 18) {
  const { stdout: pixels } = await exec('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', 'crop=20:20:30:30,scale=1:1,format=gray', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
  const { stdout: audio } = await exec('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  const visualStarts = []; const visualEnds = []; const visualTransitions = []; let white = false;
  for (let i = 0; i < pixels.length; i++) {
    const now = pixels[i] > 210;
    if (now && !white) { visualStarts.push(i / 30); visualTransitions.push(i / 30); }
    if (!now && white) { visualEnds.push(i / 30); visualTransitions.push(i / 30); }
    white = now;
  }
  const audioStarts = []; const audioEnds = []; let audible = false; let lastSound = 0;
  for (let start = 0; start + 80 * 4 <= audio.length; start += 80 * 4) {
    let square = 0;
    for (let i = 0; i < 80; i++) square += audio.readFloatLE(start + i * 4) ** 2;
    const time = start / 4 / 8000;
    if (Math.sqrt(square / 80) > 0.025) {
      if (!audible) audioStarts.push(time);
      audible = true; lastSound = time;
    } else if (audible && time - lastSound > 0.04) { audible = false; audioEnds.push(lastSound + 0.01); }
  }
  if (audible) audioEnds.push(lastSound + 0.01);
  assertRender(audioStarts.length === count, 'diagnostic-error', 'Số âm báo ghi thực tế không đủ.', { audioStarts });
  assertRender(visualStarts.length === Math.ceil(count / 2), 'diagnostic-error', 'Marker hình không đủ hoặc capture không đúng viewport.', { visualStarts });
  assertRender(visualTransitions.length === count, 'diagnostic-error', 'Thiếu marker cue đầu/cuối.', { visualTransitions });
  const drifts = visualTransitions.map((time, index) => audioStarts[index] - time);
  assertRender(drifts.every(drift => Math.abs(drift) <= 0.15), 'diagnostic-error', 'Âm báo và marker hình lệch quá 150 ms.', { drifts });
  const tail = pixels.length / 30 - audioEnds.at(-1);
  assertRender(tail >= 0.6, 'diagnostic-error', 'Thiếu tiếng cuối hoặc không đủ tail cuối.', { tail });
  return { audioStarts, audioEnds, visualStarts, visualEnds, visualTransitions, drifts, maximumAbsDrift: Math.max(...drifts.map(Math.abs)), tail, note: 'Diagnostic tones, not a real Kore acceptance.' };
}
