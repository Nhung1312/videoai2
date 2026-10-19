import React, { useRef, useEffect, useState } from 'react';
import { LessonScript, LessonPresentationSettings } from '../types/lesson';
import { TimelineState } from '../lib/useTimeline';
import { GeometryRenderer } from './GeometryRenderer';
import { LessonModuleCanvas } from './LessonModuleCanvas';
import { MathRenderer, FormattedMathText, MixedMathLineView } from './MathRenderer';
import { AudioEngine } from '../lib/audioEngine';
import { getPresentationViewModel } from '../lib/presentationModel';
import {
  BookOpen,
  Volume2,
  Sparkles,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

interface VideoCanvasProps {
  lesson: LessonScript;
  timeline: TimelineState;
  aspectRatio: '16:9' | '9:16';
  isEditable?: boolean;
  settings?: LessonPresentationSettings;
  onPointMoved?: (pointId: string, newOffset: { x: number; y: number }) => void;
  className?: string;
}

export const VideoCanvas: React.FC<VideoCanvasProps> = ({
  lesson,
  timeline,
  aspectRatio,
  isEditable = false,
  settings,
  onPointMoved,
  className = '',
}) => {
  const {
    currentStep,
    currentStepIndex,
    stepProgress,
    stepElapsedTime,
    stepEffectiveDuration,
  } = timeline;

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [, setForceUpdate] = useState(0);

  // Subscribe to AudioEngine updates to reflect audio ready/error states
  useEffect(() => {
    const unsubscribe = AudioEngine.subscribe({
      onStatusChange: () => setForceUpdate((n) => n + 1),
      onDurationsUpdated: () => setForceUpdate((n) => n + 1),
    });
    return unsubscribe;
  }, []);

  const stepAudioStatus = currentStep ? AudioEngine.getStepStatus(currentStep.id) : 'idle';

  const showCursor =
    settings?.showTypingCursor !== undefined
      ? settings.showTypingCursor
      : lesson.presentation?.showTypingCursor !== undefined
      ? lesson.presentation.showTypingCursor
      : true;

  // Single Source of Truth presentation view model
  const model = getPresentationViewModel(
    lesson,
    currentStepIndex,
    stepElapsedTime,
    stepEffectiveDuration,
    { settings }
  );

  // Auto-scroll solution history when advancing steps
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [currentStepIndex]);

  // Aspect ratio styling
  const ratioClasses =
    aspectRatio === '16:9'
      ? 'aspect-video w-full max-w-[1500px] max-h-[86vh]'
      : 'aspect-[9/16] h-[84vh] max-w-full mx-auto';

  const handleRetryVoice = () => {
    if (currentStep) {
      AudioEngine.loadStepAudio(currentStep.id, currentStep.narration);
    }
  };

  return (
    <div
      className={`relative rounded-3xl overflow-hidden shadow-2xl border-2 border-slate-700 bg-slate-950 flex items-center justify-center ${ratioClasses} ${className}`}
    >
      {/* Inner Whiteboard / Clean Paper Canvas */}
      <div className="absolute inset-0 bg-[#f7f9fc] text-slate-950 flex flex-col overflow-hidden select-none">
        {/* Subtle grid background to look like clean math graph paper */}
        <div
          className="absolute inset-0 opacity-[0.035] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(#0f172a 1px, transparent 1px), radial-gradient(#0f172a 1px, #f8fafc 1px)',
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0, 12px 12px',
          }}
        />

        {/* 1. TOP VIDEO HEADER */}
        <header className="relative z-10 px-4 py-2 sm:px-5 sm:py-2.5 bg-white/85 backdrop-blur-xs border-b border-slate-200 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 truncate">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200">
              <BookOpen className="w-3.5 h-3.5" />
              {model.problemTypeLabel}
            </span>
            <h1 className="text-base sm:text-lg lg:text-xl font-bold text-slate-950 truncate">
              {lesson.title}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Audio Generation Status Indicator */}
            {AudioEngine.settings.enabled && (
              <div className="text-[11px] flex items-center gap-1.5 px-2 py-0.5 rounded-md border">
                {stepAudioStatus === 'loading' && (
                  <span className="flex items-center gap-1 text-sky-600 bg-sky-50 border-sky-200">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Đang nạp giọng...</span>
                  </span>
                )}
                {stepAudioStatus === 'ready' && (
                  <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 border-emerald-200">
                    <Volume2 className="w-3 h-3" />
                    <span>Giọng AI sẵn sàng</span>
                  </span>
                )}
                {stepAudioStatus === 'error' && (
                  <button
                    onClick={handleRetryVoice}
                    className="flex items-center gap-1 text-amber-600 bg-amber-50 hover:bg-amber-100 border-amber-200 cursor-pointer"
                    title="Bấm để thử lại nạp giọng"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    <span>Thử lại giọng</span>
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            )}

            <span className="text-xs font-medium px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
              Bước {currentStepIndex + 1}/{lesson.steps.length}
            </span>
          </div>
        </header>

        {/* 2. MAIN BODY CONTENT */}
        <main className="relative z-10 flex-1 p-3 sm:p-5 overflow-hidden flex flex-col">
          {model.hasGeometry ? (
            aspectRatio === '16:9' ? (
              <div className="grid grid-cols-12 gap-4 h-full">
                {/* Left Column: Problem in Phase 1, Solution in Phase 2 */}
                <div className={`col-span-5 flex flex-col h-full min-h-0 gap-3 ${model.isGeometryProblemPhase ? 'justify-start' : ''}`}>
                  {model.isGeometryProblemPhase ? (
                    <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-xs shrink-0">
                      <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase mb-1">Đề bài</div>
                      <FormattedMathText
                        text={model.progressiveProblemText}
                        className="text-lg sm:text-xl lg:text-2xl text-slate-950 font-semibold leading-snug"
                        elapsedSeconds={999}
                        speedMs={1}
                        revealMode="immediate"
                        showCursor={false}
                      />
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex-1 min-h-0 flex flex-col overflow-hidden">
                      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between shrink-0">
                        <span className="text-xs font-bold tracking-wider text-slate-500 uppercase">Bài giải</span>
                        <span className="text-[11px] text-slate-400">Ghi vở</span>
                      </div>
                      <div ref={scrollContainerRef} className="lesson-board-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-1">
                        {model.boardItems.map((item) => (
                          <div key={item.stepId} className={`relative px-1 py-0.5 transition-all ${item.isActive ? 'border-l-2 border-sky-400 pl-3' : 'pl-3'}`}>
                            {item.lines.map((line) => {
                              if (!line.isVisible) return null;
                              return (
                                <div
                                  key={line.id}
                                  className={`my-1 transition-all ${
                                    line.isHighlighted
                                      ? 'bg-amber-50/80 border-l-2 border-amber-500 pl-2 py-0.5 rounded-r'
                                      : ''
                                  }`}
                                >
                                  <MixedMathLineView
                                    text={line.rawText}
                                    revealProgress={line.revealProgress}
                                    isHighlighted={line.isHighlighted}
                                    isTyping={item.isActive && !line.isComplete}
                                    showCursor={item.isActive && showCursor && !line.isComplete}
                                    fontSize="base"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column: Geometry Scene */}
                <div className="col-span-7 bg-white rounded-2xl ring-1 ring-slate-200 border border-slate-200 p-2 sm:p-3 shadow-xs flex items-center justify-center relative overflow-hidden">
                  {lesson.module ? (
                    <LessonModuleCanvas
                      module={lesson.module}
                      stepIndex={currentStepIndex}
                      progress={stepProgress}
                      isPortrait={false}
                    />
                  ) : (
                    <GeometryRenderer
                      scene={lesson.geometryScene}
                      currentStep={currentStep}
                      stepProgress={stepProgress}
                      stepEffectiveDuration={stepEffectiveDuration}
                      isEditable={isEditable}
                      onPointMoved={onPointMoved}
                    />
                  )}
                </div>
              </div>
            ) : (
              /* Portrait 9:16 Layout for Geometry */
              <div className="flex flex-col h-full gap-2.5">
                <div className="h-[46%] bg-white rounded-2xl border border-slate-200 p-2 shadow-xs flex items-center justify-center relative overflow-hidden">
                  {lesson.module ? (
                    <LessonModuleCanvas
                      module={lesson.module}
                      stepIndex={currentStepIndex}
                      progress={stepProgress}
                      isPortrait={true}
                    />
                  ) : (
                    <GeometryRenderer
                      scene={lesson.geometryScene}
                      currentStep={currentStep}
                      stepProgress={stepProgress}
                      stepEffectiveDuration={stepEffectiveDuration}
                      isEditable={isEditable}
                      onPointMoved={onPointMoved}
                    />
                  )}
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  {model.isGeometryProblemPhase ? (
                    <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-xs flex-1 flex flex-col justify-start">
                      <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase mb-1">Đề bài</div>
                      <FormattedMathText
                        text={model.progressiveProblemText}
                        className="text-base sm:text-lg text-slate-950 font-semibold leading-snug"
                        elapsedSeconds={999}
                        speedMs={1}
                        revealMode="immediate"
                        showCursor={false}
                      />
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex-1 min-h-0 flex flex-col overflow-hidden">
                      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between shrink-0">
                        <span className="text-xs font-bold tracking-wider text-slate-500 uppercase">Bài giải</span>
                        <span className="text-[11px] text-slate-400">Ghi vở</span>
                      </div>
                      <div ref={scrollContainerRef} className="lesson-board-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-1">
                        {model.boardItems.map((item) => (
                          <div key={item.stepId} className={`relative px-1 py-0.5 transition-all ${item.isActive ? 'border-l-2 border-sky-400 pl-3' : 'pl-3'}`}>
                            {item.lines.map((line) => {
                              if (!line.isVisible) return null;
                              return (
                                <div
                                  key={line.id}
                                  className={`my-1 transition-all ${
                                    line.isHighlighted
                                      ? 'bg-amber-50/80 border-l-2 border-amber-500 pl-2 py-0.5 rounded-r'
                                      : ''
                                  }`}
                                >
                                  <MixedMathLineView
                                    text={line.rawText}
                                    revealProgress={line.revealProgress}
                                    isHighlighted={line.isHighlighted}
                                    isTyping={item.isActive && !line.isComplete}
                                    showCursor={item.isActive && showCursor && !line.isComplete}
                                    fontSize="sm"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          ) : (
            /* Non-Geometry (Algebra) Layout */
            aspectRatio === '16:9' ? (
              <div className="grid grid-cols-12 gap-4 h-full">
                <div className="col-span-4 bg-white rounded-2xl p-4 border border-slate-200 shadow-xs self-start">
                  <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-400 uppercase mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Đề bài
                  </div>
                  <FormattedMathText
                    text={lesson.originalProblem}
                    className="text-base sm:text-lg font-semibold text-slate-950 leading-relaxed"
                    elapsedSeconds={999}
                    speedMs={1}
                    revealMode="immediate"
                    showCursor={false}
                  />
                </div>

                <div className="col-span-8 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col min-h-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-bold text-slate-800">Lời giải</span>
                    <span className="text-xs text-slate-400">Trình bày từng bước</span>
                  </div>
                  <div ref={scrollContainerRef} className="lesson-board-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 py-4 space-y-1">
                    {model.boardItems.map((item) => (
                      <div key={item.stepId} className={`relative py-1 pl-4 pr-2 ${item.isActive ? 'border-l-2 border-sky-400' : 'border-l-2 border-transparent'}`}>
                        {item.lines.map((line) => {
                          if (!line.isVisible) return null;
                          return (
                            <div
                              key={line.id}
                              className={`my-1.5 transition-all ${
                                line.isHighlighted
                                  ? 'bg-amber-50/80 border-l-2 border-amber-500 pl-2 py-1 rounded-r'
                                  : ''
                              }`}
                            >
                              <MixedMathLineView
                                text={line.rawText}
                                revealProgress={line.revealProgress}
                                isHighlighted={line.isHighlighted}
                                isTyping={item.isActive && !line.isComplete}
                                showCursor={item.isActive && showCursor && !line.isComplete}
                                fontSize="lg"
                              />
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full gap-2.5">
                <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-xs shrink-0">
                  <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">Đề bài</div>
                  <FormattedMathText
                    text={lesson.originalProblem}
                    className="text-sm font-semibold text-slate-950 leading-snug"
                    elapsedSeconds={999}
                    speedMs={1}
                    revealMode="immediate"
                    showCursor={false}
                  />
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <span className="text-xs font-bold tracking-wider text-slate-500 uppercase">Lời giải</span>
                  </div>
                  <div ref={scrollContainerRef} className="lesson-board-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-1">
                    {model.boardItems.map((item) => (
                      <div key={item.stepId} className={`relative py-0.5 pl-3 ${item.isActive ? 'border-l-2 border-sky-400' : ''}`}>
                        {item.lines.map((line) => {
                          if (!line.isVisible) return null;
                          return (
                            <div
                              key={line.id}
                              className={`my-1 transition-all ${
                                line.isHighlighted
                                  ? 'bg-amber-50/80 border-l-2 border-amber-500 pl-2 py-0.5 rounded-r'
                                  : ''
                              }`}
                            >
                              <MixedMathLineView
                                text={line.rawText}
                                revealProgress={line.revealProgress}
                                isHighlighted={line.isHighlighted}
                                isTyping={item.isActive && !line.isComplete}
                                showCursor={item.isActive && showCursor && !line.isComplete}
                                fontSize="base"
                              />
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
};

