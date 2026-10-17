import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertRender, RenderError } from './errors.mjs';
const exec = promisify(execFile);

export const ratio = value => {
  const [a, b = '1'] = String(value).split('/').map(Number);
  return b && Number.isFinite(a / b) ? a / b : NaN;
};
export function validateProbe(probe, { sizeBytes, toleranceSec = 0.25, minimumDuration = 0, final = true, maximumStartOffsetSec = toleranceSec } = {}) {
  const videos = probe.streams.filter(s => s.codec_type === 'video');
  const audios = probe.streams.filter(s => s.codec_type === 'audio');
  assertRender(videos.length === 1 && audios.length === 1 && probe.streams.length === 2, 'validation-error', 'Video phải có đúng một track hình và một track tiếng.');
  const video = videos[0]; const audio = audios[0];
  assertRender(sizeBytes > 0 && video.width === 720 && video.height === 1280, 'validation-error', 'Kích thước hoặc tệp video không hợp lệ.');
  assertRender(video.codec_name === 'h264' && video.pix_fmt === 'yuv420p', 'validation-error', 'Video phải dùng H.264/yuv420p.');
  assertRender(!final || audio.codec_name === 'aac' && audio.profile === 'LC', 'validation-error', 'Audio đầu ra phải là AAC-LC.');
  const videoStart = Number(video.start_time || 0);
  const audioStart = Number(audio.start_time || 0);
  // Matroska DURATION tags contain the track's end timestamp, including its
  // initial offset. MP4 stream.duration contains the actual track length.
  const trackEnd = stream => stream.duration !== undefined
    ? Number(stream.start_time || 0) + Number(stream.duration)
    : Number(stream.tags?.DURATION?.split(':').reduce((a, x) => a * 60 + Number(x), 0));
  const videoEnd = trackEnd(video); const audioEnd = trackEnd(audio);
  const videoDuration = videoEnd - videoStart;
  const audioDuration = audioEnd - audioStart;
  const frames = Number(video.nb_read_frames ?? video.nb_frames);
  assertRender(Number.isFinite(videoDuration) && Number.isFinite(audioDuration), 'validation-error', 'Không đo được thời lượng riêng từng track.');
  assertRender(videoDuration >= minimumDuration && audioDuration >= minimumDuration, 'validation-error', 'Mất đoạn cuối của hình hoặc tiếng.', { minimumDuration, videoDuration, audioDuration });
  // Raw inputs may open at different times before the lesson gate. Preserve
  // their PTS, check their endings, then pad leading audio silence in normalize.
  // Only the final MP4 must also have equal track lengths and near-zero starts.
  const durationDifference = Math.abs(videoDuration - audioDuration);
  const endDifference = Math.abs(videoEnd - audioEnd);
  assertRender((final ? durationDifference : endDifference) <= toleranceSec, 'validation-error', 'Thời lượng hình/tiếng chênh quá 0.25 giây.', { videoDuration, audioDuration, endDifference, toleranceSec });
  assertRender(Math.abs(ratio(video.avg_frame_rate) - 30) < 0.01 && Math.abs(ratio(video.r_frame_rate) - 30) < 0.01, 'validation-error', 'Tốc độ khung hình không phải 30 fps.');
  assertRender(Number.isFinite(frames) && frames > 0 && Math.abs(frames - videoDuration * 30) <= 2, 'validation-error', 'Số frame không khớp thời lượng 30 fps.', { frames, videoDuration });
  const offset = Math.abs(videoStart - audioStart);
  assertRender(Number.isFinite(videoStart) && Number.isFinite(audioStart) && videoStart >= -0.001 && audioStart >= -0.001 && offset <= maximumStartOffsetSec, 'validation-error', 'Hai track có độ lệch mốc bắt đầu quá lớn.', { offset, maximumStartOffsetSec });
  return { sizeBytes, width: video.width, height: video.height, videoCodec: video.codec_name, audioCodec: audio.codec_name, audioProfile: audio.profile, pixelFormat: video.pix_fmt, videoDuration, audioDuration, durationDifference, endDifference, startOffset: offset, frames, fps: ratio(video.avg_frame_rate), durationToleranceSec: toleranceSec };
}

export async function validateVideo(file, options = {}) {
  const stat = await fs.stat(file);
  let probe;
  try {
    const { stdout } = await exec(options.ffprobePath || 'ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { timeout: options.probeTimeoutMs ?? 120000, maxBuffer: 2 * 1024 * 1024 });
    probe = JSON.parse(stdout);
  } catch (error) { throw new RenderError('validation-error', `ffprobe không đọc được video: ${error.message}`); }
  return validateProbe(probe, { ...options, sizeBytes: stat.size });
}
