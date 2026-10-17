import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadPackage } from './package.mjs';
import { createRuntime, acquireWorkerLock } from './runtime.mjs';
import { openRunner } from './browser.mjs';
import { BRIDGE_KEY } from './transform.mjs';
import { startCapture, normalizeVideo } from './ffmpeg.mjs';
import { validateVideo } from './validate.mjs';
import { delay, stopProcess } from './process.mjs';
import { RenderError, assertRender } from './errors.mjs';

function deadline(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new RenderError('timeout', `Hết thời gian ${label}.`)), ms); })]).finally(() => clearTimeout(timer));
}

export async function renderPackage(packageDirectory, outputDirectory, options = {}) {
  const startedAt = Date.now();
  const release = await acquireWorkerLock(options.lockDirectory || tmpdir());
  const report = { version: 1, state: 'preparing', runtimeStates: [], pipeline: 'chromium-xvfb-pulseaudio-ffmpeg', ttsCalls: 0 };
  let runtime;
  let runner;
  let capture;
  let snapshot;
  let jobDirectory;
  const update = state => { report.state = state; options.onProgress?.({ state }); };
  const checkSignal = () => { if (options.signal?.aborted) throw new RenderError('render-error', 'Job đã được hủy.'); };
  try {
    await fs.mkdir(outputDirectory, { recursive: true });
    jobDirectory = await fs.mkdtemp(path.join(path.resolve(outputDirectory), 'job-'));
    // Fail on missing audio before starting Chromium or any native recorder.
    const pkg = await loadPackage(packageDirectory);
    report.input = { htmlSha256: pkg.htmlSha256, cueCount: pkg.cues.length, playbackRate: pkg.manifest.playbackRate, source: pkg.manifest.source || 'unspecified' };
    checkSignal();
    runtime = await createRuntime(options);
    runner = await deadline(openRunner(pkg, runtime, options), options.prepareTimeoutMs ?? 60000, 'chuẩn bị HTML/Kore');
    report.browserVersion = runner.browser.version();
    snapshot = await runner.snapshot();
    assertRender(snapshot.state === 'READY', 'render-error', 'Runner không đạt trạng thái READY.');
    checkSignal();
    const raw = path.join(jobDirectory, 'capture.mkv');
    capture = await startCapture(runtime, raw, options);
    await runner.page.evaluate(key => window[key].recordingReady(), BRIDGE_KEY);
    await delay(options.cleanLeadMs ?? 350);
    update('rendering');
    await runner.page.evaluate(key => window[key].start(), BRIDGE_KEY);
    const renderDeadline = Date.now() + (options.renderTimeoutMs ?? 900000);
    let lastFrame = capture.progress.frame;
    let lastFrameAt = Date.now();
    while (true) {
      checkSignal();
      snapshot = await deadline(runner.snapshot(), 5000, 'nhận trạng thái runner');
      if (snapshot.failure) throw new RenderError(snapshot.failure.code, snapshot.failure.message, snapshot.failure);
      if (runner.rejected.length || runner.pageErrors.length) throw new RenderError('render-error', 'Bài gọi tài nguyên ngoài package hoặc phát sinh lỗi.', { rejected: runner.rejected, pageErrors: runner.pageErrors });
      if (capture.proc.child.exitCode !== null || capture.proc.child.signalCode !== null) throw new RenderError('render-error', 'FFmpeg dừng giữa bài.', { stderr: capture.proc.stderr() });
      for (const proc of [runtime.pulse, runtime.xvfb]) if (proc.child.exitCode !== null || proc.child.signalCode !== null) throw new RenderError('render-error', 'Nguồn hình/tiếng dừng giữa bài.', { stderr: proc.stderr() });
      if (capture.progress.frame !== lastFrame) { lastFrame = capture.progress.frame; lastFrameAt = Date.now(); }
      if (Date.now() - lastFrameAt > 5000) throw new RenderError('render-error', 'FFmpeg không xuất thêm frame trong 5 giây.');
      if (Date.now() > renderDeadline) throw new RenderError('timeout', 'Bài giảng vượt thời gian render cho phép.');
      if (snapshot.state === 'COMPLETE') break;
      await delay(100);
    }
    assertRender(snapshot.animationDone && snapshot.queued === 0 && snapshot.activeSources === 0, 'render-error', 'Bài còn hình/tiếng đang chạy khi kết thúc.');
    assertRender(snapshot.maxRafGapMs <= (options.maxRafGapMs ?? 500), 'render-error', 'Chromium bị chặn luồng animation quá lâu.', { maxRafGapMs: snapshot.maxRafGapMs });
    report.capture = await capture.stop(); capture = null;
    assertRender(report.capture.progress.drops === 0, 'render-error', 'FFmpeg báo mất frame.', report.capture.progress);
    report.runner = snapshot;
    report.runtimeStates = snapshot.events.filter(e => e.type === 'state').map(e => e.state);
    const first = snapshot.events.find(e => e.type === 'gate-release');
    const last = snapshot.events.find(e => e.type === 'lesson-complete');
    const minimumDuration = (last.atMs - first.atMs) / 1000 - 0.1;
    report.rawValidation = await validateVideo(raw, { ...options, final: false, minimumDuration });
    checkSignal();
    update('encoding');
    const pending = path.join(jobDirectory, 'output.pending.mp4');
    await normalizeVideo(raw, pending, runtime, options);
    checkSignal();
    update('validating');
    report.validation = await validateVideo(pending, { ...options, minimumDuration });
    // ffprobe metadata alone cannot prove every frame is decodable or A/V sync.
    // Decode both complete streams before advertising the output as valid.
    const { runProcess } = await import('./process.mjs');
    await runProcess(options.ffmpegPath || 'ffmpeg', ['-v', 'error', '-xerror', '-i', pending, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { env: runtime.env, timeoutMs: options.probeTimeoutMs ?? 120000, signal: options.signal });
    const outputFile = path.join(jobDirectory, 'output.mp4');
    await fs.rename(pending, outputFile);
    report.outputFile = outputFile;
    report.wallDuration = (Date.now() - startedAt) / 1000;
    update('completed');
    await fs.writeFile(path.join(jobDirectory, 'report.json'), JSON.stringify(report, null, 2));
    await fs.unlink(raw);
    return report;
  } catch (error) {
    if (runner) { try { snapshot = await deadline(runner.snapshot(), 1000, 'đọc lỗi'); } catch {} }
    if (snapshot) report.runner = snapshot;
    report.error = error instanceof RenderError ? error.toJSON() : { code: 'render-error', message: error.message };
    report.wallDuration = (Date.now() - startedAt) / 1000;
    update('failed');
    if (jobDirectory) {
      await fs.writeFile(path.join(jobDirectory, 'report.json'), JSON.stringify(report, null, 2));
      await fs.rm(path.join(jobDirectory, 'output.pending.mp4'), { force: true });
    }
    throw Object.assign(error, { report, reportPath: jobDirectory && path.join(jobDirectory, 'report.json') });
  } finally {
    if (capture) await stopProcess(capture.proc, { graceful: true, timeoutMs: 15000 });
    await runner?.browser.close().catch(() => {});
    await runtime?.close();
    await release();
  }
}
