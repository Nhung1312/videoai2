import { inspectHtmlLessonSource, readHtmlCueManifest, stripHtmlCueManifest } from './htmlLessonSource.ts';
import { prepareHtmlLessonSync } from './htmlLessonSync.ts';

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

  if (typeof window.startAnimation === 'function') window.startAnimation = window.__videoai2LessonSync.wrapStart(window.startAnimation);
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


export { injectHtmlRecordingLayout } from './htmlRecordingLayout.ts';
