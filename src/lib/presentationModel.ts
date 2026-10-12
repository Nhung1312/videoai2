import { LessonScript, LessonStep, LessonPresentationSettings } from '../types/lesson';
import { getTypewriterText, getMathRevealProgress, calculateAdaptiveTypingSpeed } from './mathReveal';
import { AudioEngine } from './audioEngine';

export interface BoardLinePresentation {
  id: string;
  kind: 'header' | 'math';
  rawText: string;
  isHighlighted?: boolean;
  revealProgress: number; // 0.0 to 1.0 (strictly sequential across the step)
  isComplete: boolean;
  isVisible: boolean;
}

export interface PreparedStepBoardItem {
  stepId: string;
  stepIndex: number;
  isActive: boolean;
  headerText?: string;
  mathLines: string[];
  highlightedLineIndex?: number;
  lines: BoardLinePresentation[];
}

export interface PresentationViewModel {
  hasGeometry: boolean;
  isGeometryProblemPhase: boolean;
  isSolutionPhase: boolean;
  problemTypeLabel: string;
  completedProblemText: string;
  activeProblemReveal: string;
  progressiveProblemText: string;
  boardItems: PreparedStepBoardItem[];
  mathRevealProgress: number;
  effectiveSpeedMs: number;
  effectiveRevealMode: 'typewriter' | 'chunk' | 'immediate';
  effectiveMathRevealMode: 'semantic' | 'immediate';
  shouldShowSubtitles: boolean;
}

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  arithmetic: 'Số học',
  algebra: 'Đại số',
  equation: 'Phương trình',
  inequality: 'Bất đẳng thức',
  geometry: 'Hình học',
  coordinate_geometry: 'Hình giải tích',
  graph: 'Đồ thị',
  statistics: 'Thống kê',
  probability: 'Xác suất',
  word_problem: 'Toán có lời văn',
  mixed: 'Tổng hợp',
};

/**
 * Normalizes math/text strings to detect if text and math are essentially identical
 * to prevent duplicate rendering on the blackboard.
 */
function isDuplicateMathOrText(text?: string, math?: string): boolean {
  if (!text || !math) return false;
  const cleanT = text.replace(/[{}$\\\s]/g, '').toLowerCase();
  const cleanM = math.replace(/[{}$\\\s]/g, '').toLowerCase();
  return cleanT.length > 0 && cleanT === cleanM;
}

/**
 * Single Source of Truth for Lesson Presentation state.
 * Used identically by VideoCanvas (DOM Preview) and VideoExporter (Canvas MP4).
 */
export function getPresentationViewModel(
  lesson: LessonScript,
  currentStepIndex: number,
  stepElapsedTime: number,
  stepEffectiveDuration: number,
  options?: {
    settings?: LessonPresentationSettings;
    includeSubtitles?: boolean;
  }
): PresentationViewModel {
  const currentStep = lesson.steps[currentStepIndex];
  const settings = options?.settings;

  const hasGeometry = Boolean(
    lesson.geometryScene &&
      lesson.geometryScene.points &&
      lesson.geometryScene.points.length > 0
  );

  const problemTypeLabel =
    PROBLEM_TYPE_LABELS[lesson.problemType] || lesson.problemType;

  // Geometry: phase === 'problem' means we are still stating the problem & constructing the figure.
  // Once phase !== 'problem', we switch strictly to solution board.
  const isGeometryProblemPhase = hasGeometry && currentStep?.phase === 'problem';
  const isSolutionPhase = !isGeometryProblemPhase;

  // Presentation configurations
  const effectiveRevealMode =
    currentStep?.revealMode ||
    settings?.revealMode ||
    lesson.presentation?.revealMode ||
    'typewriter';

  const baseSpeedMs =
    currentStep?.typingSpeed ||
    settings?.typingSpeed ||
    lesson.presentation?.typingSpeed ||
    32;

  const stepAudioDuration = currentStep ? AudioEngine.getStepDuration(currentStep.id) : null;
  const effectiveSpeedMs = calculateAdaptiveTypingSpeed(
    currentStep?.displayText?.length || currentStep?.boardText?.length || 40,
    stepAudioDuration,
    baseSpeedMs
  );

  const effectiveMathRevealMode =
    currentStep?.mathRevealMode ||
    settings?.mathRevealMode ||
    lesson.presentation?.mathRevealMode ||
    'semantic';

  // Math reveal timing: guaranteed to be 100% finished at least 0.6s before step end
  const mathCue = currentStep?.cuePoints?.find((c) => c.event === 'revealMath');
  const mathStartTime = mathCue ? mathCue.time : Math.max(0.6, stepEffectiveDuration * 0.35);
  const mathRevealEndTime = Math.max(mathStartTime + 0.6, stepEffectiveDuration - 0.7);
  const mathRevealProgress =
    stepElapsedTime < mathStartTime
      ? 0
      : Math.min(1, (stepElapsedTime - mathStartTime) / Math.max(0.4, mathRevealEndTime - mathStartTime));

  // Progressive problem text during Geometry problem phase
  let completedProblemText = '';
  let activeProblemReveal = '';
  let progressiveProblemText = lesson.originalProblem;

  if (isGeometryProblemPhase) {
    const geometryProblemSteps = lesson.steps.filter((step) => step.phase === 'problem');
    completedProblemText = geometryProblemSteps
      .filter((step) => lesson.steps.indexOf(step) < currentStepIndex)
      .map((step) => step.problemReveal)
      .filter(Boolean)
      .join(' ')
      .trim();

    activeProblemReveal = currentStep?.problemReveal ?? '';
    const activeProblemTw = getTypewriterText(
      activeProblemReveal,
      stepElapsedTime,
      effectiveSpeedMs,
      effectiveRevealMode
    );

    progressiveProblemText = [completedProblemText, activeProblemTw.text]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  // Cumulative blackboard items
  // In Geometry: only solution steps belong on the board.
  // In Non-geometry: all steps up to currentStepIndex belong on the board.
  const candidateSteps = hasGeometry
    ? lesson.steps.slice(0, currentStepIndex + 1).filter((step) => step.phase !== 'problem')
    : lesson.steps.slice(0, currentStepIndex + 1);

  const boardItems: PreparedStepBoardItem[] = [];

  for (const step of candidateSteps) {
    const stepIdx = lesson.steps.indexOf(step);
    const isActive = stepIdx === currentStepIndex;

    const rawText = (step.boardText ?? step.displayText ?? '').trim();
    const rawMath = (step.boardMath ?? step.latex ?? '').trim();
    const rawLines = (step.boardMathLines ?? step.latexLines ?? []).filter(Boolean);

    let mathLines: string[] = [];
    if (rawLines.length > 0) {
      mathLines = rawLines;
    } else if (rawMath) {
      mathLines = [rawMath];
    }

    // Deduplication check: if rawText is identical to rawMath or first math line, do not show rawText.
    let headerText: string | undefined = rawText || undefined;
    if (headerText && mathLines.length > 0) {
      if (isDuplicateMathOrText(headerText, mathLines[0])) {
        headerText = undefined;
      }
    }

    if (headerText || mathLines.length > 0) {
      // 1. Collect all ordered raw lines for this step
      const rawLineDefinitions: Array<{
        id: string;
        kind: 'header' | 'math';
        rawText: string;
        isHighlighted?: boolean;
      }> = [];

      if (headerText) {
        rawLineDefinitions.push({
          id: `${step.id}-header`,
          kind: 'header',
          rawText: headerText,
          isHighlighted: false,
        });
      }

      mathLines.forEach((mLine, mIdx) => {
        rawLineDefinitions.push({
          id: `${step.id}-math-${mIdx}`,
          kind: 'math',
          rawText: mLine,
          isHighlighted: step.highlightedLineIndex === mIdx,
        });
      });

      // 2. Compute strictly sequential line reveal progress
      const lines: BoardLinePresentation[] = [];

      if (!isActive) {
        // Historical steps from prior timestamps are always 100% complete and frozen
        for (const def of rawLineDefinitions) {
          lines.push({
            ...def,
            revealProgress: 1.0,
            isComplete: true,
            isVisible: true,
          });
        }
      } else {
        // Active step: partition the writing timeline sequentially across all lines
        const M = rawLineDefinitions.length;
        if (M === 0) {
          // No lines
        } else {
          const writingStart = 0.15;
          const writingEnd = Math.max(writingStart + 0.6, stepEffectiveDuration - 0.5);
          const windowDuration = Math.max(0.6, writingEnd - writingStart);

          // Weights based on character lengths
          const weights = rawLineDefinitions.map((d) => Math.max(12, d.rawText.length));
          const totalWeight = weights.reduce((a, b) => a + b, 0);

          // Allocate duration per line with safety minimum
          let durations = weights.map((w) => Math.max(0.35, windowDuration * (w / totalWeight)));
          const sumDur = durations.reduce((a, b) => a + b, 0);
          durations = durations.map((d) => d * (windowDuration / sumDur));

          let accumulatedStart = writingStart;
          for (let k = 0; k < M; k++) {
            const def = rawLineDefinitions[k];
            const lineStart = accumulatedStart;
            const lineEnd = lineStart + durations[k];
            accumulatedStart = lineEnd;

            // Tail padding within this line: at least 0.2s or 16% of line duration
            // Line reaches 100% full content at lineTypingEnd, remaining time is tail pause
            const lineTailPad = Math.min(0.4, Math.max(0.2, durations[k] * 0.16));
            const lineTypingEnd = Math.max(lineStart + 0.1, lineEnd - lineTailPad);

            let revealProgress = 0.0;
            let isComplete = false;
            let isVisible = false;

            if (stepElapsedTime >= lineTypingEnd) {
              revealProgress = 1.0;
              isComplete = true;
              isVisible = true;
            } else if (stepElapsedTime < lineStart) {
              revealProgress = 0.0;
              isComplete = false;
              isVisible = false;
            } else {
              // Actively writing this line
              revealProgress = Math.min(
                1.0,
                Math.max(0.0, (stepElapsedTime - lineStart) / Math.max(0.1, lineTypingEnd - lineStart))
              );
              isComplete = revealProgress >= 1.0;
              isVisible = true;
            }

            lines.push({
              ...def,
              revealProgress,
              isComplete,
              isVisible,
            });
          }

          // Frame safety: step final frames must always render FULL CONTENT on all lines
          if (stepElapsedTime >= stepEffectiveDuration - 0.25 || stepElapsedTime >= writingEnd) {
            for (const l of lines) {
              l.revealProgress = 1.0;
              l.isComplete = true;
              l.isVisible = true;
            }
          }
        }
      }

      boardItems.push({
        stepId: step.id,
        stepIndex: stepIdx,
        isActive,
        headerText,
        mathLines,
        highlightedLineIndex: step.highlightedLineIndex,
        lines,
      });
    }
  }

  return {
    hasGeometry,
    isGeometryProblemPhase,
    isSolutionPhase,
    problemTypeLabel,
    completedProblemText,
    activeProblemReveal,
    progressiveProblemText,
    boardItems,
    mathRevealProgress,
    effectiveSpeedMs,
    effectiveRevealMode,
    effectiveMathRevealMode,
    shouldShowSubtitles: Boolean(options?.includeSubtitles),
  };
}
