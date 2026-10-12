export interface HtmlNarrationCue {
  id: string;
  narration: string;
}

export interface HtmlLessonValidation {
  success: boolean;
  cues: HtmlNarrationCue[];
  error?: string;
}

const findNarrationObjectLiteral = (html: string): string | null => {
  const marker = /(?:const|let|var)\s+narrationScript\s*=\s*/g;
  const match = marker.exec(html);
  if (!match) return null;

  let i = marker.lastIndex;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] !== '{') return null;

  const start = i;
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (; i < html.length; i++) {
    const ch = html[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }

  return null;
};

const decodeQuotedString = (raw: string): string => {
  const quote = raw[0];
  const body = raw.slice(1, -1);

  if (quote === '"') {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through to conservative unescape.
    }
  }

  return body
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([\\'"`])/g, '$1');
};

const parseNarrationObject = (literal: string): HtmlNarrationCue[] => {
  try {
    const parsed = JSON.parse(literal) as Record<string, unknown>;
    return Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([id, narration]) => ({ id, narration: narration.trim() }))
      .filter((cue) => cue.id && cue.narration);
  } catch {
    // Gemini may use single quotes. Never eval HTML; parse only flat string:string pairs.
  }

  const cues: HtmlNarrationCue[] = [];
  const pairRegex =
    /(["'])(.*?)\1\s*:\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))\s*(?:,|$)/gs;

  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(literal))) {
    const id = match[2].trim();
    const narration = decodeQuotedString(match[3]).trim();
    if (id && narration) cues.push({ id, narration });
  }

  return cues;
};

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

  const literal = findNarrationObjectLiteral(html);
  if (!literal) {
    return {
      success: false,
      cues: [],
      error: 'Không tìm thấy object narrationScript trong HTML.',
    };
  }

  const cues = parseNarrationObject(literal);
  if (cues.length === 0) {
    return {
      success: false,
      cues: [],
      error: 'Có narrationScript nhưng chưa đọc được cue lời thoại nào.',
    };
  }

  if (!/\bcue\s*\(/.test(html)) {
    return {
      success: false,
      cues,
      error: 'HTML có narrationScript nhưng chưa có các mốc cue(...) trong animation.',
    };
  }

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
  for (let i = 0; i < html.length; i++) {
    hash ^= html.charCodeAt(i);
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

  const originalStart = window.startAnimation;
  if (typeof originalStart === 'function' && !originalStart.__videoai2Wrapped) {
    const wrappedStart = async function(...args) {
      try {
        return await originalStart.apply(this, args);
      } finally {
        window.parent.postMessage(
          {
            source: 'videoai2-html-lesson',
            type: 'lesson-complete',
            sessionId: SESSION_ID,
            lessonId: LESSON_ID
          },
          '*'
        );
      }
    };

    wrappedStart.__videoai2Wrapped = true;
    window.startAnimation = wrappedStart;
  }
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
    border-left: 0 !important;
    border-right: 0 !important;
    box-shadow: none !important;
  }
</style>
`;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}</head>`);
  }
  return style + html;
};
