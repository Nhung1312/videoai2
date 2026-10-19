import fs from 'node:fs/promises';
import path from 'node:path';
import { renderPackage } from '../src/render.mjs';

export function evaluateBenchmark(reports) {
  if (reports.length !== 3 || reports.some(r => r.state !== 'completed')) return { passed: false, reason: 'Cần 3/3 lượt render hoàn tất.' };
  const [first] = reports;
  if (first.input.cueCount < 15 || first.input.cueCount > 20) return { passed: false, reason: 'Bài nghiệm thu cần 15–20 cue.' };
  if (reports.some(r => r.input.htmlSha256 !== first.input.htmlSha256 || r.input.playbackRate !== first.input.playbackRate)) return { passed: false, reason: 'Ba lượt phải dùng cùng HTML và playbackRate.' };
  if (reports.some(r => r.input.source?.kind !== 'frontend-cached-kore')) return { passed: false, reason: 'Audio chẩn đoán không thay thế bài thực tế dùng Kore cache.' };
  if (reports.some(r => !r.evidence?.firstCueAV || !r.evidence?.lastCueAV || !r.evidence?.motionReviewed)) return { passed: false, reason: 'Cần kiểm chứng hình/tiếng cue đầu, cue cuối và chuyển động trong cả 3 video.' };
  const durations = reports.map(r => r.validation.videoDuration);
  if (Math.max(...durations) - Math.min(...durations) > 0.5) return { passed: false, reason: 'Thời lượng 3 lần lệch quá 0.5 giây; cần đánh giá lại.' };
  return { passed: true, reason: 'Đạt cổng nghiệm thu prototype 3/3.', durations };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) { console.error('Dùng: npm run benchmark -- package output'); process.exitCode = 2; }
  else {
    const reports = [];
    const options = { chromiumPath: process.env.CHROMIUM_BIN, xvfbPath: process.env.XVFB_BIN, pulsePath: process.env.PULSEAUDIO_BIN, pactlPath: process.env.PACTL_BIN, pulseModulePath: process.env.PULSE_MODULE_PATH, allowUnsandboxed: process.env.RENDER_TRUSTED_DIAGNOSTIC === '1' };
    for (let i = 0; i < 3; i++) {
      try { reports.push(await renderPackage(input, output, options)); }
      catch (error) { reports.push(error.report || { state: 'failed', error: error.message }); }
    }
    const result = { reports: reports.map(r => ({ state: r.state, outputFile: r.outputFile, validation: r.validation, error: r.error })), gate: evaluateBenchmark(reports) };
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'benchmark.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!result.gate.passed) process.exitCode = 1;
  }
}
