import { inspectHtmlLessonSource, readHtmlCueManifest, stripHtmlCueManifest } from './htmlLessonSource';
import { prepareHtmlLessonSync } from './htmlLessonSync';

export interface HtmlNarrationCue {
  id: string;
  narration: string;
}

export interface HtmlLessonValidation {
  success: boolean;
  cues: HtmlNarrationCue[];
  error?: string;
}

export const validateHtmlLesson = (html: string): HtmlLessonValidation => {
  if (!html.trim()) {
    return { success: false, cues: [], error: 'Tệp HTML đang trống.' };
  }

  if (!/<html[\s>]/i.test(html) || !/<script[\s>]/i.test(html)) {
    return {
      success: false,
      cues: [],
      error: 'Đây chưa phải tệp HTML bài giảng hoàn chỉnh.',
    };
  }

  let inspection: ReturnType<typeof inspectHtmlLessonSource>;
  let manifest: string[] | null;
  try {
    inspection = inspectHtmlLessonSource(html);
    manifest = readHtmlCueManifest(html);
  } catch (error: any) {
    return { success: false, cues: [], error: error?.message || 'Không đọc được JavaScript của bài giảng.' };
  }
  if (!inspection.declared.length) return { success: false, cues: [], error: 'Không đọc được object narrationScript tĩnh trong HTML.' };
  if (!inspection.hasCueCalls) return { success: false, cues: [], error: 'HTML chưa gọi cue(...) hoặc withCue(...) trong animation.' };
  const ids = manifest ? new Set(manifest) : inspection.dynamic ? null : inspection.referenced;
  const cues = inspection.declared.filter(cue => !ids || ids.has(cue.id));
  if (!cues.length) return { success: false, cues: [], error: 'Animation chưa gọi cue lời đọc nào đã khai báo.' };

  return { success: true, cues };
};

export const normalizeHtmlNarration = (text: string): string =>
  text
    // Common Vietnamese math pronunciation cleanup for imported HTML narration.
    // Lowercase m is the algebra variable "mờ"; uppercase M as a geometry point is handled elsewhere.
    .replace(/\bPT\b/gi, 'phương trình')
    .replace(/\bPB\b/gi, 'phân biệt')
    .replace(/\bt\s*\/\s*m\b/gi, 'thỏa mãn')
    .replace(/(?:Δ|\\Delta)(?!\s*[A-Z]{1,4}\b)\s*['’′]/g, 'đen ta phẩy')
    .replace(/(?:Δ|\\Delta)(?!\s*[A-Z]{1,4}\b)/g, 'đen ta')
    .replace(/\b(?:đen[\s-]*ta|delta)\s*phẩy\b/gi, 'đen ta phẩy')
    .replace(/\b(?:đen[\s-]*ta|delta)\b/gi, 'đen ta')
    .replace(/x\s*[_₁]?1\b/gi, 'ích một')
    .replace(/x\s*[_₂]?2\b/gi, 'ích hai')
    .replace(/x₁/gi, 'ích một')
    .replace(/x₂/gi, 'ích hai')
    .replace(/(?<!\p{L})x(?!\p{L})/gu, 'ích')
    .replace(/m²/g, 'mờ bình phương')
    .replace(/\bm\s*\^\s*2\b/g, 'mờ bình phương')
    .replace(/(?<!\p{L})m(?!\p{L})/gu, 'mờ')
    .replace(/(?<!\p{L})b(?!\p{L})/gu, 'bê')
    .replace(/(?<!\p{L})c(?!\p{L})/gu, 'xê')
    .replace(
      /(ích\s+(?:một|hai|ba|bốn|năm|sáu|bảy|tám|chín|\d+))\s+(?:bình|bình\s*phương?)(?!\s+phương)/gi,
      '$1 bình phương'
    )
    .replace(/\bích\s+bình(?!\s+phương)/gi, 'ích bình phương')
    .replace(/\bmờ\s+bình(?!\s+phương)/gi, 'mờ bình phương')
    .replace(/\s+/g, ' ')
    .trim();

export const stableHtmlLessonId = (html: string): string => {
  let hash = 2166136261;
  const source = stripHtmlCueManifest(html);
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `html-${(hash >>> 0).toString(36)}`;
};

const inlineJson = (value: string) => JSON.stringify(value).replace(/<\//g, '<\\/');

export const injectHtmlNarrationBridge = (
  html: string,
  sessionId: string,
  lessonId: string
): string => {
  html = prepareHtmlLessonSync(html);
  const bridge = `
<script data-videoai2-narration-bridge>
(() => {
  const SESSION_ID = ${inlineJson(sessionId)};
  const LESSON_ID = ${inlineJson(lessonId)};
  let seq = 0;

  window.onNarrationCue = function(cueId, narration) {
    return new Promise((resolve, reject) => {
      const requestId = SESSION_ID + ':' + (++seq);

      const onMessage = (event) => {
        const data = event.data || {};
        if (event.source !== window.parent) return;
        if (
          data.source !== 'videoai2-html-host' ||
          data.sessionId !== SESSION_ID ||
          data.requestId !== requestId
        ) return;

        window.removeEventListener('message', onMessage);
        if (data.ok === false) reject(new Error(data.error || 'Không phát được giọng Kore.'));
        else resolve();
      };

      window.addEventListener('message', onMessage);
      window.parent.postMessage(
        {
          source: 'videoai2-html-lesson',
          type: 'narration-cue',
          sessionId: SESSION_ID,
          lessonId: LESSON_ID,
          requestId,
          cueId,
          narration
        },
        '*'
      );
    });
  };

  window.__videoai2LessonSync.onComplete = () => {
    window.parent.postMessage({
      source: 'videoai2-html-lesson',
      type: 'lesson-complete',
      sessionId: SESSION_ID,
      lessonId: LESSON_ID
    }, '*');
  };

})();
<\/script>
`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bridge}</body>`);
  }
  if (/<body[\s>]/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${bridge}`);
  }
  return html + bridge;
};


/**
 * Recording-only layout override for portrait lesson HTML.
 * Removes the original narrow 405px cap so the lesson fills a 9:16 capture frame.
 */
export const injectHtmlRecordingLayout = (html: string): string => {
  const style = `
<style data-videoai2-recording-layout>
  html, body {
    width: 100% !important;
    height: 100% !important;
    min-height: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
    background: #000 !important;
  }
  body {
    align-items: stretch !important;
    justify-content: stretch !important;
  }
  .container {
    width: 100% !important;
    max-width: none !important;
    height: 100% !important;
    margin: 0 !important;
    padding-bottom: 0 !important;
    border-left: 0 !important;
    border-right: 0 !important;
    box-shadow: none !important;
  }

  /* Preview controls must never cover lesson content in the recorded video. */
  .replay-btn,
  button[onclick*="reload"],
  button[onclick*="location.reload"],
  [data-videoai2-no-record] {
    display: none !important;
  }

  /* Recording must show real text, not a fade/mask that makes top/bottom lines
     look clipped. The active step is fitted by the script below. */
  .board {
    -webkit-mask-image: none !important;
    mask-image: none !important;
    overflow-y: hidden !important;
    padding-top: 6px !important;
    padding-bottom: 12px !important;
    scroll-behavior: auto !important;
  }
  #scroll-content {
    padding-top: 2px !important;
    padding-bottom: 10px !important;
  }
  .step-box {
    transform-origin: top left !important;
    scroll-margin-top: 6px !important;
    scroll-margin-bottom: 10px !important;
  }
  .final-ans {
    margin-bottom: 10px !important;
  }
</style>
<script data-videoai2-recording-scroll-fix>
(() => {
  const install = () => {
    const board = document.getElementById('board') || document.querySelector('.board');
    if (!board) return;

    let lastActive = null;
    let fitting = false;

    const isVisible = (el) => {
      if (!el) return false;
      const st = getComputedStyle(el);
      return (
        st.display !== 'none' &&
        st.visibility !== 'hidden' &&
        Number(st.opacity || 1) > 0.02 &&
        !el.classList.contains('collapse')
      );
    };

    const getVisibleSteps = () =>
      Array.from(
        board.querySelectorAll(
          '.step-box, [data-step], .solution-step, .lesson-step'
        )
      ).filter(isVisible);

    const fitAndScroll = () => {
      if (fitting) return;
      fitting = true;

      try {
        const steps = getVisibleSteps();
        const active = steps[steps.length - 1] || null;
        if (!active) {
          board.scrollTop = 0;
          return;
        }

        if (lastActive && lastActive !== active) {
          lastActive.style.zoom = '';
          lastActive.style.maxHeight = '';
        }
        lastActive = active;

        // Always measure the unscaled current step first.
        active.style.zoom = '';

        const safeHeight = Math.max(1, board.clientHeight - 18);
        const naturalHeight = Math.max(
          active.scrollHeight,
          active.getBoundingClientRect().height
        );

        if (naturalHeight > safeHeight) {
          // The former 0.82 floor was still too large for long generated steps.
          // Fit the whole active step, including its heading and final line.
          const zoom = Math.max(0.60, Math.min(1, safeHeight / naturalHeight));
          active.style.zoom = String(zoom);
        }

        // Put the TOP of the current step inside the board. Never auto-scroll to
        // the absolute bottom, which was hiding headings in steps 1, 3 and 4.
        const top = Math.max(0, active.offsetTop - 4);
        const maxTop = Math.max(0, board.scrollHeight - board.clientHeight);
        board.scrollTop = Math.min(top, maxTop);
      } finally {
        fitting = false;
      }
    };

    // Gemini lessons commonly call autoScroll() after every typed fragment.
    // Replace it for export; the MutationObserver below also corrects any
    // lexical/global binding that an individual HTML keeps internally.
    try {
      window.autoScroll = fitAndScroll;
    } catch {}

    const observer = new MutationObserver(() => {
      requestAnimationFrame(fitAndScroll);
    });

    observer.observe(board, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(fitAndScroll);
      });
      resizeObserver.observe(board);
    }

    // MathJax, web fonts and typewriter effects can change element height after
    // their DOM mutation. A light heartbeat keeps every generated step fitted.
    const timer = window.setInterval(fitAndScroll, 120);
    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => requestAnimationFrame(fitAndScroll)).catch(() => {});
    }

    requestAnimationFrame(fitAndScroll);
    window.setTimeout(fitAndScroll, 250);
    window.setTimeout(fitAndScroll, 900);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
<\/script>
`;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}</head>`);
  }
  return style + html;
};
