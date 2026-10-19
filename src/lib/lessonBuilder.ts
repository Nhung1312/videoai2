/**
 * LessonBuilder Module (ĐỢT 3B)
 * Transforms an approved ImportedQuestion (with user edits, choices, answers, and solutions)
 * into a finalized, fully synchronized LessonScript.
 *
 * PURE CLIENT-SIDE DETERMINISTIC LOGIC:
 * - NEVER calls Gemini API again once a draft is approved.
 * - Reuses existing geometryScene, cues, and steps if available.
 * - Prioritizes user-provided solution, retaining method, point names, symbols, and steps.
 * - Auto-formats KaTeX expressions and generates typewriter/reveal cue points.
 * - Correctly wires geometry actions and highlights for step-by-step presentation.
 */

import {
  ImportedQuestion,
  LessonScript,
  LessonStep,
  ProblemType,
  GeometryScene,
  GeometricPoint,
  GeometricSegment,
  GeometricPolygon,
  GeometricAngleMarker,
  GeometricEqualLengthMarker,
  CuePoint,
} from '../types/lesson';
import {
  validateGeometryTopology,
  generateAccurateGeometryScene,
  normalizeGeometryScene,
  orchestrateGeometrySteps,
} from './geometryValidator';

/**
 * Maps questionType to presentation ProblemType
 */
export function mapQuestionTypeToProblemType(qType: string): ProblemType {
  switch (qType) {
    case 'geometry':
      return 'geometry';
    case 'equation':
      return 'equation';
    case 'algebra':
      return 'algebra';
    case 'multiple-choice':
      return 'mixed';
    case 'short-answer':
      return 'arithmetic';
    case 'graph':
      return 'graph';
    case 'word_problem':
      return 'word_problem';
    default:
      return 'algebra';
  }
}

/**
 * Checks if a string contains mathematical symbols or equations
 */
function containsMathSymbols(str: string): boolean {
  return /[=+\-*/^_{}\\<>≤≥≈≠]|\b(sin|cos|tan|cot|lim|log|ln|sqrt)\b|\d+x/.test(str);
}

/**
 * Helper to turn raw math lines into clean KaTeX if not already formatted
 */
function cleanLatexExpression(text: string): string {
  let cleaned = text.trim();
  // Remove wrapping $ or $$ if present
  if (cleaned.startsWith('$$') && cleaned.endsWith('$$')) {
    cleaned = cleaned.slice(2, -2).trim();
  } else if (cleaned.startsWith('$') && cleaned.endsWith('$')) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Replace common unicode math symbols with LaTeX equivalents
  cleaned = cleaned
    .replace(/ vuông góc với /gi, ' \\perp ')
    .replace(/ song song với /gi, ' \\parallel ')
    .replace(/ tương đương /gi, ' \\iff ')
    .replace(/ suy ra /gi, ' \\Rightarrow ')
    .replace(/∈/g, '\\in ')
    .replace(/≠/g, '\\neq ')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/±/g, '\\pm ')
    .replace(/×/g, '\\times ')
    .replace(/·/g, '\\cdot ');

  return cleaned;
}

/**
 * Synthesizes a clean, geometrically accurate GeometryScene matching the problem text.
 * NEVER hardcodes a single sample triangle across all lessons!
 */
export function synthesizeFallbackGeometryScene(
  labels: string[] = ['A', 'B', 'C', 'H', 'K', 'I'],
  isIsosceles = true,
  problemText?: string
): GeometryScene {
  const text = problemText || `Hình học với các điểm ${labels.join(' ')}`;
  return generateAccurateGeometryScene(text, labels);
}

/**
 * Validates that a geometryScene is both technically non-empty and topologically matches the problem.
 */
function isUsableGeometryScene(scene?: GeometryScene, problemText?: string): scene is GeometryScene {
  if (!scene || !scene.points || scene.points.length === 0) return false;
  const validPointIds = new Set(scene.points.map((p) => p.id));
  const validSegments = (scene.segments || []).filter(
    (seg) => validPointIds.has(seg.fromPointId) && validPointIds.has(seg.toPointId)
  );
  if (validPointIds.size < 3 || validSegments.length < 2) return false;

  // If problemText is provided, verify topology matches (e.g. 4 points for quadrilaterals)
  if (problemText) {
    const val = validateGeometryTopology(problemText, scene);
    if (!val.isValid) return false;
  }

  return true;
}

function getGeometryLabels(question: ImportedQuestion): string[] {
  const labels = new Set<string>();
  (question.visibleLabels || []).forEach((label) => {
    const clean = label.trim().toUpperCase();
    if (/^[A-Z]$/.test(clean)) labels.add(clean);
  });
  extractGeometryLabels(`${question.problemText} ${question.providedSolution || ''}`).forEach((label) => labels.add(label));
  return Array.from(labels);
}

function extractGeometryLabels(text: string): string[] {
  const matches = text.match(/\b[A-Z]\b/g) || [];
  const set = new Set<string>();
  matches.forEach((m) => {
    // Exclude common roman numerals or words that happen to be capital letters if not points
    if (['V', 'I', 'X'].includes(m) && text.includes(`thứ ${m}`)) return;
    set.add(m);
  });
  return Array.from(set);
}

/**
 * Builds standard cue points for synchronized typewriter and KaTeX reveal
 */
function createStandardCuePoints(): CuePoint[] {
  return [
    { time: 0, event: 'startNarration' },
    { time: 0.25, event: 'revealMath' },
    { time: 0.6, event: 'drawGeometry' },
    { time: 1.2, event: 'highlight' },
  ];
}

/**
 * MAIN FUNCTION: buildLessonScriptFromDraft
 * Converts an approved ImportedQuestion into a complete LessonScript.
 */
export function buildLessonScriptFromDraft(question: ImportedQuestion): LessonScript {
  // 1. Compute effective problem text (including multiple-choice options if present)
  let fullProblemText = question.problemText.trim();
  if (question.choices && question.choices.length > 0) {
    const choicesFormatted = question.choices
      .map((c) => `${c.label}. ${c.content}`)
      .join('   ');
    if (!fullProblemText.includes(choicesFormatted)) {
      fullProblemText += `\n${choicesFormatted}`;
    }
  }

  // CASE C: USER PROVIDED SOLUTION IS AVAILABLE AND PREFERRED
  // When user provided a solution, it is the primary authoritative source!
  // Retain method, sequence, symbols, point names, and conclusions.
  if (question.hasProvidedSolution && question.providedSolution && question.providedSolution.trim()) {
    let steps: LessonStep[] = [];
    const solutionLines = question.providedSolution
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Step 1: Phân tích đề bài và tóm tắt giả thiết
    const isGeometry = question.questionType === 'geometry' || question.hasFigure;
    steps.push({
      id: 'step-1',
      type: isGeometry ? 'geometry' : 'text',
      title: 'Phân tích đề bài & Giả thiết',
      narration: `Trước hết, ta đọc kỹ dữ kiện của đề bài và xác định yêu cầu cần thực hiện.`,
      boardText: 'Tóm tắt dữ kiện và yêu cầu của bài toán.',
      latex: isGeometry ? undefined : question.mathExpressions?.[0],
      duration: 4.2,
      cuePoints: createStandardCuePoints(),
    });

    // Step 2..N: Map each logical step of the user's solution
    solutionLines.forEach((line, idx) => {
      const stepNum = idx + 2;
      const isLast = idx === solutionLines.length - 1;

      // Extract math tokens if present in user line
      let stepLatex: string | undefined;
      const mathMatch = line.match(/\$([^$]+)\$/);
      if (mathMatch) {
        stepLatex = cleanLatexExpression(mathMatch[1]);
      } else if (containsMathSymbols(line) && line.length < 60) {
        stepLatex = cleanLatexExpression(line);
      }

      // Narration text: clean readable Vietnamese spoken text
      const spokenNarration = line
        .replace(/\$([^$]+)\$/g, '$1')
        .replace(/\\perp/g, 'vuông góc với')
        .replace(/\\parallel/g, 'song song với')
        .replace(/\\Rightarrow/g, 'suy ra')
        .replace(/\\iff/g, 'tương đương với')
        .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 phần $2')
        .replace(/[{}]/g, '');

      // Estimate appropriate duration based on length
      const estDuration = Math.max(3.8, Math.min(10, Number((spokenNarration.length / 13.5).toFixed(1))));

      const boardText = mathMatch
        ? line.replace(mathMatch[0], '').trim() || undefined
        : stepLatex
        ? undefined
        : line;

      steps.push({
        id: `step-${stepNum}`,
        type: isLast ? 'conclusion' : isGeometry ? 'geometry' : containsMathSymbols(line) ? 'math' : 'text',
        title: isLast ? 'Kết luận' : `Bước ${idx + 1}`,
        narration: spokenNarration,
        boardText,
        boardMath: stepLatex,
        duration: estDuration,
        cuePoints: createStandardCuePoints(),
      });
    });

    // Ensure final step has conclusion status and reflects approved answer if specified
    if (question.providedAnswer) {
      const lastStep = steps[steps.length - 1];
      if (lastStep.type !== 'conclusion') {
        steps.push({
          id: `step-${steps.length + 1}`,
          type: 'conclusion',
          title: 'Kết luận',
          narration: `Vậy đáp án của bài toán là ${question.providedAnswer}.`,
          boardText: `Đáp án: ${question.providedAnswer}`,
          boardMath: containsMathSymbols(question.providedAnswer) ? cleanLatexExpression(question.providedAnswer) : undefined,
          duration: 3.8,
          cuePoints: createStandardCuePoints(),
        });
      }
    }

    // Prepare GeometryScene if geometry question
    let scene = question.proposedLessonScript?.geometryScene;
    if (isGeometry) {
      const extractedLabels = getGeometryLabels(question);
      scene = normalizeGeometryScene(scene, question.problemText, extractedLabels);
      steps = orchestrateGeometrySteps(scene, steps, question.problemText);
    }

    return {
      title: question.problemText.slice(0, 48).trim() + (question.problemText.length > 48 ? '...' : ''),
      problemType: mapQuestionTypeToProblemType(question.questionType),
      originalProblem: fullProblemText,
      presentation: {
        revealMode: 'typewriter',
        typingSpeed: 32,
        mathRevealMode: 'semantic',
        showTypingCursor: true,
      },
      geometryScene: scene,
      steps,
    };
  }

  // CASE A & B: REUSE PROPOSED LESSON SCRIPT WITH USER-APPROVED EDITS
  if (question.proposedLessonScript && question.proposedLessonScript.steps?.length > 0) {
    const baseScript = question.proposedLessonScript;
    const isGeometryLesson = question.questionType === 'geometry' || question.hasFigure;
    let updatedSteps: LessonStep[] = baseScript.steps.map((st, index) => {
      const explicitPhase = st.phase;
      const inferredProblemPhase =
        isGeometryLesson &&
        !explicitPhase &&
        (st.type === 'geometry' || index < Math.max(1, Math.floor(baseScript.steps.length * 0.45)));
      const phase = explicitPhase ?? (inferredProblemPhase ? 'problem' : 'solution');
      return {
        ...st,
        phase,
        problemReveal: phase === 'problem' ? (st.problemReveal ?? st.displayText ?? st.boardText) : st.problemReveal,
        // Only solution-phase text belongs on the notebook board.
        boardText: phase === 'solution' ? (st.boardText ?? st.displayText) : undefined,
        boardMath: phase === 'solution' ? (st.boardMath ?? st.latex) : undefined,
        boardMathLines: phase === 'solution' ? (st.boardMathLines ?? st.latexLines) : undefined,
        cuePoints: st.cuePoints || createStandardCuePoints(),
      };
    });

    // If user provided a specific answer, ensure the conclusion step displays it accurately
    if (question.providedAnswer && updatedSteps.length > 0) {
      const lastIndex = updatedSteps.length - 1;
      const lastStep = { ...updatedSteps[lastIndex] };
      const ans = question.providedAnswer.trim();

      // Check if user answer is a choice letter (A, B, C, D)
      const matchingChoice = question.choices?.find(
        (c) => c.label.toUpperCase() === ans.toUpperCase()
      );

      const answerDisplayText = matchingChoice
        ? `Kết luận: Đáp án đúng là ${matchingChoice.label}. (${matchingChoice.content})`
        : `Kết luận: Đáp án đúng là ${ans}.`;

      lastStep.type = 'conclusion';
      lastStep.title = 'Kết luận';
      lastStep.boardText = answerDisplayText;
      lastStep.narration = matchingChoice
        ? `Như vậy, đáp án chính xác của bài toán là phương án ${matchingChoice.label}: ${matchingChoice.content}.`
        : `Như vậy, đáp án chính xác của bài toán là ${ans}.`;

      updatedSteps[lastIndex] = lastStep;
    }

    const isGeometry = question.questionType === 'geometry' || question.hasFigure;
    let approvedGeometryScene = baseScript.geometryScene;
    if (isGeometry) {
      const labels = getGeometryLabels(question);
      approvedGeometryScene = normalizeGeometryScene(approvedGeometryScene, question.problemText, labels);
      updatedSteps = orchestrateGeometrySteps(approvedGeometryScene, updatedSteps, question.problemText);
    }

    return {
      ...baseScript,
      title: baseScript.title || question.problemText.slice(0, 48).trim() + '...',
      problemType: baseScript.problemType || mapQuestionTypeToProblemType(question.questionType),
      originalProblem: fullProblemText,
      geometryScene: approvedGeometryScene,
      steps: updatedSteps,
    };
  }

  // FALLBACK: Deterministic build for questions with answer only but no AI script
  const isGeometry = question.questionType === 'geometry' || question.hasFigure;
  let steps: LessonStep[] = [];

  // Step 1: Phân tích đề
  steps.push({
    id: 'step-1',
    type: isGeometry ? 'geometry' : 'text',
    title: 'Phân tích đề bài',
    narration: 'Đọc kỹ các dữ kiện của đề bài và xác định yêu cầu cần thực hiện.',
    boardText: 'Tóm tắt dữ kiện và yêu cầu của bài toán.',
    boardMath: question.mathExpressions?.[0] ? cleanLatexExpression(question.mathExpressions[0]) : undefined,
    duration: 3.8,
    cuePoints: createStandardCuePoints(),
  });

  // Step 2: Giải toán / Biến đổi
  steps.push({
    id: 'step-2',
    type: isGeometry ? 'geometry' : 'math',
    title: 'Biến đổi và tính toán',
    narration: 'Tiến hành các bước suy luận và giải chi tiết.',
    boardText: 'Trình bày lời giải.',
    boardMath: question.mathExpressions?.[1] ? cleanLatexExpression(question.mathExpressions[1]) : undefined,
    duration: 4.5,
    cuePoints: createStandardCuePoints(),
  });

  // Step 3: Kết luận
  const ans = question.providedAnswer || 'Hoàn thành bài toán';
  steps.push({
    id: 'step-3',
    type: 'conclusion',
    title: 'Kết luận',
    narration: `Vậy đáp án của bài toán là ${ans}.`,
    boardText: `Đáp án: ${ans}`,
    duration: 3.5,
    cuePoints: createStandardCuePoints(),
  });

  let scene: GeometryScene | undefined;
  if (isGeometry) {
    const extractedLabels = getGeometryLabels(question);
    scene = generateAccurateGeometryScene(question.problemText, extractedLabels);
    steps = orchestrateGeometrySteps(scene, steps, question.problemText);
  }

  return {
    title: question.problemText.slice(0, 45).trim() + '...',
    problemType: mapQuestionTypeToProblemType(question.questionType),
    originalProblem: fullProblemText,
    presentation: {
      revealMode: 'typewriter',
      typingSpeed: 32,
      mathRevealMode: 'semantic',
      showTypingCursor: true,
    },
    geometryScene: scene,
    steps,
  };
}

export const LessonBuilder = {
  buildLessonScriptFromDraft,
  mapQuestionTypeToProblemType,
  synthesizeFallbackGeometryScene,
};
