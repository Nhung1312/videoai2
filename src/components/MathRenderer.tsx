import React, { useMemo } from 'react';
import katex from 'katex';
import { parseMixedMathSegments } from '../lib/mixedMathText';
import {
  getMixedSegmentsReveal,
  getMixedSegmentsByProgress,
  getMathRevealProgress,
} from '../lib/mathReveal';

export const TypingCursor: React.FC<{ visible?: boolean; className?: string }> = ({
  visible = true,
  className = '',
}) => {
  if (!visible) return null;
  return (
    <span
      className={`inline-block w-[2px] h-[1.1em] bg-sky-500 ml-0.5 align-middle animate-pulse rounded-xs shadow-xs shadow-sky-500/50 ${className}`}
      aria-hidden="true"
    />
  );
};

interface MathRendererProps {
  latex?: string;
  latexLines?: string[];
  highlightedLineIndex?: number;
  displayMode?: boolean;
  align?: 'left' | 'center' | 'right';
  className?: string;
  fontSize?: 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
  revealProgress?: number; // 0 to 1 for progressive semantic math reveal
  mathRevealMode?: 'semantic' | 'immediate';
  showCursor?: boolean;
  isTyping?: boolean;
}

/**
 * Renders a LaTeX string via KaTeX safely without throwing errors.
 */
export function renderKaTeXToString(latex: string, displayMode = false): string {
  try {
    const cleaned = latex.trim();
    if (!cleaned) return '';
    return katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch (err) {
    console.error('KaTeX render error:', err);
    return `<span class="text-rose-400 font-mono text-sm">${latex}</span>`;
  }
}

/**
 * Helper to render mixed natural language with inline $...$ or $$...$$ KaTeX
 * Supports Typewriter + Math Reveal seamlessly!
 */
export const FormattedMathText: React.FC<{
  text?: string;
  className?: string;
  elapsedSeconds?: number;
  speedMs?: number;
  revealMode?: 'typewriter' | 'chunk' | 'immediate';
  showCursor?: boolean;
}> = ({
  text,
  className = '',
  elapsedSeconds,
  speedMs = 32,
  revealMode = 'immediate',
  showCursor = false,
}) => {
  const parsedSegments = useMemo(() => {
    return parseMixedMathSegments(text || '');
  }, [text]);

  const revealResult = useMemo(() => {
    if (elapsedSeconds === undefined || revealMode === 'immediate') {
      return {
        revealedSegments: parsedSegments.map((s) => ({
          segment: s,
          revealedContent: s.content,
          isComplete: true,
        })),
        isAllComplete: true,
        activeSegmentIndex: parsedSegments.length - 1,
      };
    }

    return getMixedSegmentsReveal(parsedSegments, elapsedSeconds, speedMs, revealMode);
  }, [parsedSegments, elapsedSeconds, speedMs, revealMode]);

  if (!text) return null;

  return (
    <div className={`mixed-math-text leading-relaxed break-words ${className}`}>
      {revealResult.revealedSegments.map((item, idx) => {
        if (!item.revealedContent) return null;
        const isActiveSegment = idx === revealResult.activeSegmentIndex && !item.isComplete;

        if (item.segment.type === 'text') {
          return (
            <span key={idx}>
              <span className="mixed-math-prose">{item.revealedContent}</span>
              {isActiveSegment && showCursor && <TypingCursor />}
            </span>
          );
        }

        // Math Segment: always renders through KaTeX
        const mathHtml = renderKaTeXToString(item.revealedContent, item.segment.displayMode);
        return (
          <span key={idx} className="align-baseline">
            <span
              className={item.segment.displayMode ? 'my-2 block text-center' : 'mixed-math-formula'}
              dangerouslySetInnerHTML={{ __html: mathHtml }}
            />
            {isActiveSegment && showCursor && <TypingCursor />}
          </span>
        );
      })}
    </div>
  );
};

export interface MixedMathLineViewProps {
  text: string;
  revealProgress?: number;
  isHighlighted?: boolean;
  isTyping?: boolean;
  showCursor?: boolean;
  className?: string;
  fontSize?: 'sm' | 'base' | 'lg' | 'xl';
}

export const MixedMathLineView: React.FC<MixedMathLineViewProps> = ({
  text,
  revealProgress = 1,
  isHighlighted = false,
  isTyping = false,
  showCursor = false,
  className = '',
  fontSize = 'base',
}) => {
  const parsedSegments = useMemo(() => {
    return parseMixedMathSegments(text || '');
  }, [text]);

  const revealResult = useMemo(() => {
    return getMixedSegmentsByProgress(parsedSegments, revealProgress);
  }, [parsedSegments, revealProgress]);

  if (!text) return null;

  const fontClass = {
    sm: 'text-xs sm:text-sm',
    base: 'text-sm sm:text-base',
    lg: 'text-base sm:text-lg',
    xl: 'text-lg sm:text-xl',
  }[fontSize];

  return (
    <div
      className={`mixed-math-text leading-relaxed break-words ${fontClass} ${
        isHighlighted ? 'text-sky-950 font-semibold' : 'text-slate-900'
      } ${className}`}
    >
      {revealResult.revealedSegments.map((item, idx) => {
        if (!item.revealedContent) return null;
        const isActiveSegment = idx === revealResult.activeSegmentIndex && !item.isComplete;

        if (item.segment.type === 'text') {
          return (
            <span key={idx} className="mixed-math-prose break-words font-normal">
              <span>{item.revealedContent}</span>
              {isActiveSegment && showCursor && isTyping && <TypingCursor />}
            </span>
          );
        }

        // Math Segment: rendered via KaTeX
        const mathHtml = renderKaTeXToString(item.revealedContent, false);
        return (
          <span key={idx} className="align-baseline">
            <span
              className="mixed-math-formula"
              dangerouslySetInnerHTML={{ __html: mathHtml }}
            />
            {isActiveSegment && showCursor && isTyping && <TypingCursor />}
          </span>
        );
      })}
    </div>
  );
};

export const MathRenderer: React.FC<MathRendererProps> = ({
  latex,
  latexLines,
  highlightedLineIndex,
  displayMode = true,
  align = 'center',
  className = '',
  fontSize = 'xl',
  revealProgress = 1,
  mathRevealMode = 'semantic',
  showCursor = false,
  isTyping = false,
}) => {
  const sizeClasses = {
    sm: 'text-sm',
    base: 'text-base',
    lg: 'text-lg',
    xl: 'text-xl md:text-2xl',
    '2xl': 'text-2xl md:text-3xl',
    '3xl': 'text-3xl md:text-4xl',
  }[fontSize];

  const alignClasses = {
    left: 'text-left justify-start',
    center: 'text-center justify-center',
    right: 'text-right justify-end',
  }[align];

  // If multi-line step derivation is provided
  if (latexLines && latexLines.length > 0) {
    return (
      <div className={`space-y-1 my-0.5 w-full ${className}`}>
        {latexLines.map((line, idx) => {
          const isHighlighted = highlightedLineIndex === idx;

          // For the actively highlighted line, apply semantic reveal progress
          let visibleLatex = line;
          let isLineTyping = false;

          if (isHighlighted && revealProgress < 1 && mathRevealMode !== 'immediate') {
            const mathProgress = getMathRevealProgress(line, revealProgress, mathRevealMode);
            visibleLatex = mathProgress.latex;
            isLineTyping = !mathProgress.isComplete;
          }

          const html = renderKaTeXToString(visibleLatex, displayMode);

          return (
            <div
              key={idx}
              className={`transition-all duration-300 px-1 py-0.5 flex items-center ${alignClasses} ${
                isHighlighted
                  ? 'text-slate-950 border-l-2 border-amber-400 pl-2'
                  : 'text-slate-800 opacity-100'
              }`}
            >
              <div className="flex items-center">
                <div
                  className={`overflow-hidden py-0 ${sizeClasses}`}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                {isHighlighted && isLineTyping && showCursor && <TypingCursor />}
              </div>
              {isHighlighted && (
                <span className="ml-2 inline-flex items-center text-[10px] font-semibold px-1.5 py-0 rounded bg-amber-50 text-amber-800 shrink-0">
                  Đang xét
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Single LaTeX block
  if (!latex) return null;

  let currentLatex = latex;
  let lineStillTyping = false;

  if (revealProgress < 1 && mathRevealMode !== 'immediate') {
    const mathProgress = getMathRevealProgress(latex, revealProgress, mathRevealMode);
    currentLatex = mathProgress.latex;
    lineStillTyping = !mathProgress.isComplete;
  }

  const html = renderKaTeXToString(currentLatex, displayMode);

  return (
    <div
      className={`my-0.5 overflow-hidden py-0.5 px-1 flex items-center ${alignClasses} ${sizeClasses} ${className}`}
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {lineStillTyping && showCursor && isTyping && <TypingCursor />}
    </div>
  );
};
