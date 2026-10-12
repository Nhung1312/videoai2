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

const decodeJsQuotedString = (raw: string): string => {
  const quote = raw[0];
  const body = raw.slice(1, -1);

  if (quote === '"') {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through to conservative unescape below.
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
    // Generated HTML may use single quotes. Parse only flat string:string pairs;
    // never eval arbitrary user HTML in the parent application.
  }

  const cues: HtmlNarrationCue[] = [];
  const pairRegex = /(["'])(.*?)\1\s*:\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))\s*(?:,|$)/gs;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(literal))) {
    const id = match[2].trim();
    const narration = decodeJsQuotedString(match[3]).trim();
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
    // Gemini sometimes writes the variable m as “mờ”; Kore should say “em”.
    .replace(/mờ/gi, 'em')
    // “x một bình” is a common generated shorthand; speak the full math phrase.
    .replace(/(ích\s+(?:một|hai|ba|bốn|năm|sáu|bảy|tám|chín|\d+))\s+bình(?!\s+phương)/gi, '$1 bình phương')
    .replace(/\s+/g, ' ')
    .trim();

export const stableHtmlLessonId = (html: string): string => {
  // Small deterministic FNV-1a style hash. Stable IDs preserve Kore cache across replay/F5.
  let hash = 2166136261;
  for (let i = 0; i < html.length; i++) {
    hash ^= html.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `html-${(hash >>> 0).toString(36)}`;
};

const escapeForInlineScript = (value: string) =>
  JSON.stringify(value).replace(/<\//g, '<\\/');

export const injectHtmlNarrationBridge = (
  html: string,
  sessionId: string,
  lessonId: string
): string => {
  const bridge = `\n<script data-videoai2-narration-bridge>\n(() => {\n  const SESSION_ID = ${escapeForInlineScript(sessionId)};\n  const LESSON_ID = ${escapeForInlineScript(lessonId)};\n  let seq = 0;\n\n  window.onNarrationCue = function(cueId, narration) {\n    return new Promise((resolve, reject) => {\n      const requestId = SESSION_ID + ':' + (++seq);\n      const onMessage = (event) => {\n        const data = event.data || {};\n        if (data.source !== 'videoai2-html-host' || data.sessionId !== SESSION_ID || data.requestId !== requestId) return;\n        window.removeEventListener('message', onMessage);\n        if (data.ok === false) reject(new Error(data.error || 'Không phát được lời đọc Kore.'));\n        else resolve();\n      };\n      window.addEventListener('message', onMessage);\n      window.parent.postMessage({\n        source: 'videoai2-html-lesson',\n        type: 'narration-cue',\n        sessionId: SESSION_ID,\n        lessonId: LESSON_ID,\n        requestId,\n        cueId,\n        narration\n      }, '*');\n    });\n  };\n})();\n<\/script>\n`;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${bridge}</head>`);
  }
  if (/<body[\s>]/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${bridge}`);
  }
  return bridge + html;
};
