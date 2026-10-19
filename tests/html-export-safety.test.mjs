import test from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlExportGuard, readHtmlRecordingDurations, assertHtmlRecordingDurations } from '../src/lib/htmlExportSafety.ts';

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (type, ...parts) => { const data = Buffer.concat(parts); return Buffer.concat([u32(data.length + 8), Buffer.from(type), data]); };
function mp4(video, audio) {
  const track = (id, kind) => box('trak', box('tkhd', Buffer.alloc(12), u32(id)), box('mdia', box('mdhd', Buffer.alloc(12), u32(1000), u32(0)), box('hdlr', Buffer.alloc(8), Buffer.from(kind))));
  const fragment = (id, duration) => box('traf', box('tfhd', u32(8), u32(id), u32(duration)), box('tfdt', u32(0), u32(0)), box('trun', u32(0), u32(1)));
  const b = Buffer.concat([box('ftyp', Buffer.from('isom')), box('moov', track(1, 'vide'), track(2, 'soun')), box('moof', fragment(1, video * 1000), fragment(2, audio * 1000))]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
test('fragmented MP4 uses per-track timestamps and rejects 14:56 versus 2:06', () => {
  assert.deepEqual(readHtmlRecordingDurations(mp4(895.721, 126.12)), { video: 895.721, audio: 126.12 });
  assert.throws(() => assertHtmlRecordingDurations(readHtmlRecordingDurations(mp4(895.721, 126.12)), 896));
  assert.doesNotThrow(() => assertHtmlRecordingDurations(readHtmlRecordingDurations(mp4(126.1, 126.12)), 126.2));
  assert.throws(() => assertHtmlRecordingDurations({ video: 20, audio: 20 }, 126));
  assert.throws(() => readHtmlRecordingDurations(new ArrayBuffer(20)));
});
test('WebM unknown-length clusters are read individually, including audio', () => {
  const el = (id, ...parts) => { const data = Buffer.concat(parts); return Buffer.concat([Buffer.from(id, 'hex'), Buffer.from([0x80 + data.length]), data]); };
  const tr = (n, kind, duration) => el('ae', el('d7', Buffer.from([n])), el('83', Buffer.from([kind])), el('23e383', u32(duration)));
  const data = Buffer.concat([el('1654ae6b', tr(1, 1, 40000000), tr(2, 2, 20000000)),
    Buffer.from('1f43b675ff','hex'), el('e7', Buffer.from([0])), el('a3', Buffer.from([0x81,0,0,0x80,0])), el('a3', Buffer.from([0x82,0,0,0x80,0])),
    el('1f43b675', el('e7', Buffer.from([3,232])), el('a3', Buffer.from([0x81,0,0,0x80,0])), el('a3', Buffer.from([0x82,0,0,0x80,0])))]);
  const b = Buffer.concat([el('1a45dfa3'), Buffer.from('18538067ff','hex'), data]);
  assert.deepEqual(readHtmlRecordingDurations(b.buffer.slice(b.byteOffset,b.byteOffset+b.length)), { video: 1.04, audio: 1.02 });
});
test('visibility, frame stall, clock drift and runaway timer invalidate the recording', () => {
  const saved = { window: globalThis.window, document: globalThis.document, performance: globalThis.performance };
  let now = 0; let audio = 0;
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget(); document.visibilityState = 'visible';
  globalThis.performance = { now: () => now };
  try {
    let reason = ''; const make = (max = Infinity) => createHtmlExportGuard(s => { reason = s; }, () => audio, max);
    const good = make(); good.start(); now = 500; audio = .5; good.frame(); assert.equal(good.finish().failure, '');
    const hidden = make(); hidden.start(); document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); assert.match(reason, /ẩn hoặc chuyển nền/); hidden.dispose(); document.visibilityState = 'visible';
    const stalled = make(); stalled.start(); now += 1600; audio += 1.6; stalled.frame(); assert.match(reason, /Hình bị gián đoạn/); stalled.dispose();
    const drift = make(); drift.start(); now += 1000; drift.frame(); assert.match(reason, /Đồng hồ/); drift.dispose();
    const runaway = make(.2); runaway.start(); now += 500; audio += .5; runaway.frame(); assert.match(reason, /timer/); runaway.dispose();
  } finally { Object.assign(globalThis, saved); }
});
