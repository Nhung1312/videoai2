import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { LessonStep } from '../types/lesson';
import { AudioEngine } from './audioEngine';

export interface TimelineState {
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  speed: number;
  currentStepIndex: number;
  stepProgress: number; // 0 to 1 inside current step
  stepElapsedTime: number; // seconds elapsed in current step
  stepEffectiveDuration: number; // adapted step duration (audio or fallback)
  currentStep?: LessonStep;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  restart: () => void;
  seek: (targetTime: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setSpeed: (speed: number) => void;
}

export function useTimeline(
  steps: LessonStep[],
  options?: {
    initialSpeed?: number;
    autoPlay?: boolean;
    audioDurations?: Record<string, number>;
  }
): TimelineState {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(options?.autoPlay ?? false);
  const [speed, setSpeedState] = useState(options?.initialSpeed ?? 1);
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>(
    options?.audioDurations || {}
  );

  // Subscribe to AudioEngine duration updates
  useEffect(() => {
    const unsubscribe = AudioEngine.subscribe({
      onDurationsUpdated: (durations) => {
        setAudioDurations(durations);
      },
    });
    return unsubscribe;
  }, []);

  // Compute adaptive step timeline intervals based on real audio durations
  const { stepStartTimes, stepEffectiveDurations, totalDuration } = useMemo(() => {
    let acc = 0;
    const starts: number[] = [];
    const durations: number[] = [];

    steps.forEach((step) => {
      starts.push(acc);
      const audioDur = audioDurations[step.id];

      // Audio is the source of time: effectiveDuration >= leadIn + audioDuration + tailPadding
      const minFromAudio =
        AudioEngine.settings.enabled && audioDur && audioDur > 0
          ? AudioEngine.leadIn + audioDur + AudioEngine.tailPadding
          : 0;
      const effectiveDur = Math.max(step.duration || 4, minFromAudio);

      durations.push(effectiveDur);
      acc += effectiveDur;
    });

    return {
      stepStartTimes: starts,
      stepEffectiveDurations: durations,
      totalDuration: Math.max(0.1, acc),
    };
  }, [steps, audioDurations]);

  // Determine current step index and progress
  const currentStepIndex = useMemo(() => {
    if (steps.length === 0) return 0;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (currentTime >= stepStartTimes[i]) {
        return i;
      }
    }
    return 0;
  }, [currentTime, stepStartTimes, steps.length]);

  const currentStep = steps[currentStepIndex];

  const stepElapsedTime = useMemo(() => {
    if (steps.length === 0) return 0;
    const start = stepStartTimes[currentStepIndex] || 0;
    return Math.max(0, currentTime - start);
  }, [currentTime, currentStepIndex, stepStartTimes, steps.length]);

  const stepEffectiveDuration = useMemo(() => {
    return stepEffectiveDurations[currentStepIndex] || 3;
  }, [currentStepIndex, stepEffectiveDurations]);

  const stepProgress = useMemo(() => {
    if (!currentStep) return 0;
    return Math.min(1, Math.max(0, stepElapsedTime / stepEffectiveDuration));
  }, [currentStep, stepElapsedTime, stepEffectiveDuration]);

  // Synchronize AudioEngine with current step & playback
  useEffect(() => {
    if (currentStep) {
      AudioEngine.syncPlayback(
        currentStep.id,
        currentStep.narration,
        stepElapsedTime,
        isPlaying,
        speed
      );
    }
  }, [currentStep, stepElapsedTime, isPlaying, speed]);

  const lastFrameTimeRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Animation Loop via requestAnimationFrame
  useEffect(() => {
    if (!isPlaying) {
      lastFrameTimeRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const onFrame = (now: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = now;
      } else {
        const deltaSeconds = (now - lastFrameTimeRef.current) / 1000;
        lastFrameTimeRef.current = now;

        setCurrentTime((prev) => {
          const next = prev + deltaSeconds * speed;
          if (next >= totalDuration) {
            setIsPlaying(false);
            AudioEngine.pause();
            return totalDuration;
          }
          return next;
        });
      }

      animationFrameRef.current = requestAnimationFrame(onFrame);
    };

    animationFrameRef.current = requestAnimationFrame(onFrame);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, speed, totalDuration]);

  // Controls
  const play = useCallback(() => {
    setCurrentTime((curr) => {
      if (curr >= totalDuration) return 0;
      return curr;
    });
    setIsPlaying(true);
  }, [totalDuration]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    AudioEngine.pause();
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && currentTime >= totalDuration) {
        setCurrentTime(0);
      }
      if (prev) {
        AudioEngine.pause();
      }
      return !prev;
    });
  }, [currentTime, totalDuration]);

  const restart = useCallback(() => {
    setCurrentTime(0);
    setIsPlaying(true);
    AudioEngine.restart();
  }, []);

  const seek = useCallback(
    (targetTime: number) => {
      const clamped = Math.min(totalDuration, Math.max(0, targetTime));
      setCurrentTime(clamped);
    },
    [totalDuration]
  );

  const nextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      seek(stepStartTimes[currentStepIndex + 1]);
    } else {
      seek(totalDuration);
    }
  }, [currentStepIndex, seek, stepStartTimes, steps.length, totalDuration]);

  const prevStep = useCallback(() => {
    const currentStart = stepStartTimes[currentStepIndex];
    if (currentTime - currentStart > 0.8 || currentStepIndex === 0) {
      seek(currentStart);
    } else {
      seek(stepStartTimes[currentStepIndex - 1]);
    }
  }, [currentStepIndex, currentTime, seek, stepStartTimes]);

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
  }, []);

  return {
    currentTime,
    totalDuration,
    isPlaying,
    speed,
    currentStepIndex,
    stepProgress,
    stepElapsedTime,
    stepEffectiveDuration,
    currentStep,
    play,
    pause,
    togglePlay,
    restart,
    seek,
    nextStep,
    prevStep,
    setSpeed,
  };
}
