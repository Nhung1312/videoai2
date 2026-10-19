import katex from 'katex';
import { parseMixedMathSegments, mathToCanvasText } from './mixedMathText';
import { getMixedSegmentsByProgress } from './mathReveal';

/**
 * Canvas Math & Text Renderer
 * Renders mathematical formulas, LaTeX tokens, fractions, radicals,
 * powers, equation chains and formatted Vietnamese text onto Canvas 2D.
 */

export interface RenderTextOptions {
  x: number;
  y: number;
  maxWidth?: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  lineHeight?: number;
  revealProgress?: number; // 0 to 1 for progressive typewriter
  align?: 'left' | 'center' | 'right';
  showCursor?: boolean;
}

/**
 * Draws rounded rectangle on Canvas 2D
 */
export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number | number[],
  fillColor?: string,
  strokeColor?: string,
  lineWidth = 1
) {
  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    // Fallback if roundRect is not supported
    const r = typeof radius === 'number' ? radius : radius[0] || 0;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Cleanly wraps text into lines respecting word boundaries
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Converts standard LaTeX tokens to readable Unicode math symbols for canvas rendering
 */
export function cleanLatexForCanvas(latex: string): string {
  return mathToCanvasText(latex);
}

/**
 * Draws a single mathematical expression (or fraction / equation) onto Canvas 2D
 */
export function drawMathExpression(
  ctx: CanvasRenderingContext2D,
  latex: string,
  x: number,
  y: number,
  fontSize = 20,
  color = '#0f172a',
  align: 'left' | 'center' | 'right' = 'left',
  revealProgress = 1
): { width: number; height: number } {
  ctx.save();
  const fontBase = `bold ${fontSize}px "KaTeX_Math", "Cambria Math", "STIX Two Math", "Times New Roman", serif`;
  ctx.font = fontBase;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';

  // If fraction: e.g. \frac{a}{b}
  const fracMatch = latex.match(/^\\frac\{([^}]+)\}\{([^}]+)\}$/);
  if (fracMatch) {
    const numText = cleanLatexForCanvas(fracMatch[1]);
    const denText = cleanLatexForCanvas(fracMatch[2]);

    const numFont = `bold ${Math.round(fontSize * 0.85)}px "KaTeX_Math", "Cambria Math", serif`;
    const denFont = numFont;

    ctx.font = numFont;
    const numWidth = ctx.measureText(numText).width;
    const denWidth = ctx.measureText(denText).width;
    const barWidth = Math.max(numWidth, denWidth) + 12;

    let startX = x;
    if (align === 'center') startX = x - barWidth / 2;
    else if (align === 'right') startX = x - barWidth;

    // Numerator
    ctx.fillText(numText, startX + (barWidth - numWidth) / 2, y - fontSize * 0.55);

    // Fraction bar
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, fontSize * 0.08);
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + barWidth, y);
    ctx.stroke();

    // Denominator
    ctx.font = denFont;
    ctx.fillText(denText, startX + (barWidth - denWidth) / 2, y + fontSize * 0.55);

    ctx.restore();
    return { width: barWidth, height: fontSize * 2 };
  }

  // Share both semantic runs and reveal with the mixed-line renderer.
  const segments = parseMixedMathSegments(latex);
  const revealed = getMixedSegmentsByProgress(segments, revealProgress).revealedSegments;
  const fullBoxes = segments.map(segment => segment.type === 'math'
    ? mathBox(ctx, segment.content, fontSize)
    : glyphBox(ctx, segment.content, proseFont(fontSize), fontSize));
  const full = rowBox(fullBoxes);
  const baseline = y + (full.ascent - full.descent) / 2;
  let drawX = align === 'center' ? x - full.width / 2 : align === 'right' ? x - full.width : x;
  ctx.textBaseline = 'alphabetic';
  revealed.forEach((item, i) => {
    if (item.revealedContent) {
      const visible = item.segment.type === 'math'
        ? mathBox(ctx, item.revealedContent, fontSize)
        : glyphBox(ctx, item.revealedContent, proseFont(fontSize), fontSize);
      visible.draw(ctx, drawX, baseline);
    }
    drawX += fullBoxes[i].width;
  });
  ctx.restore();
  return { width: full.width, height: Math.max(fontSize * 1.4, full.ascent + full.descent) };
}

/**
 * Draws multi-line math equation derivations on Canvas with highlighting
 */
export function drawMathEquationChain(
  ctx: CanvasRenderingContext2D,
  latexLines: string[],
  x: number,
  y: number,
  maxWidth: number,
  highlightedLineIndex?: number,
  fontSize = 18,
  revealProgress = 1
): number {
  let currentY = y;
  const lineSpacing = fontSize * 1.8;

  latexLines.forEach((line, idx) => {
    const isHighlighted = idx === highlightedLineIndex;
    const isCurrentRevealing =
      revealProgress < 1 &&
      idx === Math.min(latexLines.length - 1, Math.floor(revealProgress * latexLines.length));

    // Background card for highlighted line
    if (isHighlighted) {
      drawRoundedRect(
        ctx,
        x - 12,
        currentY - fontSize * 0.9,
        maxWidth + 24,
        fontSize * 1.8,
        8,
        'rgba(14, 165, 233, 0.12)',
        'rgba(14, 165, 233, 0.4)',
        1.5
      );
    }

    // Line number badge: (1), (2), (3)...
    ctx.save();
    ctx.font = `600 ${Math.round(fontSize * 0.75)}px sans-serif`;
    ctx.fillStyle = isHighlighted ? '#0284c7' : '#94a3b8';
    ctx.textBaseline = 'middle';
    ctx.fillText(`(${idx + 1})`, x, currentY);
    ctx.restore();

    // Equation content
    const eqX = x + fontSize * 1.8;
    const color = isHighlighted ? '#0369a1' : '#1e293b';

    let localReveal = 1;
    if (revealProgress < 1) {
      const stepPortion = 1 / latexLines.length;
      const stepStart = idx * stepPortion;
      const stepEnd = (idx + 1) * stepPortion;
      if (revealProgress < stepStart) {
        currentY += lineSpacing;
        return; // not yet reached
      }
      localReveal = Math.min(1, Math.max(0, (revealProgress - stepStart) / stepPortion));
    }

    drawMathExpression(ctx, line, eqX, currentY, fontSize, color, 'left', localReveal);

    currentY += lineSpacing;
  });

  return currentY;
}

interface CanvasBox {
  width: number;
  ascent: number;
  descent: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, baseline: number) => void;
}

const MATH_LAYOUT_CACHE = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasBox>>();
const proseFont = (size: number) => `400 ${size}px "Segoe UI", Arial, "Noto Sans", sans-serif`;
const mathFont = (size: number, italic = false) => `${italic ? 'italic ' : ''}400 ${size}px "${italic ? 'KaTeX_Math' : 'KaTeX_Main'}", "Cambria Math", "STIX Two Math", serif`;

function glyphBox(ctx: CanvasRenderingContext2D, text: string, font: string, size: number): CanvasBox {
  ctx.font = font;
  const m = ctx.measureText(text);
  const hasMetrics = Number.isFinite(m.actualBoundingBoxAscent) && Number.isFinite(m.actualBoundingBoxDescent);
  return {
    width: m.width,
    ascent: hasMetrics ? Math.max(0, m.actualBoundingBoxAscent) : size * 0.8,
    descent: hasMetrics ? Math.max(0, m.actualBoundingBoxDescent) : size * 0.2,
    draw: (c, x, baseline) => { c.font = font; c.fillText(text, x, baseline); },
  };
}

function rowBox(boxes: CanvasBox[]): CanvasBox {
  return {
    width: boxes.reduce((sum, b) => sum + b.width, 0),
    ascent: Math.max(0, ...boxes.map(b => b.ascent)),
    descent: Math.max(0, ...boxes.map(b => b.descent)),
    draw: (c, x, baseline) => { for (const b of boxes) { b.draw(c, x, baseline); x += b.width; } },
  };
}

/** KaTeX handles mathematical syntax; this adapter paints its MathML layout.
 * It does not classify mixed prose/math, decide reveal timing, or change presentation state.
 * Fractions, roots and scripts retain their structure instead of losing braces/backslashes.
 */
function mathBox(ctx: CanvasRenderingContext2D, latex: string, size: number): CanvasBox {
  let cache = MATH_LAYOUT_CACHE.get(ctx);
  if (!cache) { cache = new Map(); MATH_LAYOUT_CACHE.set(ctx, cache); }
  const fontState = typeof document !== 'undefined' ? document.fonts?.status : '';
  const key = `${fontState}|${size}|${latex}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const layout = (node: Element, fontSize: number): CanvasBox => {
    const children = Array.from(node.children);
    const tag = node.localName;
    if (tag === 'annotation') return rowBox([]);
    if (tag === 'mi' || tag === 'mn' || tag === 'mo' || tag === 'mtext') {
      const text = node.textContent || '';
      const font = tag === 'mtext' ? proseFont(fontSize) : mathFont(fontSize, tag === 'mi' && node.getAttribute('mathvariant') !== 'normal');
      const box = glyphBox(ctx, text, font, fontSize);
      // Natural operator spacing, independent of author-supplied TeX whitespace.
      const pad = tag === 'mo' && /^[=+−\-×÷·⊥∥⇒⇔<>≤≥≠≈±∈]$/.test(text) ? fontSize * 0.16 : 0;
      return { ...box, width: box.width + 2 * pad, draw: (c, x, b) => box.draw(c, x + pad, b) };
    }
    if (tag === 'mspace') {
      const value = node.getAttribute('width') || '0';
      const width = Math.max(0, parseFloat(value) * (value.endsWith('em') ? fontSize : 1) || 0);
      return { width, ascent: 0, descent: 0, draw: () => {} };
    }
    if (tag === 'mfrac' && children.length >= 2) {
      const num = layout(children[0], fontSize * 0.82);
      const den = layout(children[1], fontSize * 0.82);
      const pad = fontSize * 0.15;
      const width = Math.max(num.width, den.width) + 2 * pad;
      const axis = -fontSize * 0.25;
      const gap = fontSize * 0.18;
      const numY = axis - gap - num.descent;
      const denY = axis + gap + den.ascent;
      return {
        width, ascent: Math.max(0, num.ascent - numY), descent: Math.max(0, den.descent + denY),
        draw: (c, x, b) => {
          num.draw(c, x + (width - num.width) / 2, b + numY);
          den.draw(c, x + (width - den.width) / 2, b + denY);
          if (node.getAttribute('linethickness') !== '0px') {
            c.beginPath(); c.strokeStyle = c.fillStyle; c.lineWidth = Math.max(1, fontSize * 0.055);
            c.moveTo(x, b + axis); c.lineTo(x + width, b + axis); c.stroke();
          }
        },
      };
    }
    if ((tag === 'msup' || tag === 'msub' || tag === 'msubsup') && children.length >= 2) {
      const base = layout(children[0], fontSize);
      const sub = tag === 'msup' ? undefined : layout(children[1], fontSize * 0.7);
      const sup = tag === 'msub' ? undefined : layout(children[tag === 'msubsup' ? 2 : 1], fontSize * 0.7);
      const supY = -Math.max(fontSize * 0.52, base.ascent * 0.7);
      const subY = Math.max(fontSize * 0.28, base.descent + fontSize * 0.13);
      const gap = fontSize * 0.045;
      return {
        width: base.width + gap + Math.max(sub?.width || 0, sup?.width || 0),
        ascent: Math.max(base.ascent, sup ? sup.ascent - supY : 0),
        descent: Math.max(base.descent, sub ? sub.descent + subY : 0),
        draw: (c, x, b) => {
          base.draw(c, x, b); sub?.draw(c, x + base.width + gap, b + subY); sup?.draw(c, x + base.width + gap, b + supY);
        },
      };
    }
    if (tag === 'msqrt' || tag === 'mroot') {
      const content = tag === 'mroot' ? layout(children[0], fontSize) : rowBox(children.map(n => layout(n, fontSize)));
      const root = glyphBox(ctx, '√', mathFont(fontSize), fontSize);
      const index = tag === 'mroot' && children[1] ? layout(children[1], fontSize * 0.55) : undefined;
      const indexW = index ? index.width * 0.65 : 0;
      const barY = -Math.max(content.ascent + fontSize * 0.12, root.ascent);
      return {
        width: indexW + root.width + content.width + fontSize * 0.08,
        ascent: Math.max(-barY + 1, index ? index.ascent + fontSize * 0.48 : 0), descent: Math.max(root.descent, content.descent),
        draw: (c, x, b) => {
          index?.draw(c, x, b - fontSize * 0.48); root.draw(c, x + indexW, b); content.draw(c, x + indexW + root.width, b);
          c.beginPath(); c.strokeStyle = c.fillStyle; c.lineWidth = Math.max(1, fontSize * 0.045);
          c.moveTo(x + indexW + root.width * 0.8, b + barY); c.lineTo(x + indexW + root.width + content.width, b + barY); c.stroke();
        },
      };
    }
    if ((tag === 'mover' || tag === 'munder') && children.length >= 2) {
      const base = layout(children[0], fontSize);
      const accentText = children[1].textContent || '';
      // Geometry angles retain the shared Canvas representation ∠ABC.
      if (tag === 'mover' && accentText === '^' && /^[A-Z]{2,}$/.test(children[0].textContent || '')) {
        return rowBox([glyphBox(ctx, '∠', mathFont(fontSize), fontSize), base]);
      }
      const accent = layout(children[1], fontSize * 0.85);
      const above = tag === 'mover';
      const offset = above ? -base.ascent - accent.descent - fontSize * 0.08 : base.descent + accent.ascent + fontSize * 0.08;
      const width = Math.max(base.width, accent.width);
      return {
        width, ascent: above ? Math.max(base.ascent, accent.ascent - offset) : base.ascent,
        descent: above ? base.descent : Math.max(base.descent, accent.descent + offset),
        draw: (c, x, b) => { base.draw(c, x + (width - base.width) / 2, b); accent.draw(c, x + (width - accent.width) / 2, b + offset); },
      };
    }
    if (tag === 'mtable') {
      const rows = children.map(row => rowBox(Array.from(row.children).map(cell => layout(cell, fontSize))));
      const gap = fontSize * 0.35;
      const total = rows.reduce((sum, row) => sum + row.ascent + row.descent + gap, 0) - gap;
      const ascent = Math.max(0, total / 2 + fontSize * 0.25);
      return {
        width: Math.max(0, ...rows.map(row => row.width)), ascent, descent: Math.max(0, total - ascent),
        draw: (c, x, b) => { let top = b - ascent; for (const row of rows) { row.draw(c, x, top + row.ascent); top += row.ascent + row.descent + gap; } },
      };
    }
    const rowNodes = children.filter(n => n.localName !== 'annotation');
    const row = rowNodes.map(n => layout(n, fontSize));
    // Stretch braces/parentheses beside a fraction or a multi-row system.
    const isDelimiter = (n: Element) => n.localName === 'mo' && n.getAttribute('stretchy') !== 'false' && /^[()[\]{}|]$/.test(n.textContent || '');
    const contentBoxes = row.filter((_b, i) => !isDelimiter(rowNodes[i]));
    const contentAscent = Math.max(0, ...contentBoxes.map(b => b.ascent));
    const contentDescent = Math.max(0, ...contentBoxes.map(b => b.descent));
    return rowBox(row.map((box, i) => {
      const node = rowNodes[i];
      const height = box.ascent + box.descent;
      if (!isDelimiter(node) || !height || contentAscent + contentDescent < height * 1.2) return box;
      const scale = (contentAscent + contentDescent) / height;
      const offset = box.ascent * scale - contentAscent;
      return {
        width: box.width, ascent: contentAscent, descent: contentDescent,
        draw: (c, x, b) => { c.save(); c.translate(x, b + offset); c.scale(1, scale); box.draw(c, 0, 0); c.restore(); },
      };
    }));
  };

  let result: CanvasBox;
  try {
    const html = katex.renderToString(latex, { output: 'mathml', throwOnError: true });
    const doc = new DOMParser().parseFromString(html, 'application/xml');
    const root = doc.querySelector('math');
    if (!root) throw new Error('MathML unavailable');
    result = layout(root, size);
  } catch {
    result = glyphBox(ctx, mathToCanvasText(latex), mathFont(size), size);
  }
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

/** Shared semantic runs and reveal progress; full layout is measured before drawing
 * so new characters never move an existing baseline or change wrapping mid-line.
 */
export function drawMixedMathLine(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize = 17,
  color = '#0f172a',
  revealProgress = 1,
  isHighlighted = false
): number {
  if (!rawText || revealProgress <= 0 || maxWidth <= 0) return 0;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const segments = parseMixedMathSegments(rawText);
  const revealed = getMixedSegmentsByProgress(segments, revealProgress).revealedSegments;
  const textSize = fontSize;
  const textFont = proseFont(textSize);
  interface Token { full: CanvasBox; visible?: CanvasBox; space?: boolean; newline?: boolean }
  const tokens: Token[] = [];

  const fitBox = (box: CanvasBox, scale: number): CanvasBox => ({
    width: box.width * scale, ascent: box.ascent * scale, descent: box.descent * scale,
    draw: (c, px, baseline) => {
      c.save(); c.translate(px, baseline); c.scale(scale, scale); box.draw(c, 0, 0); c.restore();
    },
  });
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const visible = revealed[index].revealedContent;
    if (segment.type === 'math') {
      const full = mathBox(ctx, segment.content, fontSize);
      // An indivisible formula can fit a narrow portrait board without clipping.
      const scale = full.width > maxWidth ? maxWidth / full.width : 1;
      tokens.push({ full: fitBox(full, scale), visible: visible ? fitBox(mathBox(ctx, visible, fontSize), scale) : undefined });
      continue;
    }
    let offset = 0;
    for (const word of segment.content.split(/(\n|[^\S\n]+)/)) {
      if (!word) continue;
      if (word === '\n') { tokens.push({ full: rowBox([]), newline: true }); offset++; continue; }
      const full = glyphBox(ctx, word, textFont, textSize);
      const visibleWord = visible.slice(offset, offset + word.length);
      const space = /^\s+$/.test(word);
      if (!space && full.width > maxWidth) {
        // Match break-words for very long prose, preserving the shared reveal prefix.
        let chunk = '';
        let chunkStart = 0;
        for (const char of Array.from(word)) {
          if (chunk && glyphBox(ctx, chunk + char, textFont, textSize).width > maxWidth) {
            const piece = visibleWord.slice(chunkStart, chunkStart + chunk.length);
            tokens.push({ full: glyphBox(ctx, chunk, textFont, textSize), visible: piece ? glyphBox(ctx, piece, textFont, textSize) : undefined });
            chunkStart += chunk.length; chunk = '';
          }
          chunk += char;
        }
        if (chunk) {
          const piece = visibleWord.slice(chunkStart, chunkStart + chunk.length);
          tokens.push({ full: glyphBox(ctx, chunk, textFont, textSize), visible: piece ? glyphBox(ctx, piece, textFont, textSize) : undefined });
        }
      } else tokens.push({ full, visible: visibleWord ? glyphBox(ctx, visibleWord, textFont, textSize) : undefined, space });
      offset += word.length;
    }
  }

  const lines: Token[][] = [];
  let line: Token[] = [];
  let lineWidth = 0;
  const finishLine = () => {
    while (line[line.length - 1]?.space) line.pop();
    lines.push(line); line = []; lineWidth = 0;
  };
  for (const token of tokens) {
    if (token.newline) { finishLine(); continue; }
    if (token.space && line.length === 0) continue;
    if (!token.space && line.length && lineWidth + token.full.width > maxWidth + 0.01) finishLine();
    line.push(token); lineWidth += token.full.width;
  }
  if (line.length) finishLine();
  if (!lines.length) { ctx.restore(); return 0; }

  const metrics = lines.map(items => {
    const ascent = Math.max(textSize * 0.8, ...items.map(t => t.full.ascent));
    const descent = Math.max(textSize * 0.2, ...items.map(t => t.full.descent));
    const height = Math.max(Math.round(fontSize * 1.55), ascent + descent + fontSize * 0.32);
    return { ascent, descent, height };
  });
  const totalHeight = metrics.reduce((sum, m) => sum + m.height, 0);
  if (isHighlighted) {
    drawRoundedRect(ctx, x - 6, y - 2, maxWidth + 12, totalHeight + 4, 6,
      'rgba(14, 165, 233, 0.08)', 'rgba(14, 165, 233, 0.35)', 1.5);
  }

  ctx.fillStyle = color;
  let top = y;
  lines.forEach((items, index) => {
    const m = metrics[index];
    const baseline = top + m.ascent + (m.height - m.ascent - m.descent) / 2;
    let currentX = x;
    for (const token of items) {
      token.visible?.draw(ctx, currentX, baseline);
      currentX += token.full.width;
    }
    top += m.height;
  });
  ctx.restore();
  return totalHeight;
}
