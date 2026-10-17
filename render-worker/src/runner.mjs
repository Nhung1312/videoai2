// Serialized into the lesson before any author script. No imports, network
// access, TTS, MediaRecorder, canvas rasterization or virtual clock here.
export function installRunner(config) {
  const events = [];
  const decoded = new Map();
  const sources = new Set();
  const counts = new Map();
  let state = 'BOOT';
  let failure = null;
  let context;
  let entry;
  let runPromise;
  let queued = 0;
  let queue = Promise.resolve();
  let animationDone = false;
  let releaseGate;
  let gateOpen = false;
  let lastDomChange = performance.now();
  let lastRaf = null;
  let maxRafGapMs = 0;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const event = (type, extra = {}) => {
    events.push({ type, atMs: performance.now(), audioTime: context?.currentTime ?? null, ...extra });
  };
  const transition = next => { state = next; event('state', { state }); };
  const fail = (code, error, cueId) => {
    if (!failure) {
      failure = { code, message: error?.message || String(error), ...(cueId ? { cueId } : {}) };
      transition('ERROR');
      event(code, { message: failure.message, cueId });
      for (const source of sources) { try { source.stop(); } catch {} }
    }
    return Object.assign(new Error(failure.message), { code: failure.code });
  };
  const check = () => { if (failure) throw Object.assign(new Error(failure.message), { code: failure.code }); };

  const onCue = id => {
    const cueId = String(id);
    queued++;
    const play = async () => {
      await gate;
      check();
      if (!decoded.has(cueId)) throw fail('audio-error', new Error('Thiếu Kore đã cache của cue: ' + cueId), cueId);
      if (context.state !== 'running') throw fail('audio-error', new Error('AudioContext không ở trạng thái running.'), cueId);
      const buffer = decoded.get(cueId);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = config.playbackRate;
      source.connect(context.destination);
      sources.add(source);
      counts.set(cueId, (counts.get(cueId) || 0) + 1);
      await new Promise((resolve, reject) => {
        const expectedEnd = context.currentTime + buffer.duration / config.playbackRate;
        const timer = setTimeout(() => {
          reject(fail('audio-error', new Error('Kore không kết thúc đúng hạn: ' + cueId), cueId));
        }, (buffer.duration / config.playbackRate + 5) * 1000);
        source.onended = () => {
          clearTimeout(timer);
          sources.delete(source);
          event('cue-end', { cueId, expectedEnd });
          if (failure) reject(Object.assign(new Error(failure.message), { code: failure.code }));
          else resolve();
        };
        try {
          event('cue-start', { cueId, duration: buffer.duration / config.playbackRate });
          source.start();
        } catch (error) {
          clearTimeout(timer);
          sources.delete(source);
          reject(fail('audio-error', error, cueId));
        }
      });
    };
    const next = queue.then(play);
    // Keep failure visible, but do not create a second unhandled rejection in
    // the housekeeping promise. The caller still receives the original error.
    queue = next.catch(error => { fail(error.code || 'audio-error', error, cueId); });
    return next.finally(() => { queued--; });
  };

  async function waitForDom() {
    const deadline = performance.now() + config.settleTimeoutMs;
    do {
      check();
      await sleep(75);
      const finite = document.getAnimations().filter(animation => {
        const timing = animation.effect?.getComputedTiming();
        return animation.playState === 'running' && Number.isFinite(timing?.endTime) && timing.endTime > 0;
      });
      if (performance.now() - lastDomChange >= 300 && finite.length === 0) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return;
      }
    } while (performance.now() < deadline);
    throw fail('render-error', new Error('DOM hoặc transition chưa ổn định sau khi animation kết thúc.'));
  }

  function wrapStart(original) {
    if (typeof original !== 'function') throw fail('render-error', new Error('startAnimation không phải hàm.'));
    if (original.__videoai2ServerWrapped) return original;
    const wrapped = function(...args) {
      if (runPromise) return runPromise;
      const receiver = this;
      runPromise = (async () => {
        await gate;
        check();
        transition('RUNNING');
        event('lesson-start');
        try {
          const result = await Reflect.apply(original, receiver, args);
          animationDone = true;
          event('animation-complete');
          transition('FINISHING');
          do { await queue; check(); await sleep(30); } while (queued > 0 || sources.size > 0);
          for (const id of config.requiredCueIds) if (!counts.has(id)) throw fail('audio-error', new Error('Bài kết thúc nhưng chưa phát cue: ' + id), id);
          await waitForDom();
          event('tail-start');
          await sleep(config.tailMs);
          check();
          if (queued || sources.size) throw fail('audio-error', new Error('Xuất hiện cue muộn trong đoạn cuối.'));
          event('lesson-complete');
          transition('COMPLETE');
          return result;
        } catch (error) {
          throw fail(error.code || 'lesson-error', error);
        }
      })();
      // HTML often starts from setTimeout/onload without awaiting the result.
      // Consume that unhandled branch without converting failure to success.
      runPromise.catch(() => {});
      return runPromise;
    };
    Object.defineProperty(wrapped, '__videoai2ServerWrapped', { value: true });
    entry = wrapped;
    return wrapped;
  }

  const api = {
    wrapStart,
    snapshot: () => ({ state, failure, queued, activeSources: sources.size, animationDone, maxRafGapMs, events: [...events], cueCounts: Object.fromEntries(counts), viewport: { width: innerWidth, height: innerHeight } }),
    prepare: async () => {
      transition('LOADING');
      try {
        if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
        if (window.MathJax?.startup?.promise) await window.MathJax.startup.promise;
        await document.fonts?.ready;
        for (const img of document.images) {
          if (!img.complete) await new Promise((resolve, reject) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', () => reject(new Error('Không tải được ảnh.')), { once: true }); });
          if (img.currentSrc && img.naturalWidth === 0) throw new Error('Ảnh không giải mã được.');
          if (img.decode && img.currentSrc) await img.decode();
        }
        await document.fonts?.ready;
        if (innerWidth !== 720 || innerHeight !== 1280) throw new Error('Viewport thực tế không phải 720×1280.');
        if (!entry) throw new Error('Không tìm thấy entry startAnimation đã được bọc.');
        context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
        await context.resume();
        for (const cue of config.cues) {
          const response = await fetch(cue.url);
          if (!response.ok) throw fail('audio-error', new Error('Thiếu Kore: ' + cue.id), cue.id);
          let buffer;
          try { buffer = await context.decodeAudioData(await response.arrayBuffer()); }
          catch (error) { throw fail('audio-error', error, cue.id); }
          let peak = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
          }
          if (!(buffer.duration > 0) || peak < 0.0001) throw fail('audio-error', new Error('Kore rỗng hoặc hoàn toàn im lặng: ' + cue.id), cue.id);
          decoded.set(cue.id, buffer);
          event('audio-decoded', { cueId: cue.id, duration: buffer.duration, peak });
        }
        context.addEventListener('statechange', () => {
          if (['RUNNING', 'FINISHING'].includes(state) && context.state !== 'running') fail('audio-error', new Error('AudioContext bị gián đoạn.'));
        });
        check();
        transition('READY');
      } catch (error) { throw fail(error.code || 'render-error', error); }
    },
    recordingReady: () => { check(); if (state !== 'READY') throw new Error('Runner chưa READY.'); transition('RECORDING_READY'); },
    start: () => {
      check();
      if (state !== 'RECORDING_READY' || gateOpen) throw new Error('Bộ ghi chưa sẵn sàng hoặc đã bắt đầu.');
      gateOpen = true;
      event('gate-release');
      releaseGate();
      // Also handles HTML whose entry is only attached to a visible button.
      void entry();
    },
    abort: message => { fail('render-error', new Error(message)); },
  };
  Object.defineProperty(globalThis, config.bridgeKey, { value: api, writable: false, configurable: false });
  Object.defineProperty(window, 'onNarrationCue', { value: onCue, writable: false, configurable: false });
  addEventListener('error', e => fail('lesson-error', e.error || new Error(e.message)));
  addEventListener('unhandledrejection', e => fail(e.reason?.code || 'lesson-error', e.reason));
  document.addEventListener('DOMContentLoaded', () => {
    // Existing export fitting code repeatedly updates style/zoom. Those writes
    // must not prevent finish forever. Finite CSS animations are checked above.
    new MutationObserver(() => { lastDomChange = performance.now(); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }, { once: true });
  event('state', { state });
  const heartbeat = now => {
    if (state === 'RUNNING') {
      if (lastRaf !== null) maxRafGapMs = Math.max(maxRafGapMs, now - lastRaf);
      lastRaf = now;
    } else lastRaf = null;
    if (!['COMPLETE', 'ERROR'].includes(state)) requestAnimationFrame(heartbeat);
  };
  requestAnimationFrame(heartbeat);
}

export function runnerPrelude(config) {
  return `<script data-videoai2-server-render>(${installRunner.toString()})(${JSON.stringify(config).replace(/</g, '\\u003c')});</script>`;
}
