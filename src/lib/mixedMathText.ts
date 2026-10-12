/** The only mixed prose/math parser, shared by React and Canvas. No DOM or timers. */
export interface MathSegment {
  type: 'text' | 'math';
  content: string;
  displayMode?: boolean;
}

type Atom = { type: 'text' | 'math' | 'space' | 'punct'; content: string; displayMode?: boolean };
const LETTER = /[\p{L}\p{M}]/u;
const MATH_SYMBOL = /[=+\-*/<>≤≥≠≈±×÷·⋅⊥∥⇒⇔→↔∠°√∈∉∞^_]/u;

function escapedAt(source: string, index: number): boolean {
  let slashes = 0;
  while (index > 0 && source[--index] === '\\') slashes++;
  return slashes % 2 === 1;
}

function groupEnd(source: string, start: number): number {
  const open = source[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (escapedAt(source, i)) continue;
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0) return i + 1;
  }
  return -1;
}

function readCommand(source: string, start: number): { end: number; name: string; text?: string } {
  const match = /^\\(?:[a-zA-Z]+|[^a-zA-Z])/u.exec(source.slice(start));
  if (!match) return { end: start + 1, name: '\\' };
  const name = match[0];
  let end = start + name.length;
  let firstArgument: string | undefined;
  while (end < source.length) {
    const next = /^\s*/u.exec(source.slice(end))![0].length + end;
    if (source[next] !== '{' && source[next] !== '[') break;
    const close = groupEnd(source, next);
    if (close < 0) break;
    if (firstArgument === undefined && source[next] === '{') {
      firstArgument = source.slice(next + 1, close - 1);
    }
    end = close;
  }
  return { end, name, text: name === '\\text' ? firstArgument : undefined };
}

/** Canonical symbols have the same meaning in KaTeX and the Canvas adapter. */
export function normalizeMathSource(source: string): string {
  const symbols: Record<string, string> = {
    '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ', '→': '\\rightarrow ', '↔': '\\leftrightarrow ',
    '⊥': '\\perp ', '∥': '\\parallel ', '∠': '\\angle ', '≤': '\\leq ', '≥': '\\geq ',
    '≠': '\\neq ', '≈': '\\approx ', '±': '\\pm ', '×': '\\times ', '÷': '\\div ',
    '·': '\\cdot ', '⋅': '\\cdot ', '∈': '\\in ', '∉': '\\notin ', '∞': '\\infty ',
    '°': '^{\\circ}',
  };
  return source.replace(/[⇒⇔→↔⊥∥∠≤≥≠≈±×÷·⋅∈∉∞°]/gu, c => symbols[c])
    .replace(/[ \t]+/g, ' ').trim();
}

function scan(source: string, explicitMath = false, displayMode = false): Atom[] {
  const atoms: Atom[] = [];
  let i = 0;
  while (i < source.length) {
    // Explicit delimiters take precedence; escaped dollars remain literal prose.
    const opener = !explicitMath && !escapedAt(source, i)
      ? (source.startsWith('$$', i) ? '$$' : source[i] === '$' ? '$'
        : source.startsWith('\\(', i) ? '\\(' : source.startsWith('\\[', i) ? '\\[' : '') : '';
    if (opener) {
      const closer = opener === '\\(' ? '\\)' : opener === '\\[' ? '\\]' : opener;
      let close = source.indexOf(closer, i + opener.length);
      while (close >= 0 && escapedAt(source, close)) close = source.indexOf(closer, close + closer.length);
      if (close >= 0) {
        atoms.push(...scan(source.slice(i + opener.length, close), true, opener === '$$' || opener === '\\['));
        i = close + closer.length;
        continue;
      }
      atoms.push({ type: 'text', content: opener });
      i += opener.length;
      continue;
    }
    if (/\s/u.test(source[i])) {
      const start = i++;
      while (i < source.length && /\s/u.test(source[i])) i++;
      atoms.push({ type: 'space', content: source.slice(start, i).replace(/[ \t]+/g, ' '), displayMode });
      continue;
    }
    if (source[i] === '\\') {
      const command = readCommand(source, i);
      if (command.text !== undefined) {
        atoms.push({ type: 'text', content: command.text.replace(/(?<!\\)[{}]/g, '').replace(/\\([%$&#_{}])/g, '$1') });
      } else if (!explicitMath && /^\\[%$&#{}]$/.test(command.name)) {
        atoms.push({ type: 'text', content: command.name.slice(1) });
      } else {
        atoms.push({ type: 'math', content: source.slice(i, command.end), displayMode });
      }
      i = command.end;
      continue;
    }
    if (LETTER.test(source[i])) {
      const start = i++;
      while (i < source.length && LETTER.test(source[i])) i++;
      const word = source.slice(start, i);
      const math = explicitMath || /^[A-Z]+$/.test(word) || /^[a-z]$/.test(word) || /^[α-ωΑ-Ω]+$/u.test(word);
      atoms.push({ type: math ? 'math' : 'text', content: word, displayMode });
      continue;
    }
    if (/\d/.test(source[i])) {
      const number = /^\d+(?:[.,]\d+)?/u.exec(source.slice(i))![0];
      atoms.push({ type: 'math', content: number, displayMode });
      i += number.length;
      continue;
    }
    atoms.push({ type: explicitMath || MATH_SYMBOL.test(source[i]) ? 'math' : 'punct', content: source[i], displayMode });
    i++;
  }
  return atoms;
}

export function parseMixedMathSegments(rawText: string): MathSegment[] {
  if (!rawText) return [];
  const atoms = scan(rawText.replace(/\r\n?/g, '\n'));
  // Punctuation in a pure formula belongs to the formula. In prose, parentheses
  // follow their enclosed content so '(đpcm)' is never styled as mathematics.
  const hasProse = atoms.some(a => a.type === 'text' && /\p{L}/u.test(a.content));
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i].type !== 'punct') continue;
    const char = atoms[i].content;
    const next = atoms.slice(i + 1).find(a => a.type !== 'space' && a.type !== 'punct');
    const prev = atoms.slice(0, i).reverse().find(a => a.type !== 'space' && a.type !== 'punct');
    atoms[i].type = !hasProse || (/[([{]/.test(char) && next?.type === 'math') ||
      (/[)\]}]/.test(char) && prev?.type === 'math') ? 'math' : 'text';
  }

  const runs: MathSegment[] = [];
  let pendingSpace = '';
  const append = (type: 'text' | 'math', content: string, displayMode = false) => {
    if (!content) return;
    const prev = runs[runs.length - 1];
    if (prev?.type === type && (type === 'text' || !!prev.displayMode === displayMode)) prev.content += content;
    else runs.push({ type, content, ...(type === 'math' ? { displayMode } : {}) });
  };
  for (const atom of atoms) {
    if (atom.type === 'space') { pendingSpace += atom.content; continue; }
    const type = atom.type === 'math' ? 'math' : 'text';
    const prev = runs[runs.length - 1];
    if (pendingSpace) {
      if (type === 'text') {
        // TeX ignores its structural whitespace beside \text; its argument owns
        // the visible gap. Plain prose still retains a natural single space.
        if (!/^\s/.test(atom.content)) append('text', pendingSpace);
      } else if (prev?.type === 'text') {
        if (!/\s$/.test(prev.content)) append('text', pendingSpace);
      } else if (prev?.type === 'math' && !pendingSpace.includes('\n')) {
        append('math', pendingSpace, !!prev.displayMode);
      } else if (pendingSpace.includes('\n')) append('text', pendingSpace);
    }
    pendingSpace = '';
    append(type, atom.content, !!atom.displayMode);
  }
  if (pendingSpace && runs[runs.length - 1]?.type === 'text') append('text', pendingSpace);
  return runs.filter(r => r.content.length > 0).map(r => r.type === 'math'
    ? { ...r, content: normalizeMathSource(r.content) } : r);
}

/** Unicode fallback for Canvas glyphs; unsupported commands stay visible. */
export function mathToCanvasText(latex: string): string {
  const symbols: Record<string, string> = {
    Rightarrow: '⇒', implies: '⇒', Leftrightarrow: '⇔', iff: '⇔', rightarrow: '→', leftrightarrow: '↔',
    perp: '⊥', parallel: '∥', approx: '≈', neq: '≠', ne: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥',
    pm: '±', times: '×', div: '÷', cdot: '·', Delta: 'Δ', in: '∈', notin: '∉', infty: '∞',
    angle: '∠', circ: '°', alpha: 'α', beta: 'β', gamma: 'γ', pi: 'π', theta: 'θ',
  };
  const superscripts: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '(': '⁽', ')': '⁾', n: 'ⁿ' };
  const subscripts: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋' };
  return latex.replace(/\\widehat\s*\{([^{}]+)\}/g, '∠$1')
    .replace(/\^\s*(?:\{\\circ\}|\\circ)/g, '°')
    .replace(/\\(?:left|right)\b/g, '')
    .replace(/\\(?:quad|qquad)\b|\\[,;:! ]/g, ' ')
    .replace(/\\([A-Za-z]+)\b/g, (raw, name: string) => symbols[name] ?? raw)
    .replace(/\^\{?([0-9+\-()n]+)\}?/g, (_, value: string) => [...value].map(c => superscripts[c]).join(''))
    .replace(/_\{?([0-9+\-]+)\}?/g, (_, value: string) => [...value].map(c => subscripts[c]).join(''))
    .replace(/∠\s+/g, '∠').replace(/[ \t]+/g, ' ').trim();
}
