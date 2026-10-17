import path from 'node:path';
import { renderPackage } from './render.mjs';

const [packageDirectory, outputDirectory] = process.argv.slice(2);
if (!packageDirectory || !outputDirectory) {
  console.error('Dùng: npm run render -- /đường/dẫn/package /đường/dẫn/output');
  process.exitCode = 2;
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const options = {
    chromiumPath: process.env.CHROMIUM_BIN,
    xvfbPath: process.env.XVFB_BIN,
    pulsePath: process.env.PULSEAUDIO_BIN,
    pactlPath: process.env.PACTL_BIN,
    pulseModulePath: process.env.PULSE_MODULE_PATH,
    ffmpegPath: process.env.FFMPEG_BIN,
    ffprobePath: process.env.FFPROBE_BIN,
    // Disabled by default. Only for trusted local diagnostics in environments
    // that cannot create Chromium sandbox namespaces. Never enable in hosting.
    allowUnsandboxed: process.env.RENDER_TRUSTED_DIAGNOSTIC === '1',
    signal: controller.signal,
    onProgress: status => console.log(JSON.stringify(status)),
  };
  try {
    const report = await renderPackage(path.resolve(packageDirectory), path.resolve(outputDirectory), options);
    console.log(JSON.stringify({ state: report.state, outputFile: report.outputFile, validation: report.validation }));
  } catch (error) {
    console.error(JSON.stringify({ state: 'failed', error: error.report?.error || { code: 'render-error', message: error.message }, reportPath: error.reportPath }));
    process.exitCode = 1;
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
