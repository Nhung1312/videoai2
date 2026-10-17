import { startProcess, runProcess, stopProcess, waitUntil } from './process.mjs';
import { RenderError } from './errors.mjs';

export function captureArgs({ display, sink, output }) {
  return ['-hide_banner', '-y', '-loglevel', 'warning', '-stats_period', '0.1', '-progress', 'pipe:3',
    '-thread_queue_size', '512', '-use_wallclock_as_timestamps', '1', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', '720x1280', '-i', `${display}+0,0`,
    '-thread_queue_size', '1024', '-use_wallclock_as_timestamps', '1', '-f', 'pulse', '-sample_rate', '48000', '-channels', '2', '-i', sink,
    '-map', '0:v:0', '-map', '1:a:0', '-vf', 'fps=30,format=yuv420p', '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '2',
    '-c:a', 'pcm_s16le', output];
}
export function normalizeArgs(input, output) {
  // Preserve the captured relationship between inputs. Never concat cue WAVs,
  // independently reset both PTS, use -shortest, or truncate the final clip.
  return ['-hide_banner', '-y', '-loglevel', 'warning', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0', '-vf', 'fps=30,format=yuv420p', '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-profile:v', 'high', '-level:v', '4.0', '-threads', '2',
    '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '160k', '-ar', '48000',
    '-af', 'aresample=async=1:first_pts=0', '-video_track_timescale', '90000', '-movflags', '+faststart', output];
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
  return runProcess(options.ffmpegPath || 'ffmpeg', normalizeArgs(input, output), { env: runtime.env, timeoutMs: options.encodeTimeoutMs ?? 600000, signal: options.signal });
}
