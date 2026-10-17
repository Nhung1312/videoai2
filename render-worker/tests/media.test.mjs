import test from 'node:test';
import assert from 'node:assert/strict';
import { captureArgs, normalizeArgs } from '../src/ffmpeg.mjs';
import { validateProbe } from '../src/validate.mjs';
import { evaluateBenchmark } from '../scripts/benchmark.mjs';

function probe() { return { streams: [
  { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 720, height: 1280, duration: '12', nb_read_frames: '360', avg_frame_rate: '30/1', r_frame_rate: '30/1', start_time: '0' },
  { codec_type: 'audio', codec_name: 'aac', profile: 'LC', duration: '12.02', start_time: '0' },
] }; }
test('one FFmpeg invocation captures Xvfb and PulseAudio with wallclock timestamps', () => {
  const args = captureArgs({ display: ':99.0', sink: 'videoai2.monitor', output: 'capture.mkv' });
  assert.equal(args.filter(x => x === '-i').length, 2);
  assert.equal(args.filter(x => x === '-use_wallclock_as_timestamps').length, 2);
  assert.ok(args.includes('-copyts') && args.includes('-start_at_zero') && args.includes('-isync'));
  assert.ok(args.includes('x11grab') && args.includes('pulse'));
  assert.ok(!args.includes('-shortest'));
  assert.ok(!normalizeArgs('a.mkv', 'a.mp4').includes('-shortest'));
});
test('validate codec, geometry, frame count, starts and duration drift', () => {
  assert.ok(validateProbe(probe(), { sizeBytes: 1000 }).durationDifference < 0.25);
  const bad = probe(); bad.streams[1].duration = '13';
  assert.throws(() => validateProbe(bad, { sizeBytes: 1000 }), /chênh/);
  const opus = probe(); opus.streams[1].codec_name = 'opus';
  assert.throws(() => validateProbe(opus, { sizeBytes: 1000 }), /AAC-LC/);
  const lostTail = probe();
  assert.throws(() => validateProbe(lostTail, { sizeBytes: 1000, minimumDuration: 13 }), /đoạn cuối/);
  const noAudio = probe(); noAudio.streams.pop();
  assert.throws(() => validateProbe(noAudio, { sizeBytes: 1000 }), /track/);
});
test('three synthetic exports cannot unlock real Kore UI integration', () => {
  const report = { state: 'completed', input: { cueCount: 18, htmlSha256: 'x', playbackRate: 1, source: { kind: 'synthetic-diagnostic' } }, validation: { videoDuration: 12 } };
  assert.equal(evaluateBenchmark([report, report, report]).passed, false);
  const cached = { ...report, input: { ...report.input, source: { kind: 'frontend-cached-kore' } } };
  assert.equal(evaluateBenchmark([cached, cached, cached]).passed, false);
  const reviewed = { ...cached, evidence: { firstCueAV: true, lastCueAV: true, motionReviewed: true } };
  assert.equal(evaluateBenchmark([reviewed, reviewed, reviewed]).passed, true);
});
