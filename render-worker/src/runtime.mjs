import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess, stopProcess, waitUntil } from './process.mjs';
import { RenderError } from './errors.mjs';

// Explicit allowlist: never pass the app's API keys, credentials or .env to
// Chromium, PulseAudio, Xvfb or FFmpeg.
export function mediaEnvironment(extra = {}) {
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  for (const key of ['LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, ...extra };
}

export async function createRuntime(options = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'videoai2-render-'));
  await fs.chmod(directory, 0o700);
  const run = path.join(directory, 'run');
  await fs.mkdir(run, { mode: 0o700 });
  const config = path.join(directory, 'config');
  await fs.mkdir(path.join(config, 'pulse'), { recursive: true, mode: 0o700 });
  // A read-only worker image cannot create ~/.config/pulse in the account's
  // system home. Give every media process a fresh, writable job-local home.
  const env = mediaEnvironment({ HOME: directory, XDG_CONFIG_HOME: config, XDG_RUNTIME_DIR: run, PULSE_SERVER: `unix:${run}/pulse.sock`, PULSE_SINK: 'videoai2', PULSE_LATENCY_MSEC: '20' });
  let xvfb;
  let pulse;
  try {
    xvfb = startProcess(options.xvfbPath || 'Xvfb', ['-displayfd', '3', '-screen', '0', '720x1280x24', '-nolisten', 'tcp', '-noreset'], { env, extraPipe: true });
    let display = '';
    xvfb.child.stdio[3].on('data', data => { display += data.toString(); });
    await waitUntil(async () => /^\d+\n/.test(display), { label: 'Xvfb', proc: xvfb });
    env.DISPLAY = `:${Number.parseInt(display, 10)}.0`;
    const pulseArgs = ['-n', '--daemonize=no', '--exit-idle-time=-1', '--use-pid-file=no', '--log-target=stderr', '--disable-shm=yes'];
    if (options.pulseModulePath) pulseArgs.push(`--dl-search-path=${options.pulseModulePath}`);
    pulseArgs.push('--load=module-null-sink sink_name=videoai2 rate=48000 channels=2', `--load=module-native-protocol-unix socket=${run}/pulse.sock auth-anonymous=1`);
    pulse = startProcess(options.pulsePath || 'pulseaudio', pulseArgs, { env });
    await waitUntil(async () => {
      const probe = startProcess(options.pactlPath || 'pactl', ['--server', env.PULSE_SERVER, 'info'], { env });
      const result = await probe.finished;
      return result.code === 0;
    }, { label: 'PulseAudio sink', proc: pulse });
    return { directory, env, sink: 'videoai2.monitor', xvfb, pulse, async close() {
      await stopProcess(pulse);
      await stopProcess(xvfb);
      await fs.rm(directory, { recursive: true, force: true });
    } };
  } catch (error) {
    await stopProcess(pulse);
    await stopProcess(xvfb);
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function acquireWorkerLock(directory) {
  // No concurrent native render in this worker, including separate CLI calls.
  const lock = path.join(directory, 'videoai2-render.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch { throw new RenderError('worker-busy', 'Worker đang chạy một job. Không chạy đồng thời trên cùng worker.'); }
  await handle.writeFile(String(process.pid));
  return async () => { await handle.close(); await fs.unlink(lock).catch(() => {}); };
}
