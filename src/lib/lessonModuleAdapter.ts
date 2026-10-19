import { LessonScript, LessonStep } from '../types/lesson';
import { LessonModule } from '../types/lessonModule';

/**
 * Converts a self-contained LessonModule into the application's runtime LessonScript model.
 *
 * CRITICAL (Requirement 2):
 * - Does NOT create or convert to a geometryScene.
 * - Does NOT trigger geometry planning or fallbacks.
 * - Leaves the lesson renderer responsible for drawing graphics.
 */
export function lessonModuleToScript(module: LessonModule): LessonScript {
  const steps: LessonStep[] = module.steps.map((s, idx) => {
    const isProblem = s.phase === 'problem';
    return {
      id: `${module.id}-step-${idx + 1}`,
      type: isProblem ? 'text' : 'geometry',
      phase: s.phase,
      title: `Bước ${idx + 1}`,
      narration: s.narration,
      displayText: s.displayText,
      problemReveal: isProblem ? s.displayText : undefined,
      boardText: isProblem ? undefined : s.displayText,
      boardMathLines: isProblem ? [] : [s.displayText],
      duration: 4, // Default placeholder; dynamically adjusted by AudioEngine based on real Kore TTS audio
    };
  });

  const problemSteps = module.steps.filter((s) => s.phase === 'problem');
  const fullProblemText =
    module.originalProblem ||
    problemSteps.map((s) => s.displayText).join(' ') ||
    module.title;

  return {
    title: module.title,
    problemType: (module.problemType || 'geometry') as any,
    originalProblem: fullProblemText,
    presentation: {
      revealMode: 'typewriter',
      typingSpeed: 30,
      mathRevealMode: 'semantic',
      showTypingCursor: true,
    },
    // CRITICAL: geometryScene remains undefined for LessonModules
    geometryScene: undefined,
    module,
    steps,
  };
}

export function isLessonModule(lesson?: LessonScript | null): boolean {
  return Boolean(lesson && lesson.module);
}
