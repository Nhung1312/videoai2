/**
 * Lesson Module Schema & Types
 * Defines the self-contained LessonModule specification.
 * Each module has its own deterministic canvas renderer and step definitions.
 */

export interface LessonViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  isPortrait?: boolean;
}

export interface LessonModuleStep {
  phase: 'problem' | 'solution';
  displayText: string;
  narration: string;
}

export interface LessonModule {
  id: string;
  title: string;
  problemType: string; // e.g. "geometry" | "algebra"
  originalProblem?: string;
  steps: LessonModuleStep[];
  render(
    ctx: CanvasRenderingContext2D,
    stepIndex: number,
    progress: number,
    viewport: LessonViewport
  ): void;
}
