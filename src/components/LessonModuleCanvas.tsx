import React, { useRef, useEffect } from 'react';
import { LessonModule, LessonViewport } from '../types/lessonModule';

interface LessonModuleCanvasProps {
  module: LessonModule;
  stepIndex: number;
  progress: number;
  isPortrait?: boolean;
  className?: string;
}

/**
 * Dedicated preview canvas for self-contained LessonModules.
 *
 * CRITICAL (Requirement 2 & 3):
 * - Does NOT convert to geometryScene or call AI geometry planner.
 * - Delegates rendering entirely to module.render(ctx, stepIndex, progress, viewport).
 * - Matches exact same signature and deterministic output as videoExporter.
 */
export const LessonModuleCanvas: React.FC<LessonModuleCanvasProps> = ({
  module,
  stepIndex,
  progress,
  isPortrait = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let animationFrameId: number;

    const renderCanvas = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(Math.floor(rect.width), 10);
      const height = Math.max(Math.floor(rect.height), 10);

      const dpr = window.devicePixelRatio || 1;

      // Adjust internal canvas resolution
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const viewport: LessonViewport = {
        x: 0,
        y: 0,
        width,
        height,
        isPortrait,
      };

      try {
        module.render(ctx, stepIndex, progress, viewport);
      } catch (err) {
        console.warn(`[LessonModuleCanvas] Error in module "${module.id}" render:`, err);
      } finally {
        ctx.restore();
      }
    };

    renderCanvas();

    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(renderCanvas);
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
    };
  }, [module, stepIndex, progress, isPortrait]);

  return (
    <div ref={containerRef} className={`w-full h-full relative overflow-hidden flex items-center justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
};
