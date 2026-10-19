import fs from 'node:fs/promises';
import path from 'node:path';
import { diagnosticPackage } from '../tests/fixtures.mjs';
import { renderPackage } from '../src/render.mjs';
import { checkDiagnostic } from './check-diagnostic.mjs';

const root = path.resolve(process.env.RENDER_ARTIFACTS || 'artifacts/native-smoke');
await fs.mkdir(root, { recursive: true });
const input = path.join(root, 'diagnostic-package');
await diagnosticPackage(input);
const options = { chromiumPath: process.env.CHROMIUM_BIN, xvfbPath: process.env.XVFB_BIN, pulsePath: process.env.PULSEAUDIO_BIN, pactlPath: process.env.PACTL_BIN, pulseModulePath: process.env.PULSE_MODULE_PATH, allowUnsandboxed: process.env.RENDER_TRUSTED_DIAGNOSTIC === '1', renderTimeoutMs: 120000, onProgress: status => console.log(JSON.stringify(status)) };
const results = [];
try {
  for (let i = 0; i < 3; i++) {
    const report = await renderPackage(input, root, options);
    const diagnostic = await checkDiagnostic(report.outputFile);
    results.push({ index: i + 1, outputFile: report.outputFile, validation: report.validation, maxRafGapMs: report.runner.maxRafGapMs, capture: report.capture.progress, diagnostic });
    console.log(JSON.stringify(results.at(-1)));
  }
  await fs.writeFile(path.join(root, 'diagnostic-results.json'), JSON.stringify({ passed: true, realKoreGatePassed: false, results }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(root, 'diagnostic-results.json'), JSON.stringify({ passed: false, realKoreGatePassed: false, results, error: error.report?.error || { code: error.code, message: error.message, details: error.details } }, null, 2));
  throw error;
}
