import katex from 'katex';
import type { MathSegment } from './mixedMathText';
export { parseMixedMathSegments } from './mixedMathText';
export type { MathSegment } from './mixedMathText';

// Memory cache for valid KaTeX reveal steps to avoid recalculating on each frame
const MATH_STEPS_CACHE = new Map<string, string[]>();

/**
 * Validates whether a candidate LaTeX string renders cleanly in KaTeX.
 */
function isValidKaTeX(latex: string, displayMode = false): boolean {
  try {
    katex.renderToString(latex, { displayMode, throwOnError: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tokenizes a LaTeX string into semantic tokens/chunks while respecting commands & braces.
 */
function tokenizeLaTeX(latex: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = latex.length;

  while (i < n) {
    // Skip leading spaces
    if (latex[i] === ' ') {
      tokens.push(' ');
      i++;
      continue;
    }

    // 1. Environments: \begin{...} ... \end{...}
    if (latex.startsWith('\\begin{', i)) {
      const endTag = '\\end{';
      const endIdx = latex.indexOf(endTag, i);
      if (endIdx !== -1) {
        const closeBrace = latex.indexOf('}', endIdx + endTag.length);
        if (closeBrace !== -1) {
          tokens.push(latex.slice(i, closeBrace + 1));
          i = closeBrace + 1;
          continue;
        }
      }
    }

    // 2. LaTeX commands: \frac, \sqrt, \iff, \implies, \widehat, \text, etc.
    if (latex[i] === '\\') {
      let cmdEnd = i + 1;
      while (cmdEnd < n && /[a-zA-Z]/.test(latex[cmdEnd])) {
        cmdEnd++;
      }
      const cmdName = latex.slice(i, cmdEnd);

      // If followed by argument groups in braces: e.g. \frac{a}{b}, \widehat{ABC}, \text{...}
      let argEnd = cmdEnd;
      while (argEnd < n && (latex[argEnd] === '{' || latex[argEnd] === '[')) {
        const openChar = latex[argEnd];
        const closeChar = openChar === '{' ? '}' : ']';
        let depth = 1;
        let p = argEnd + 1;
        while (p < n && depth > 0) {
          if (latex[p] === openChar) depth++;
          else if (latex[p] === closeChar) depth--;
          p++;
        }
        argEnd = p;
      }

      tokens.push(latex.slice(i, argEnd));
      i = argEnd;
      continue;
    }

    // 3. Operators: =, +, -, *, /, <, >, \approx, etc.
    if (/[=+\-*\/<>]/.test(latex[i])) {
      tokens.push(latex[i]);
      i++;
      continue;
    }

    // 4. Parentheses: (, )
    if (latex[i] === '(' || latex[i] === ')') {
      tokens.push(latex[i]);
      i++;
      continue;
    }

    // 5. Alphanumeric words / identifiers: numbers or variable expressions like "2x", "6", "AB"
    let wordEnd = i;
    while (wordEnd < n && /[a-zA-Z0-9_\^,]/.test(latex[wordEnd])) {
      wordEnd++;
    }
    if (wordEnd > i) {
      tokens.push(latex.slice(i, wordEnd));
      i = wordEnd;
      continue;
    }

    // Fallback: single character
    tokens.push(latex[i]);
    i++;
  }

  return tokens.filter((t) => t.length > 0);
}

/**
 * Computes progressive valid KaTeX steps for a LaTeX formula.
 * Every step in the returned array is guaranteed to be 100% valid KaTeX.
 */
export function getValidMathRevealSteps(latex: string): string[] {
  const trimmed = latex.trim();
  if (!trimmed) return [''];
  if (MATH_STEPS_CACHE.has(trimmed)) {
    return MATH_STEPS_CACHE.get(trimmed)!;
  }

  // Environments like \begin{cases} are atomic
  if (trimmed.startsWith('\\begin{') || trimmed.includes('\\\\')) {
    const single = [trimmed];
    MATH_STEPS_CACHE.set(trimmed, single);
    return single;
  }

  const tokens = tokenizeLaTeX(trimmed);
  const steps: string[] = [];
  let currentCandidate = '';

  for (let idx = 0; idx < tokens.length; idx++) {
    currentCandidate += tokens[idx];
    const candidateTrimmed = currentCandidate.trim();
    if (!candidateTrimmed) continue;

    // Test validity
    if (isValidKaTeX(candidateTrimmed, false)) {
      if (steps.length === 0 || steps[steps.length - 1] !== candidateTrimmed) {
        steps.push(candidateTrimmed);
      }
    } else {
      // Try auto-closing open parenthesis '(' with ')'
      const openParens = (candidateTrimmed.match(/\(/g) || []).length;
      const closeParens = (candidateTrimmed.match(/\)/g) || []).length;
      if (openParens > closeParens) {
        const balanced = candidateTrimmed + ')'.repeat(openParens - closeParens);
        if (isValidKaTeX(balanced, false)) {
          if (steps.length === 0 || steps[steps.length - 1] !== balanced) {
            steps.push(balanced);
          }
        }
      }
    }
  }

  // Always ensure the final step is the full formula
  if (steps.length === 0 || steps[steps.length - 1] !== trimmed) {
    steps.push(trimmed);
  }

  MATH_STEPS_CACHE.set(trimmed, steps);
  return steps;
}

/**
 * Gets the visible math formula at a specific progress ratio (0 to 1).
 */
export function getMathRevealProgress(
  latex: string,
  progress: number,
  mode: 'semantic' | 'immediate' = 'semantic'
): { latex: string; isComplete: boolean } {
  if (mode === 'immediate' || progress >= 1) {
    return { latex, isComplete: true };
  }

  const steps = getValidMathRevealSteps(latex);
  if (steps.length <= 1) {
    return { latex, isComplete: progress >= 0.7 };
  }

  const stepIndex = Math.min(
    steps.length - 1,
    Math.max(0, Math.floor(progress * steps.length))
  );

  return {
    latex: steps[stepIndex],
    isComplete: stepIndex === steps.length - 1,
  };
}

/**
 * Computes progressive typewriter text without timers.
 */
export function getTypewriterText(
  fullText: string,
  elapsedSeconds: number,
  speedMs = 32,
  revealMode: 'typewriter' | 'chunk' | 'immediate' = 'typewriter'
): { text: string; isComplete: boolean; charCount: number } {
  if (!fullText) {
    return { text: '', isComplete: true, charCount: 0 };
  }

  if (revealMode === 'immediate') {
    return { text: fullText, isComplete: true, charCount: fullText.length };
  }

  const totalChars = fullText.length;
  const speedInSec = Math.max(0.005, speedMs / 1000);
  const targetChars = Math.floor(elapsedSeconds / speedInSec);

  if (revealMode === 'chunk') {
    // Reveal by chunks of words
    const words = fullText.split(' ');
    const wordsPerSec = 1 / (speedInSec * 4);
    const visibleWordCount = Math.min(words.length, Math.floor(elapsedSeconds * wordsPerSec));
    const isComplete = visibleWordCount >= words.length;
    const chunkText = isComplete ? fullText : words.slice(0, visibleWordCount).join(' ');
    return { text: chunkText, isComplete, charCount: chunkText.length };
  }

  const charCount = Math.min(totalChars, Math.max(0, targetChars));
  const isComplete = charCount >= totalChars;
  const text = fullText.slice(0, charCount);

  return { text, isComplete, charCount };
}

/**
 * Calculates progressive reveal of mixed text and math segments based on a normalized progress (0 to 1).
 * Strictly sequential across segments within the line.
 * Final Character Safety: guaranteed 100% full content on each segment once localProgress >= 0.95.
 */
export function getMixedSegmentsByProgress(
  segments: MathSegment[],
  progress: number
): {
  revealedSegments: { segment: MathSegment; revealedContent: string; isComplete: boolean }[];
  isAllComplete: boolean;
  activeSegmentIndex: number;
} {
  if (progress >= 1) {
    return {
      revealedSegments: segments.map((s) => ({
        segment: s,
        revealedContent: s.content,
        isComplete: true,
      })),
      isAllComplete: true,
      activeSegmentIndex: segments.length - 1,
    };
  }

  if (progress <= 0) {
    return {
      revealedSegments: segments.map((s) => ({
        segment: s,
        revealedContent: '',
        isComplete: false,
      })),
      isAllComplete: false,
      activeSegmentIndex: 0,
    };
  }

  // Calculate length weights
  const weights = segments.map((s) => Math.max(1, s.content.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let accumulated = 0;
  const result: { segment: MathSegment; revealedContent: string; isComplete: boolean }[] = [];
  let activeIndex = 0;
  let isAllComplete = true;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const segFraction = weights[i] / totalWeight;
    const segStart = accumulated;
    const segEnd = segStart + segFraction;

    if (progress >= segEnd) {
      result.push({ segment: s, revealedContent: s.content, isComplete: true });
    } else if (progress < segStart) {
      result.push({ segment: s, revealedContent: '', isComplete: false });
      isAllComplete = false;
    } else {
      activeIndex = i;
      isAllComplete = false;
      const localProgress = Math.min(1, Math.max(0, (progress - segStart) / segFraction));
      if (s.type === 'text') {
        // Guaranteed full string when localProgress >= 0.95
        const textProgress = Math.min(1, localProgress / 0.95);
        const charCount =
          textProgress >= 1
            ? s.content.length
            : Math.min(s.content.length, Math.max(1, Math.ceil(s.content.length * textProgress)));
        result.push({
          segment: s,
          revealedContent: s.content.slice(0, charCount),
          isComplete: charCount >= s.content.length,
        });
      } else {
        const mathProgress = Math.min(1, localProgress / 0.95);
        const mr = getMathRevealProgress(s.content, mathProgress, 'semantic');
        result.push({
          segment: s,
          revealedContent: mr.latex,
          isComplete: mr.isComplete,
        });
      }
    }
    accumulated = segEnd;
  }

  return { revealedSegments: result, isAllComplete, activeSegmentIndex: activeIndex };
}

/**
 * Calculates progressive reveal of mixed text and math segments across elapsed time.
 */
export function getMixedSegmentsReveal(
  segments: MathSegment[],
  elapsedSeconds: number,
  speedMs = 32,
  revealMode: 'typewriter' | 'chunk' | 'immediate' = 'typewriter'
): {
  revealedSegments: { segment: MathSegment; revealedContent: string; isComplete: boolean }[];
  isAllComplete: boolean;
  activeSegmentIndex: number;
} {
  if (revealMode === 'immediate') {
    return {
      revealedSegments: segments.map((s) => ({
        segment: s,
        revealedContent: s.content,
        isComplete: true,
      })),
      isAllComplete: true,
      activeSegmentIndex: segments.length - 1,
    };
  }

  // Allocate duration per segment proportional to length
  let accumulatedTime = 0;
  const speedSec = Math.max(0.005, speedMs / 1000);
  const result: { segment: MathSegment; revealedContent: string; isComplete: boolean }[] = [];
  let isAllComplete = true;
  let activeSegmentIndex = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segLength = seg.type === 'text' ? seg.content.length : getValidMathRevealSteps(seg.content).length * 4;
    const segDuration = Math.max(0.2, segLength * speedSec);
    const segStartTime = accumulatedTime;
    const segEndTime = segStartTime + segDuration;

    if (elapsedSeconds < segStartTime) {
      // Not yet reached
      result.push({ segment: seg, revealedContent: '', isComplete: false });
      isAllComplete = false;
    } else if (elapsedSeconds >= segEndTime) {
      // Completed
      result.push({ segment: seg, revealedContent: seg.content, isComplete: true });
    } else {
      // Currently active
      activeSegmentIndex = i;
      isAllComplete = false;
      const segElapsed = elapsedSeconds - segStartTime;
      const segProgress = segElapsed / segDuration;

      if (seg.type === 'text') {
        const tw = getTypewriterText(seg.content, segElapsed, speedMs, revealMode);
        result.push({ segment: seg, revealedContent: tw.text, isComplete: tw.isComplete });
      } else {
        const mr = getMathRevealProgress(seg.content, segProgress, 'semantic');
        result.push({ segment: seg, revealedContent: mr.latex, isComplete: mr.isComplete });
      }
    }

    accumulatedTime = segEndTime;
  }

  return { revealedSegments: result, isAllComplete, activeSegmentIndex };
}

/**
 * Calculates adaptive typing speed (ms/char) so text finishes synchronously with narration audio.
 */
export function calculateAdaptiveTypingSpeed(
  textLength: number,
  audioDuration?: number | null,
  fallbackSpeedMs = 32
): number {
  if (!audioDuration || audioDuration <= 0 || textLength <= 0) {
    return fallbackSpeedMs;
  }
  // Target completion at 88% of speech duration
  const targetSpeechWindowMs = audioDuration * 1000 * 0.88;
  const calculatedSpeed = targetSpeechWindowMs / textLength;
  // Clamp to pleasant reading range [15ms, 85ms]
  return Math.min(85, Math.max(15, Math.round(calculatedSpeed)));
}

