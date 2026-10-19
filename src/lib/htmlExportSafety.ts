/** These functions are self-contained: the about:blank exporter embeds the
 * same implementations, without importing scripts from an AI Studio URL. */
export function createHtmlExportGuard(onAbort: (reason: string) => void, audioClock: () => number, maximumSeconds = Infinity) {
  let active = false;
  let failure = '';
  let startedAt = 0;
  let audioStart = 0;
  let lastFrame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const fail = (reason: string) => {
    if (!active || failure) return;
    failure = reason;
    active = false;
    clearInterval(timer);
    onAbort(reason);
  };
  const visible = () => {
    if (document.visibilityState !== 'visible') fail('Tab xuất đã bị ẩn hoặc chuyển nền. Đã dừng và hủy bản ghi; hãy giữ tab xuất ở phía trước khi xuất lại.');
  };
  const check = () => {
    if (!active) return;
    visible();
    const now = performance.now();
    if ((now - startedAt) / 1000 > maximumSeconds) fail('Animation chờ quá lâu so với các đoạn Kore đã chuẩn bị. Đã hủy bản ghi để tránh video bị kéo dài do timer.');
    if (now - lastFrame > 1500) fail('Hình bị gián đoạn quá 1,5 giây. Đã hủy bản ghi để tránh video đứng hình hoặc sai thời lượng.');
    if (Math.abs((now - startedAt) / 1000 - (audioClock() - audioStart)) > 0.75) fail('Đồng hồ hình và tiếng bị gián đoạn. Đã hủy bản ghi; hãy xuất lại và giữ tab ở phía trước.');
  };
  const leave = () => fail('Tab xuất bị đóng, đóng băng hoặc chuyển trang. Bản ghi đã bị hủy.');
  const remove = () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visible);
    document.removeEventListener('freeze', leave);
    window.removeEventListener('pagehide', leave);
  };
  return {
    start() {
      remove(); failure = ''; active = true;
      startedAt = lastFrame = performance.now(); audioStart = audioClock();
      document.addEventListener('visibilitychange', visible);
      document.addEventListener('freeze', leave);
      window.addEventListener('pagehide', leave);
      timer = setInterval(check, 250);
      visible();
    },
    frame() { check(); if (active) lastFrame = performance.now(); },
    finish() {
      check(); active = false; remove();
      return { elapsed: (performance.now() - startedAt) / 1000, failure };
    },
    dispose() { active = false; remove(); },
  };
}

/** Read per-track media timestamps, not the container's duration. Supports the
 * fragmented MP4 and WebM produced by Chromium MediaRecorder. Fail closed. */
export function readHtmlRecordingDurations(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const tracks = new Map<number, { kind: string; scale: number; end: number; duration: number }>();
  const u32 = (p: number) => view.getUint32(p);
  const u64 = (p: number) => {
    const n = Number(view.getBigUint64(p));
    if (!Number.isSafeInteger(n)) throw new Error('Timestamp video quá lớn.');
    return n;
  };
  const text = (p: number, n: number) => String.fromCharCode(...bytes.subarray(p, p + n));
  const boxes = (start: number, end: number) => {
    const result: Array<{ type: string; start: number; end: number }> = [];
    for (let p = start; p + 8 <= end;) {
      let size = u32(p); let header = 8;
      if (size === 1) { size = u64(p + 8); header = 16; }
      if (size === 0) size = end - p;
      if (size < header || p + size > end) throw new Error('Cấu trúc MP4 bị lỗi.');
      result.push({ type: text(p + 4, 4), start: p + header, end: p + size }); p += size;
    }
    return result;
  };
  if (text(4, 4) === 'ftyp') {
    const root = boxes(0, bytes.length);
    const moov = root.find(b => b.type === 'moov');
    if (!moov) throw new Error('MP4 thiếu thông tin track.');
    const movie = boxes(moov.start, moov.end);
    for (const tr of movie.filter(b => b.type === 'trak')) {
      const list = boxes(tr.start, tr.end);
      const tk = list.find(b => b.type === 'tkhd'); const md = list.find(b => b.type === 'mdia');
      if (!tk || !md) continue;
      const id = u32(tk.start + (bytes[tk.start] === 1 ? 20 : 12));
      const media = boxes(md.start, md.end);
      const hd = media.find(b => b.type === 'hdlr'); const dh = media.find(b => b.type === 'mdhd');
      if (!hd || !dh) continue;
      const at = dh.start + (bytes[dh.start] === 1 ? 20 : 12);
      const scale = u32(at); const end = bytes[dh.start] === 1 ? u64(at + 4) : u32(at + 4);
      tracks.set(id, { kind: text(hd.start + 8, 4), scale, end, duration: 0 });
    }
    const mvex = movie.find(b => b.type === 'mvex');
    if (mvex) for (const b of boxes(mvex.start, mvex.end).filter(b => b.type === 'trex')) {
      const track = tracks.get(u32(b.start + 4)); if (track) track.duration = u32(b.start + 12);
    }
    for (const fragment of root.filter(b => b.type === 'moof')) for (const tf of boxes(fragment.start, fragment.end).filter(b => b.type === 'traf')) {
      const list = boxes(tf.start, tf.end); const hd = list.find(b => b.type === 'tfhd'); const dt = list.find(b => b.type === 'tfdt');
      if (!hd) continue;
      const track = tracks.get(u32(hd.start + 4)); if (!track) continue;
      const flags = u32(hd.start) & 0xffffff; let p = hd.start + 8;
      if (flags & 1) p += 8; if (flags & 2) p += 4;
      const defaultDuration = flags & 8 ? u32(p) : track.duration;
      let time = dt ? (bytes[dt.start] === 1 ? u64(dt.start + 4) : u32(dt.start + 4)) : track.end;
      for (const run of list.filter(b => b.type === 'trun')) {
        const f = u32(run.start) & 0xffffff; const count = u32(run.start + 4); let q = run.start + 8;
        if (f & 1) q += 4; if (f & 4) q += 4;
        if (count > 10000000) throw new Error('Số frame video không hợp lệ.');
        for (let i = 0; i < count; i++) {
          const duration = f & 0x100 ? u32(q) : defaultDuration; if (f & 0x100) q += 4;
          if (f & 0x200) q += 4; if (f & 0x400) q += 4;
          const offset = f & 0x800 ? (bytes[run.start] === 1 ? view.getInt32(q) : u32(q)) : 0; if (f & 0x800) q += 4;
          if (q > run.end || !duration) throw new Error('MP4 thiếu thời gian frame.');
          track.end = Math.max(track.end, time + offset + duration); time += duration;
        }
      }
    }
  } else if (u32(0) === 0x1a45dfa3) {
    const vint = (p: number, id = false) => {
      let size = 1; let mask = 0x80;
      while (size <= 8 && !(bytes[p] & mask)) { size++; mask >>= 1; }
      if (size > 8 || p + size > bytes.length) throw new Error('Cấu trúc WebM bị lỗi.');
      let value = id ? bytes[p] : bytes[p] & (mask - 1); let unknown = !id && value === mask - 1;
      for (let i = 1; i < size; i++) { value = value * 256 + bytes[p + i]; unknown &&= bytes[p + i] === 255; }
      return { size, value, unknown };
    };
    const elements = (start: number, end: number) => {
      const result: Array<{ id: number; start: number; end: number }> = [];
      for (let p = start; p < end;) {
        const id = vint(p, true); const n = vint(p + id.size); const at = p + id.size + n.size;
        let stop = n.unknown ? end : at + n.value;
        if (n.unknown && id.value === 0x1f43b675) {
          // A live WebM cluster may have unknown length. Walk child elements
          // by their sizes so encoded frame bytes cannot look like a sibling.
          for (let q = at; q < end;) {
            const child = vint(q, true);
            if (child.value === 0x1f43b675 || child.value === 0x1c53bb6b) { stop = q; break; }
            const size = vint(q + child.size);
            if (size.unknown) throw new Error('WebM có phần tử không xác định kích thước.');
            q += child.size + size.size + size.value;
            if (q > end) throw new Error('Cấu trúc WebM bị lỗi.');
          }
        }
        if (stop > end || stop <= p) throw new Error('Cấu trúc WebM bị lỗi.');
        result.push({ id: id.value, start: at, end: stop }); p = stop;
      }
      return result;
    };
    const number = (start: number, end: number) => { let n = 0; for (let p = start; p < end; p++) n = n * 256 + bytes[p]; return n; };
    const segment = elements(0, bytes.length).find(b => b.id === 0x18538067);
    if (!segment) throw new Error('WebM thiếu Segment.');
    const list = elements(segment.start, segment.end); let scale = 1000000;
    const info = list.find(b => b.id === 0x1549a966);
    if (info) { const unit = elements(info.start, info.end).find(b => b.id === 0x2ad7b1); if (unit) scale = number(unit.start, unit.end); }
    const definitions = list.find(b => b.id === 0x1654ae6b);
    if (definitions) for (const entry of elements(definitions.start, definitions.end).filter(b => b.id === 0xae)) {
      const fields = elements(entry.start, entry.end); const num = fields.find(b => b.id === 0xd7); const kind = fields.find(b => b.id === 0x83); const duration = fields.find(b => b.id === 0x23e383);
      if (num && kind) tracks.set(number(num.start, num.end), { kind: number(kind.start, kind.end) === 1 ? 'vide' : 'soun', scale: 1e9, end: 0, duration: duration ? number(duration.start, duration.end) : 50000000 });
    }
    for (const cluster of list.filter(b => b.id === 0x1f43b675)) {
      const fields = elements(cluster.start, cluster.end); const tc = fields.find(b => b.id === 0xe7); const base = tc ? number(tc.start, tc.end) : 0;
      for (const b of fields) {
        const group = b.id === 0xa0 ? elements(b.start, b.end) : [];
        const block = b.id === 0xa3 ? b : group.find(b => b.id === 0xa1); if (!block) continue;
        const id = vint(block.start); const track = tracks.get(id.value); if (!track) continue;
        const offset = view.getInt16(block.start + id.size); const explicit = group.find(b => b.id === 0x9b);
        const duration = explicit ? number(explicit.start, explicit.end) * scale : track.duration;
        track.end = Math.max(track.end, (base + offset) * scale + duration);
      }
    }
  } else throw new Error('Định dạng bản ghi chưa được hỗ trợ để kiểm tra thời lượng.');
  const video = [...tracks.values()].find(t => t.kind === 'vide');
  const audio = [...tracks.values()].find(t => t.kind === 'soun');
  if (!video || !audio || !video.scale || !audio.scale) throw new Error('Bản ghi thiếu track hình hoặc tiếng.');
  return { video: video.end / video.scale, audio: audio.end / audio.scale };
}

export function assertHtmlRecordingDurations(timings: { video: number; audio: number }, elapsed: number) {
  const { video, audio } = timings;
  if (![video, audio, elapsed].every(n => Number.isFinite(n) && n > 0) || Math.abs(video - audio) > 0.5 || Math.abs(video - elapsed) > 1 || Math.abs(audio - elapsed) > 1) {
    throw new Error('Thời lượng hình/tiếng không khớp với thời gian ghi thực tế. Đã hủy file lỗi; hãy giữ tab xuất ở phía trước và xuất lại.');
  }
}
