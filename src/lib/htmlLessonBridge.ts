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
    .replace(/mờ/gi, 'em')
    .replace(
      /(ích\s+(?:một|hai|ba|bốn|năm|sáu|bảy|tám|chín|\d+))\s+bình(?!\s+phương)/gi,
      '$1 bình phương'
    )
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
})();
<\/script>
`;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${bridge}</head>`);
  }
  if (/<body[\s>]/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${bridge}`);
  }
  return bridge + html;
};
