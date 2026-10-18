import { startProcess, runProcess, stopProcess, waitUntil } from './process.mjs';
import { RenderError } from './errors.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function captureArgs({ display, sink, output }) {
  return ['-hide_banner', '-y', '-loglevel', 'warning', '-stats_period', '0.1', '-progress', 'pipe:3', '-copyts', '-start_at_zero',
    '-thread_queue_size', '512', '-probesize', '32', '-analyzeduration', '0', '-use_wallclock_as_timestamps', '1', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', '720x1280', '-i', `${display}+0,0`,
    '-thread_queue_size', '1024', '-probesize', '32', '-analyzeduration', '0', '-isync', '0', '-use_wallclock_as_timestamps', '1', '-f', 'pulse', '-sample_rate', '48000', '-channels', '2', '-i', sink,
    '-map', '0:v:0', '-map', '1:a:0', '-vf', 'fps=30,format=yuv420p,setsar=1', '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '2',
    '-c:a', 'pcm_s16le', output];
}
export function normalizeArgs(input, output, { padAudioToSec } = {}) {
  // Preserve the captured relationship between inputs. Never concat cue WAVs,
  // independently reset both PTS, use -shortest, or truncate the final clip.
  const audioFilter = 'aresample=async=1:first_pts=0' + (Number.isFinite(padAudioToSec) && padAudioToSec > 0 ? `,apad=whole_dur=${padAudioToSec.toFixed(6)}` : '');
  return ['-hide_banner', '-y', '-loglevel', 'warning', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0', '-vf', 'fps=30,format=yuv420p,setsar=1', '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-profile:v', 'high', '-level:v', '4.0', '-threads', '2',
    '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '160k', '-ar', '48000',
    '-af', audioFilter, '-video_track_timescale', '90000', '-movflags', '+faststart', output];
}

export async function startCapture(runtime, output, { ffmpegPath = 'ffmpeg', startupTimeoutMs = 20000 } = {}) {
  const startedAt = Date.now();
  const proc = startProcess(ffmpegPath, captureArgs({ display: runtime.env.DISPLAY, sink: runtime.sink, output }), { env: runtime.env, extraPipe: true });
  const progress = { frame: 0, outTimeUs: 0, duplicates: 0, drops: 0 };
  let pending = '';
  proc.child.stdio[3].on('data', data => {
    pending += data.toString();
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) {
      const [key, value] = line.split('=');
      if (key === 'frame') progress.frame = Number(value);
      if (key === 'out_time_us') progress.outTimeUs = Number(value);
      if (key === 'dup_frames') progress.duplicates = Number(value);
      if (key === 'drop_frames') progress.drops = Number(value);
    }
  });
  try {
    await waitUntil(async () => progress.frame >= 1 && progress.outTimeUs > 0, { timeoutMs: startupTimeoutMs, label: 'FFmpeg ghi được hình và tiếng', proc });
    return { startedAt, progress, proc, async stop() {
      const result = await stopProcess(proc, { graceful: true, timeoutMs: 15000 });
      if (result.code !== 0) throw new RenderError('render-error', 'FFmpeg chưa đóng phiên ghi an toàn.', result);
      return { ...result, progress: { ...progress }, wallDuration: (Date.now() - startedAt) / 1000 };
    } };
  } catch (error) { await stopProcess(proc); throw error; }
}

export async function normalizeVideo(input, output, runtime, options = {}) {
  return runProcess(options.ffmpegPath || 'ffmpeg', normalizeArgs(input, output, options), { env: runtime.env, timeoutMs: options.encodeTimeoutMs ?? 600000, signal: options.signal });
}

export async function verifyCapturedSilentTail(input, audioEnd, runtime, options = {}) {
  const { stdout } = await exec(options.ffmpegPath || 'ffmpeg', ['-v', 'error', '-ss', Math.max(0, audioEnd - 0.12).toFixed(6), '-i', input, '-map', '0:a:0', '-t', '0.12', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], { env: runtime.env, encoding: 'buffer', timeout: 30000, maxBuffer: 65536 });
  const samples = Math.floor(stdout.length / 4);
  let energy = 0; let peak = 0;
  for (let i = 0; i < samples; i++) { const x = stdout.readFloatLE(i * 4); energy += x * x; peak = Math.max(peak, Math.abs(x)); }
  const rms = Math.sqrt(energy / Math.max(1, samples));
  if (samples < 640 || !Number.isFinite(rms) || rms > 0.001 || peak > 0.01) throw new RenderError('validation-error', 'Track audio kết thúc khi chưa xác minh được đoạn im lặng cuối.', { samples, rms, peak });
  return { samples, rms, peak, verifiedSilenceSec: samples / 8000 };
}
