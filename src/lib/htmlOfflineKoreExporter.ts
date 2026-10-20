import { prepareHtmlLessonSync } from './htmlLessonSync';

export interface EmbeddedKoreCue {
  id: string;
  mimeType: string;
  audioBase64: string;
}

const inlineJson = (value: unknown) =>
  JSON.stringify(value).replace(/<\//g, '<\\/');

/**
 * Builds a self-contained HTML lesson with Kore clips embedded as base64.
 *
 * No screen-capture or MediaRecorder logic is included. The exported HTML plays
 * narration itself, so the teacher can open it locally and use any normal
 * screen recorder. Animation timing remains controlled by the lesson's cue()
 * / withCue() calls because window.onNarrationCue resolves only after each Kore
 * clip finishes.
 */
export const buildOfflineKoreHtml = (
  html: string,
  cues: EmbeddedKoreCue[],
  playbackRate: number
): string => {
  html = prepareHtmlLessonSync(html);
  const payload = inlineJson(cues);
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;

  const bridge = `
<style data-videoai2-offline-kore-ui>
  html, body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    background: #000 !important;
    overflow: hidden !important;
  }
  body {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  .container {
    width: min(100vw, 56.25vh) !important;
    height: min(100vh, 177.7778vw) !important;
    aspect-ratio: 9 / 16 !important;
    max-width: none !important;
    margin: 0 auto !important;
    overflow: hidden !important;
  }

  #videoai2-kore-start {
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483647 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: #000 !important;
    color: #fff !important;
    font-family: Inter, Arial, sans-serif !important;
  }
  #videoai2-kore-start .card {
    width: min(460px, calc(100vw - 32px)) !important;
    padding: 24px !important;
    border-radius: 20px !important;
    background: #0f172a !important;
    border: 1px solid #334155 !important;
    box-shadow: 0 22px 70px rgba(0,0,0,.55) !important;
    text-align: center !important;
  }
  #videoai2-kore-start h2 {
    margin: 0 0 10px !important;
    font-size: 24px !important;
  }
  #videoai2-kore-start p {
    margin: 0 0 16px !important;
    color: #cbd5e1 !important;
    line-height: 1.55 !important;
    font-size: 14px !important;
  }
  #videoai2-kore-start button {
    width: 100% !important;
    border: 0 !important;
    border-radius: 13px !important;
    padding: 13px 16px !important;
    font: inherit !important;
    font-weight: 800 !important;
    color: #fff !important;
    background: linear-gradient(135deg,#7c3aed,#2563eb) !important;
    cursor: pointer !important;
  }
  #videoai2-kore-start .status {
    margin-top: 12px !important;
    color: #93c5fd !important;
    font-size: 13px !important;
    min-height: 20px !important;
  }
</style>
<script data-videoai2-offline-kore>
(() => {
  const CLIPS = ${payload};
  const PLAYBACK_RATE = ${rate};
  const clipMap = new Map(CLIPS.map((clip) => [clip.id, clip]));
  const decoded = new Map();

  let audioContext = null;
  let startResolve = null;
  let started = false;
  const startGate = new Promise((resolve) => { startResolve = resolve; });

  const base64ToArrayBuffer = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };

  const ensureAudio = async () => {
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext;
  };

  const decodeAll = async (onProgress) => {
    const ctx = await ensureAudio();
    for (let i = 0; i < CLIPS.length; i++) {
      const clip = CLIPS[i];
      if (!decoded.has(clip.id)) {
        const raw = base64ToArrayBuffer(clip.audioBase64);
        const buffer = await ctx.decodeAudioData(raw.slice(0));
        decoded.set(clip.id, buffer);
      }
      if (onProgress) onProgress(i + 1, CLIPS.length);
    }
  };

  window.onNarrationCue = async function(cueId) {
    await startGate;
    const ctx = await ensureAudio();
    let buffer = decoded.get(cueId);

    if (!buffer) {
      const clip = clipMap.get(cueId);
      if (!clip) throw new Error('Thiếu Kore cho cue: ' + cueId);
      buffer = await ctx.decodeAudioData(base64ToArrayBuffer(clip.audioBase64).slice(0));
      decoded.set(cueId, buffer);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = PLAYBACK_RATE;
    source.connect(ctx.destination);

    await new Promise((resolve, reject) => {
      source.onended = resolve;
      source.onerror = () => reject(new Error('Không phát được Kore: ' + cueId));
      try { source.start(); } catch (err) { reject(err); }
    });
  };

  // The shared entry gate also supports lexical const/arrow entry functions.
  window.__videoai2LessonSync.beforeStart = () => startGate;

  const installStartUi = () => {
    if (document.getElementById('videoai2-kore-start')) return;

    const overlay = document.createElement('div');
    overlay.id = 'videoai2-kore-start';
    overlay.innerHTML = \`
      <div class="card">
        <h2>HTML + Kore sẵn sàng</h2>
        <p>Bật quay màn hình của bạn trước. Sau đó bấm nút dưới đây để bài giảng bắt đầu từ đầu với tiếng Kore đồng bộ.</p>
        <button type="button">Bắt đầu bài giảng có tiếng</button>
        <div class="status">Đang chờ bạn bắt đầu...</div>
      </div>
    \`;

    document.body.appendChild(overlay);
    const button = overlay.querySelector('button');
    const status = overlay.querySelector('.status');

    const begin = async () => {
      if (started) return;
      started = true;
      button.disabled = true;

      try {
        await ensureAudio();
        await decodeAll((ready, total) => {
          status.textContent = 'Đang chuẩn bị Kore ' + ready + '/' + total + '...';
        });

        status.textContent = 'Bắt đầu...';
        overlay.remove();
        startResolve?.();
      } catch (err) {
        started = false;
        button.disabled = false;
        status.textContent = err?.message || 'Không chuẩn bị được tiếng Kore.';
      }
    };

    button.addEventListener('click', () => void begin());

    window.addEventListener('keydown', (event) => {
      if ((event.code === 'Space' || event.code === 'Enter') && !started) {
        event.preventDefault();
        void begin();
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installStartUi, { once: true });
  } else {
    installStartUi();
  }
})();
<\/script>
`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bridge}</body>`);
  }
  return html + bridge;
};
