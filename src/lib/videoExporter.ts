/**
 * Video Exporter Module
 * Generates standalone MP4/WebM videos with synchronized KaTeX math formulas,
 * typewriter text, dynamic geometry SVG/Canvas animations, and Vietnamese narration.
 * Reuses existing AudioEngine session cache - NEVER calls Gemini or re-calls TTS
 * for already cached steps!
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { LessonScript, LessonPresentationSettings } from '../types/lesson';
import { AudioEngine } from './audioEngine';
import { getTypewriterText, calculateAdaptiveTypingSpeed, getMathRevealProgress } from './mathReveal';
import { getPresentationViewModel, PresentationViewModel } from './presentationModel';
import {
  drawRoundedRect,
  wrapText,
  drawMathExpression,
  drawMathEquationChain,
  drawMixedMathLine,
} from './canvasMathRenderer';
import { drawGeometryOnCanvas } from './canvasGeometryRenderer';

export interface VideoExportOptions {
  resolution: '720p' | '1080p';
  aspectRatio: '16:9' | '9:16';
  fps: number; // 24 or 30
  includeAudio: boolean;
  includeSubtitles: boolean;
}

export type ExportStage =
  | 'idle'
  | 'preparing_audio'
  | 'rendering_frames'
  | 'encoding_audio'
  | 'finalizing'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface ExportProgress {
  stage: ExportStage;
  percent: number; // 0 to 100
  currentFrame: number;
  totalFrames: number;
  timeRemainingSec?: number;
  message: string;
  outputBlob?: Blob;
  outputUrl?: string;
  outputFilename?: string;
  fileSizeMB?: number;
  error?: string;
}

export interface StepTimelineInfo {
  stepIndex: number;
  startTime: number;
  effectiveDuration: number;
  endTime: number;
}

export class VideoExporter {
  private abortController: AbortController | null = null;

  /**
   * Calculates accurate timeline durations for every step taking narration into account
   */
  public static calculateTimelinePlan(lesson: LessonScript): {
    steps: StepTimelineInfo[];
    totalDuration: number;
  } {
    let accumulatedTime = 0;
    const steps: StepTimelineInfo[] = [];

    lesson.steps.forEach((step, idx) => {
      const audioDuration = AudioEngine.getStepDuration(step.id);
      const minFromAudio =
        AudioEngine.settings.enabled && audioDuration && audioDuration > 0
          ? audioDuration + AudioEngine.leadIn + AudioEngine.tailPadding
          : 0;
      const effectiveDuration = Math.max(step.duration || 4, minFromAudio);

      steps.push({
        stepIndex: idx,
        startTime: accumulatedTime,
        effectiveDuration,
        endTime: accumulatedTime + effectiveDuration,
      });

      accumulatedTime += effectiveDuration;
    });

    return { steps, totalDuration: accumulatedTime };
  }

  /**
   * Prepares and merges all audio buffers for the entire lesson into a single AudioBuffer
   */
  private async prepareMergedAudio(
    lesson: LessonScript,
    timelinePlan: { steps: StepTimelineInfo[]; totalDuration: number },
    onProgress: (p: Partial<ExportProgress>) => void,
    signal: AbortSignal
  ): Promise<AudioBuffer | null> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 44100,
    });

    try {
      const stepsWithNarration = lesson.steps.filter((s) => s.narration && s.narration.trim().length > 0);
      let loadedCount = 0;

      // 1. Ensure audio is loaded for all steps (reusing cache)
      for (const step of stepsWithNarration) {
        if (signal.aborted) throw new Error('Quá trình xuất video đã bị huỷ.');

        if (!AudioEngine.hasCachedAudio(step.id, step.narration)) {
          onProgress({
            stage: 'preparing_audio',
            message: `Đang tải giọng đọc bước ${loadedCount + 1}/${stepsWithNarration.length}...`,
            percent: Math.round((loadedCount / stepsWithNarration.length) * 15),
          });
          await AudioEngine.loadStepAudio(step.id, step.narration);
        }
        loadedCount++;
      }

      onProgress({
        stage: 'preparing_audio',
        message: 'Đang tổng hợp dải âm thanh thuyết minh...',
        percent: 15,
      });

      // 2. Decode each step audio and splice into the master audio buffer
      const sampleRate = audioContext.sampleRate;
      const totalSamples = Math.ceil(timelinePlan.totalDuration * sampleRate);
      const masterBuffer = audioContext.createBuffer(1, totalSamples, sampleRate);
      const masterChannelData = masterBuffer.getChannelData(0);

      let lastAudioEndSample = 0;

      for (let i = 0; i < lesson.steps.length; i++) {
        if (signal.aborted) throw new Error('Quá trình xuất video đã bị huỷ.');
        const step = lesson.steps[i];
        const stepInfo = timelinePlan.steps[i];
        if (!step.narration || !step.narration.trim()) continue;

        const cached = AudioEngine.getCachedAudio(step.id, step.narration);
        if (!cached || !cached.arrayBuffer) continue;

        try {
          const decoded = await audioContext.decodeAudioData(cached.arrayBuffer.slice(0));
          const stepChannelData = decoded.getChannelData(0);

          if (decoded.duration > 0) {
            AudioEngine.setStepDuration(step.id, decoded.duration);
          }

          // Planned start at step startTime + leadIn
          const plannedStartSample = Math.floor(
            (stepInfo.startTime + AudioEngine.leadIn) * sampleRate
          );

          // Audio của bước N+1 TUYỆT ĐỐI không được bắt đầu trước khi audio bước N kết thúc
          const actualStartSample = Math.max(
            plannedStartSample,
            lastAudioEndSample + Math.floor(0.12 * sampleRate)
          );

          // Soft fade-in and fade-out to prevent clicks
          const fadeLen = Math.min(Math.floor(0.01 * sampleRate), Math.floor(stepChannelData.length / 4));
          for (let s = 0; s < stepChannelData.length; s++) {
            const targetIdx = actualStartSample + s;
            if (targetIdx < totalSamples) {
              let sampleVal = stepChannelData[s];
              if (s < fadeLen) {
                sampleVal *= s / fadeLen;
              } else if (s > stepChannelData.length - fadeLen) {
                sampleVal *= (stepChannelData.length - s) / fadeLen;
              }
              masterChannelData[targetIdx] += sampleVal;
            }
          }

          lastAudioEndSample = actualStartSample + stepChannelData.length;
        } catch (e) {
          console.warn(`Failed to decode audio for step ${step.id}:`, e);
        }
      }

      return masterBuffer;
    } finally {
      if (audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
      }
    }
  }

  /**
   * Draws a complete video frame at timestamp `timeInSeconds` onto the offscreen canvas
   */
  private renderFrame(
    ctx: CanvasRenderingContext2D,
    lesson: LessonScript,
    settings: LessonPresentationSettings,
    timelinePlan: { steps: StepTimelineInfo[]; totalDuration: number },
    timeInSeconds: number,
    width: number,
    height: number,
    options: VideoExportOptions
  ) {
    // 1. Identify current step and elapsed times
    let currentStepIndex = timelinePlan.steps.length - 1;
    for (let i = 0; i < timelinePlan.steps.length; i++) {
      if (
        timeInSeconds >= timelinePlan.steps[i].startTime &&
        timeInSeconds < timelinePlan.steps[i].endTime
      ) {
        currentStepIndex = i;
        break;
      }
    }

    const currentStepInfo = timelinePlan.steps[currentStepIndex];
    const currentStep = lesson.steps[currentStepIndex];
    const stepElapsedTime = Math.max(0, timeInSeconds - currentStepInfo.startTime);
    const stepProgress = Math.min(1, stepElapsedTime / currentStepInfo.effectiveDuration);

    // Single Source of Truth presentation view model
    const model = getPresentationViewModel(
      lesson,
      currentStepIndex,
      stepElapsedTime,
      currentStepInfo.effectiveDuration,
      {
        settings,
        includeSubtitles: options.includeSubtitles,
      }
    );

    // Narration typewriter for subtitles (only if subtitles enabled)
    const speechElapsed = Math.max(0, stepElapsedTime - AudioEngine.leadIn);
    const narrationSpeedMs = calculateAdaptiveTypingSpeed(
      currentStep?.narration?.length || 55,
      currentStep ? AudioEngine.getStepDuration(currentStep.id) : null,
      28
    );
    const narrationTw = getTypewriterText(
      currentStep?.narration || '',
      speechElapsed,
      narrationSpeedMs,
      model.effectiveRevealMode
    );

    // -------------------------------------------------------------
    // DRAW BACKGROUND
    // -------------------------------------------------------------
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // Grid dots background
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.04)';
    const dotSpacing = Math.round(width / 50);
    for (let gx = 0; gx < width; gx += dotSpacing) {
      for (let gy = 0; gy < height; gy += dotSpacing) {
        ctx.fillRect(gx, gy, 1.5, 1.5);
      }
    }
    ctx.restore();

    // -------------------------------------------------------------
    // TOP HEADER BAR
    // -------------------------------------------------------------
    const headerHeight = Math.round(height * 0.08);
    drawRoundedRect(
      ctx,
      0,
      0,
      width,
      headerHeight,
      0,
      'rgba(255, 255, 255, 0.95)',
      '#e2e8f0',
      1
    );

    // Problem Type badge
    const badgeX = Math.round(width * 0.025);
    const badgeY = Math.round(headerHeight * 0.25);
    const badgeH = Math.round(headerHeight * 0.5);
    const badgeW = Math.round(width * 0.12);
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2, '#e0f2fe', '#bae6fd', 1);

    ctx.save();
    ctx.font = `bold ${Math.round(headerHeight * 0.35)}px sans-serif`;
    ctx.fillStyle = '#0369a1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(model.problemTypeLabel, badgeX + badgeW / 2, badgeY + badgeH / 2);

    // Title
    ctx.font = `bold ${Math.round(headerHeight * 0.42)}px sans-serif`;
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'left';
    ctx.fillText(lesson.title, badgeX + badgeW + 16, headerHeight / 2);

    // Step badge at right
    const stepBadgeText = `Bước ${currentStepIndex + 1}/${lesson.steps.length}`;
    ctx.font = `600 ${Math.round(headerHeight * 0.34)}px sans-serif`;
    const stepTextW = ctx.measureText(stepBadgeText).width + 24;
    const stepBadgeX = width - stepTextW - Math.round(width * 0.025);
    drawRoundedRect(
      ctx,
      stepBadgeX,
      badgeY,
      stepTextW,
      badgeH,
      6,
      '#fef3c7',
      '#fde68a',
      1
    );
    ctx.fillStyle = '#92400e';
    ctx.textAlign = 'center';
    ctx.fillText(stepBadgeText, stepBadgeX + stepTextW / 2, badgeY + badgeH / 2);
    ctx.restore();

    // -------------------------------------------------------------
    // BODY LAYOUT
    // -------------------------------------------------------------
    const bodyTop = headerHeight + Math.round(height * 0.02);
    const bottomSubtitleHeight = options.includeSubtitles ? Math.round(height * 0.085) : 0;
    const bodyHeight = height - bodyTop - bottomSubtitleHeight - Math.round(height * 0.02);
    const pad = Math.round(width * 0.025);

    if (model.hasGeometry && (lesson.geometryScene || lesson.module)) {
      if (options.aspectRatio === '16:9') {
        // Landscape 16:9: match Preview architecture.
        // Problem phase = progressive statement only. Solution phase = cumulative board.
        const leftW = Math.round((width - pad * 3) * 0.42);
        const rightW = width - pad * 3 - leftW;
        const rightX = pad * 2 + leftW;

        if (model.isGeometryProblemPhase) {
          drawRoundedRect(ctx, pad, bodyTop, leftW, bodyHeight, 16, '#ffffff', '#e2e8f0', 1);

          ctx.save();
          ctx.font = 'bold 13px sans-serif';
          ctx.fillStyle = '#64748b';
          ctx.fillText('ĐỀ BÀI', pad + 18, bodyTop + 28);

          drawMixedMathLine(ctx, model.progressiveProblemText, pad + 18, bodyTop + 58, leftW - 36, 22);
          ctx.restore();
        } else {
          const solutionY = bodyTop;
          const solutionH = bodyHeight;
          drawRoundedRect(ctx, pad, solutionY, leftW, solutionH, 16, '#ffffff', '#e2e8f0', 1);

          ctx.save();
          ctx.beginPath();
          ctx.rect(pad + 1, solutionY + 1, leftW - 2, solutionH - 2);
          ctx.clip();

          ctx.font = 'bold 13px sans-serif';
          ctx.fillStyle = '#475569';
          ctx.textBaseline = 'top';
          ctx.fillText('BÀI GIẢI', pad + 16, solutionY + 16);

          let cursorY = solutionY + 46;

          for (const item of model.boardItems) {
            for (const line of item.lines) {
              if (!line.isVisible) continue;
              if (cursorY < solutionY + solutionH - 24) {
                const drawnH = drawMixedMathLine(
                  ctx,
                  line.rawText,
                  pad + 18,
                  cursorY,
                  leftW - 36,
                  17,
                  line.isHighlighted ? '#0369a1' : '#0f172a',
                  line.revealProgress,
                  line.isHighlighted
                );
                cursorY += drawnH + 8;
              }
            }
            cursorY += 4;
          }

          ctx.restore();
        }

        // Right: deterministic geometry diagram stays visible through both phases.
        drawRoundedRect(ctx, rightX, bodyTop, rightW, bodyHeight, 20, '#ffffff', '#cbd5e1', 1.5);
        if (lesson.module) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(rightX + 1, bodyTop + 1, rightW - 2, bodyHeight - 2);
          ctx.clip();
          lesson.module.render(ctx, currentStepIndex, stepProgress, {
            x: rightX,
            y: bodyTop,
            width: rightW,
            height: bodyHeight,
            isPortrait: false,
          });
          ctx.restore();
        } else {
          drawGeometryOnCanvas(
            ctx,
            lesson.geometryScene,
            currentStep,
            stepProgress,
            currentStepInfo.effectiveDuration,
            {
              x: rightX,
              y: bodyTop,
              width: rightW,
              height: bodyHeight,
            }
          );
        }
      } else {
        // Portrait 9:16 Layout: Top (Geometry Diagram) + Bottom (Problem or Solution)
        const topDiagramH = Math.round(bodyHeight * 0.48);
        const bottomContentY = bodyTop + topDiagramH + 14;
        const bottomContentH = bodyHeight - topDiagramH - 14;

        // Top Geometry Diagram
        drawRoundedRect(
          ctx,
          pad,
          bodyTop,
          width - pad * 2,
          topDiagramH,
          18,
          '#ffffff',
          '#cbd5e1',
          1.5
        );

        if (lesson.module) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(pad + 1, bodyTop + 1, width - pad * 2 - 2, topDiagramH - 2);
          ctx.clip();
          lesson.module.render(ctx, currentStepIndex, stepProgress, {
            x: pad,
            y: bodyTop,
            width: width - pad * 2,
            height: topDiagramH,
            isPortrait: true,
          });
          ctx.restore();
        } else {
          drawGeometryOnCanvas(
            ctx,
            lesson.geometryScene,
            currentStep,
            stepProgress,
            currentStepInfo.effectiveDuration,
            {
              x: pad,
              y: bodyTop,
              width: width - pad * 2,
              height: topDiagramH,
            }
          );
        }

        // Bottom Problem or Solution card
        if (model.isGeometryProblemPhase) {
          drawRoundedRect(
            ctx,
            pad,
            bottomContentY,
            width - pad * 2,
            bottomContentH,
            18,
            '#ffffff',
            '#e2e8f0',
            1
          );

          ctx.save();
          ctx.font = 'bold 12px sans-serif';
          ctx.fillStyle = '#64748b';
          ctx.fillText('ĐỀ BÀI', pad + 16, bottomContentY + 24);

          drawMixedMathLine(ctx, model.progressiveProblemText, pad + 16, bottomContentY + 48, width - pad * 2 - 32, 17);
          ctx.restore();
        } else {
          drawRoundedRect(
            ctx,
            pad,
            bottomContentY,
            width - pad * 2,
            bottomContentH,
            18,
            '#ffffff',
            '#e2e8f0',
            1
          );

          ctx.save();
          ctx.beginPath();
          ctx.rect(pad + 1, bottomContentY + 1, width - pad * 2 - 2, bottomContentH - 2);
          ctx.clip();

          ctx.font = 'bold 12px sans-serif';
          ctx.fillStyle = '#475569';
          ctx.textBaseline = 'top';
          ctx.fillText('BÀI GIẢI', pad + 16, bottomContentY + 16);

          let cursorY = bottomContentY + 42;
          for (const item of model.boardItems) {
            for (const line of item.lines) {
              if (!line.isVisible) continue;
              if (cursorY < bottomContentY + bottomContentH - 20) {
                const drawnH = drawMixedMathLine(
                  ctx,
                  line.rawText,
                  pad + 16,
                  cursorY,
                  width - pad * 2 - 32,
                  15,
                  line.isHighlighted ? '#0369a1' : '#0f172a',
                  line.revealProgress,
                  line.isHighlighted
                );
                cursorY += drawnH + 6;
              }
            }
            cursorY += 3;
          }
          ctx.restore();
        }
      }
    } else {
      // -------------------------------------------------------------
      // ALGEBRA / NON-GEOMETRY LAYOUT
      // -------------------------------------------------------------
      if (options.aspectRatio === '16:9') {
        const leftW = Math.round((width - pad * 3) * 0.38);
        const rightW = width - pad * 3 - leftW;
        const rightX = pad * 2 + leftW;

        // 1. Problem Card
        drawRoundedRect(ctx, pad, bodyTop, leftW, bodyHeight, 16, '#ffffff', '#e2e8f0', 1);

        ctx.save();
        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('✨ ĐỀ BÀI', pad + 20, bodyTop + 26);

        drawMixedMathLine(ctx, model.progressiveProblemText, pad + 20, bodyTop + 54, leftW - 40, 18);
        ctx.restore();

        // 2. Solution Board with model.boardItems
        drawRoundedRect(ctx, rightX, bodyTop, rightW, bodyHeight, 16, '#ffffff', '#e2e8f0', 1);

        ctx.save();
        ctx.beginPath();
        ctx.rect(rightX + 1, bodyTop + 1, rightW - 2, bodyHeight - 2);
        ctx.clip();

        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = '#0284c7';
        ctx.fillText('LỜI GIẢI', rightX + 20, bodyTop + 26);

        let cursorY = bodyTop + 54;
        for (const item of model.boardItems) {
          for (const line of item.lines) {
            if (!line.isVisible) continue;
            if (cursorY < bodyTop + bodyHeight - 24) {
              const drawnH = drawMixedMathLine(
                ctx,
                line.rawText,
                rightX + 22,
                cursorY,
                rightW - 44,
                18,
                line.isHighlighted ? '#0369a1' : '#0f172a',
                line.revealProgress,
                line.isHighlighted
              );
              cursorY += drawnH + 8;
            }
          }
          cursorY += 4;
        }
        ctx.restore();
      } else {
        // Portrait 9:16 Algebra
        const probH = Math.round(bodyHeight * 0.28);
        const actY = bodyTop + probH + 14;
        const actH = bodyHeight - probH - 14;

        // 1. Problem Card
        drawRoundedRect(ctx, pad, bodyTop, width - pad * 2, probH, 16, '#ffffff', '#e2e8f0', 1);

        ctx.save();
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('✨ ĐỀ BÀI', pad + 18, bodyTop + 24);

        drawMixedMathLine(ctx, model.progressiveProblemText, pad + 18, bodyTop + 48, width - pad * 2 - 36, 16);
        ctx.restore();

        // 2. Solution Board
        drawRoundedRect(ctx, pad, actY, width - pad * 2, actH, 16, '#ffffff', '#e2e8f0', 1);

        ctx.save();
        ctx.beginPath();
        ctx.rect(pad + 1, actY + 1, width - pad * 2 - 2, actH - 2);
        ctx.clip();

        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#0284c7';
        ctx.fillText('LỜI GIẢI', pad + 18, actY + 22);

        let cursorY = actY + 48;
        for (const item of model.boardItems) {
          for (const line of item.lines) {
            if (!line.isVisible) continue;
            if (cursorY < actY + actH - 20) {
              const drawnH = drawMixedMathLine(
                ctx,
                line.rawText,
                pad + 18,
                cursorY,
                width - pad * 2 - 36,
                15,
                line.isHighlighted ? '#0369a1' : '#0f172a',
                line.revealProgress,
                line.isHighlighted
              );
              cursorY += drawnH + 6;
            }
          }
          cursorY += 3;
        }
        ctx.restore();
      }
    }

    // -------------------------------------------------------------
    // BOTTOM NARRATION SUBTITLES (YOUTUBE / TIKTOK STYLE)
    // -------------------------------------------------------------
    if (options.includeSubtitles && currentStep?.narration) {
      const subY = height - bottomSubtitleHeight - 12;
      const subW = width - pad * 2;

      drawRoundedRect(
        ctx,
        pad,
        subY,
        subW,
        bottomSubtitleHeight,
        14,
        'rgba(15, 23, 42, 0.94)',
        'rgba(51, 65, 85, 0.8)',
        1
      );

      ctx.save();
      // Teacher microphone icon text
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('LỜI GIẢNG', pad + 16, subY + 18);

      // Subtitle typewriter text
      ctx.font = `500 ${Math.round(height * 0.021)}px sans-serif`;
      ctx.fillStyle = '#f8fafc';
      const subLines = wrapText(ctx, narrationTw.text, subW - 36);
      subLines.slice(0, 2).forEach((l, i) => {
        ctx.fillText(l, pad + 16, subY + 38 + i * 20);
      });
      ctx.restore();
    }
  }

  /**
   * Encodes audio chunk into AudioData for WebCodecs
   */
  private createAudioData(
    channelData: Float32Array,
    startSample: number,
    numSamples: number,
    sampleRate: number,
    timestampMicros: number
  ): AudioData {
    const pcmData = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const srcIdx = startSample + i;
      pcmData[i] = srcIdx < channelData.length ? channelData[srcIdx] : 0;
    }

    return new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: numSamples,
      numberOfChannels: 1,
      timestamp: timestampMicros,
      data: pcmData,
    });
  }

  /**
   * Main Export Function: Renders video & audio and outputs a Blob
   */
  public async exportVideo(
    lesson: LessonScript,
    settings: LessonPresentationSettings,
    options: VideoExportOptions,
    onProgress: (p: ExportProgress) => void
  ): Promise<Blob> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // 1. Dimensions
    let width = 1280;
    let height = 720;
    if (options.aspectRatio === '9:16') {
      width = options.resolution === '1080p' ? 1080 : 720;
      height = options.resolution === '1080p' ? 1920 : 1280;
    } else {
      width = options.resolution === '1080p' ? 1920 : 1280;
      height = options.resolution === '1080p' ? 1080 : 720;
    }

    const fps = options.fps || 30;

    // 2. Prepare narration BEFORE final timeline planning.
    // A fresh AI Studio import starts with an empty audio cache. If we calculate
    // the timeline first, short default step durations can make later narration
    // start while the previous TTS clip is still speaking, causing echo/double voice.
    let timelinePlan = VideoExporter.calculateTimelinePlan(lesson);
    let totalFrames = Math.max(1, Math.ceil(timelinePlan.totalDuration * fps));

    onProgress({
      stage: 'preparing_audio',
      percent: 5,
      currentFrame: 0,
      totalFrames,
      message: 'Đang nạp và đo thời lượng giọng đọc trước khi dựng timeline...',
    });

    if (options.includeAudio) {
      const narratedSteps = lesson.steps.filter((step) => step.narration?.trim());
      for (let i = 0; i < narratedSteps.length; i++) {
        if (signal.aborted) throw new Error('Quá trình xuất video đã bị huỷ.');
        const step = narratedSteps[i];

        if (!AudioEngine.hasCachedAudio(step.id, step.narration)) {
          await AudioEngine.loadStepAudio(step.id, step.narration);
        }

        onProgress({
          stage: 'preparing_audio',
          percent: Math.min(18, 5 + Math.round(((i + 1) / Math.max(1, narratedSteps.length)) * 13)),
          currentFrame: 0,
          totalFrames,
          message: `Đang chuẩn bị giọng đọc ${i + 1}/${narratedSteps.length}...`,
        });
      }

      // Recalculate with the real measured TTS durations.
      timelinePlan = VideoExporter.calculateTimelinePlan(lesson);
      totalFrames = Math.max(1, Math.ceil(timelinePlan.totalDuration * fps));
    }

    // 3. Merge audio using the FINAL timeline so adjacent steps never overlap.
    let masterAudioBuffer: AudioBuffer | null = null;
    if (options.includeAudio) {
      AudioEngine.pause();
      masterAudioBuffer = await this.prepareMergedAudio(
        lesson,
        timelinePlan,
        (partial) => {
          onProgress({
            stage: partial.stage || 'preparing_audio',
            percent: partial.percent || 18,
            currentFrame: 0,
            totalFrames,
            message: partial.message || 'Đang ghép dải âm thanh...',
          });
        },
        signal
      );
    }

    // Load the same bundled math fonts used in Preview before measuring Canvas text.
    if (document.fonts) {
      await Promise.all([
        document.fonts.load('17px KaTeX_Main'),
        document.fonts.load('italic 17px KaTeX_Math'),
        document.fonts.load('17px KaTeX_Size1'),
      ]);
      await document.fonts.ready;
    }

    // 4. Create Off-screen Canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Không thể khởi tạo Canvas 2D.');

    // -------------------------------------------------------------
    // ATTEMPT 1: WEBCODECS + MP4-MUXER (Pure MP4, Fast, High Quality)
    // -------------------------------------------------------------
    const hasWebCodecs =
      typeof (window as any).VideoEncoder === 'function' &&
      typeof (window as any).VideoFrame === 'function';

    if (hasWebCodecs) {
      try {
        const resultBlob = await this.exportWithWebCodecs(
          canvas,
          ctx,
          lesson,
          settings,
          timelinePlan,
          totalFrames,
          fps,
          width,
          height,
          masterAudioBuffer,
          options,
          onProgress,
          signal
        );
        return resultBlob;
      } catch (err: any) {
        if (signal.aborted) throw err;
        console.warn('WebCodecs encoding fallback triggered:', err);
      }
    }

    // -------------------------------------------------------------
    // ATTEMPT 2: MEDIARECORDER FALLBACK (Broad Browser Support)
    // -------------------------------------------------------------
    return await this.exportWithMediaRecorder(
      canvas,
      ctx,
      lesson,
      settings,
      timelinePlan,
      totalFrames,
      fps,
      width,
      height,
      masterAudioBuffer,
      options,
      onProgress,
      signal
    );
  }

  /**
   * Fast offline encoding using WebCodecs & mp4-muxer
   */
  private async exportWithWebCodecs(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    lesson: LessonScript,
    settings: LessonPresentationSettings,
    timelinePlan: { steps: StepTimelineInfo[]; totalDuration: number },
    totalFrames: number,
    fps: number,
    width: number,
    height: number,
    masterAudioBuffer: AudioBuffer | null,
    options: VideoExportOptions,
    onProgress: (p: ExportProgress) => void,
    signal: AbortSignal
  ): Promise<Blob> {
    const muxerTarget = new ArrayBufferTarget();

    const muxer = new Muxer({
      target: muxerTarget,
      video: {
        codec: 'avc',
        width,
        height,
        frameRate: fps,
      },
      audio:
        masterAudioBuffer && options.includeAudio
          ? {
              codec: 'aac',
              numberOfChannels: 1,
              sampleRate: masterAudioBuffer.sampleRate,
            }
          : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'strict',
    });

    // Setup VideoEncoder
    let videoEncoderError: Error | null = null;
    const videoEncoder = new (window as any).VideoEncoder({
      output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
      error: (e: any) => {
        videoEncoderError = e;
      },
    });

    const videoBitrate = options.resolution === '1080p' ? 8_000_000 : 4_500_000;
    videoEncoder.configure({
      codec: 'avc1.4d002a', // H.264 Main Profile Level 4.2
      width,
      height,
      bitrate: videoBitrate,
      framerate: fps,
    });

    // Setup AudioEncoder if audio is present
    let audioEncoder: any = null;
    if (masterAudioBuffer && options.includeAudio && typeof (window as any).AudioEncoder === 'function') {
      try {
        audioEncoder = new (window as any).AudioEncoder({
          output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
          error: (e: any) => console.warn('AudioEncoder warning:', e),
        });

        audioEncoder.configure({
          codec: 'mp4a.40.2', // AAC-LC
          numberOfChannels: 1,
          sampleRate: masterAudioBuffer.sampleRate,
          bitrate: 128_000,
        });
      } catch (err) {
        console.warn('AudioEncoder init failed, omitting audio track from MP4:', err);
        audioEncoder = null;
      }
    }

    // 1. Render Video Frames
    const startTimeReal = performance.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      if (signal.aborted) {
        videoEncoder.close();
        if (audioEncoder) audioEncoder.close();
        throw new Error('Đã huỷ xuất video.');
      }

      if (videoEncoderError) throw videoEncoderError;

      const timeInSeconds = frame / fps;
      this.renderFrame(ctx, lesson, settings, timelinePlan, timeInSeconds, width, height, options);

      const timestampMicros = Math.round(timeInSeconds * 1_000_000);
      const videoFrame = new (window as any).VideoFrame(canvas, {
        timestamp: timestampMicros,
      });

      // Keyframe every 2 seconds
      const isKeyFrame = frame % (fps * 2) === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Yield event loop occasionally and report progress
      if (frame % 6 === 0 || frame === totalFrames - 1) {
        await new Promise((r) => setTimeout(r, 0));
        const elapsedReal = (performance.now() - startTimeReal) / 1000;
        const fpsReal = (frame + 1) / Math.max(0.001, elapsedReal);
        const remFrames = totalFrames - frame - 1;
        const timeRemainingSec = Math.round(remFrames / Math.max(1, fpsReal));
        const progressPercent = 20 + Math.round(((frame + 1) / totalFrames) * 65);

        onProgress({
          stage: 'rendering_frames',
          percent: progressPercent,
          currentFrame: frame + 1,
          totalFrames,
          timeRemainingSec,
          message: `Đang render khung hình ${frame + 1}/${totalFrames} (${progressPercent}%)...`,
        });
      }
    }

    // 2. Encode Audio Samples if AudioEncoder was initialized
    if (audioEncoder && masterAudioBuffer) {
      onProgress({
        stage: 'encoding_audio',
        percent: 88,
        currentFrame: totalFrames,
        totalFrames,
        message: 'Đang mã hoá âm thanh giọng đọc tiếng Việt...',
      });

      const channelData = masterAudioBuffer.getChannelData(0);
      const sampleRate = masterAudioBuffer.sampleRate;
      const samplesPerChunk = 1024;
      const totalAudioChunks = Math.ceil(channelData.length / samplesPerChunk);

      for (let chunkIdx = 0; chunkIdx < totalAudioChunks; chunkIdx++) {
        const startSample = chunkIdx * samplesPerChunk;
        const numSamples = Math.min(samplesPerChunk, channelData.length - startSample);
        const timestampMicros = Math.round((startSample / sampleRate) * 1_000_000);

        const audioData = this.createAudioData(
          channelData,
          startSample,
          numSamples,
          sampleRate,
          timestampMicros
        );

        audioEncoder.encode(audioData);
        audioData.close();
      }

      await audioEncoder.flush();
      audioEncoder.close();
    }

    onProgress({
      stage: 'finalizing',
      percent: 95,
      currentFrame: totalFrames,
      totalFrames,
      message: 'Đang đóng gói tệp video MP4 hoàn chỉnh...',
    });

    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();

    const outputBlob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
    const outputUrl = URL.createObjectURL(outputBlob);
    const fileSizeMB = Number((outputBlob.size / (1024 * 1024)).toFixed(2));
    const outputFilename = `${lesson.title.replace(/[\/\\?%*:|"<>]/g, '_')}_${options.aspectRatio}.mp4`;

    onProgress({
      stage: 'completed',
      percent: 100,
      currentFrame: totalFrames,
      totalFrames,
      outputBlob,
      outputUrl,
      outputFilename,
      fileSizeMB,
      message: `Xuất video MP4 thành công (${fileSizeMB} MB)!`,
    });

    return outputBlob;
  }

  /**
   * Universal Fallback using MediaRecorder API
   */
  private async exportWithMediaRecorder(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    lesson: LessonScript,
    settings: LessonPresentationSettings,
    timelinePlan: { steps: StepTimelineInfo[]; totalDuration: number },
    totalFrames: number,
    fps: number,
    width: number,
    height: number,
    masterAudioBuffer: AudioBuffer | null,
    options: VideoExportOptions,
    onProgress: (p: ExportProgress) => void,
    signal: AbortSignal
  ): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();

      if (masterAudioBuffer && options.includeAudio) {
        const source = audioContext.createBufferSource();
        source.buffer = masterAudioBuffer;
        source.connect(destination);
        source.start(0);
      }

      const canvasStream = canvas.captureStream(fps);
      const combinedTracks = [
        ...canvasStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ];
      const combinedStream = new MediaStream(combinedTracks);

      const mimeType = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: options.resolution === '1080p' ? 8_000_000 : 4_500_000,
      });

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        audioContext.close().catch(() => {});
        const isMp4 = mimeType.includes('mp4');
        const outputBlob = new Blob(chunks, { type: mimeType });
        const outputUrl = URL.createObjectURL(outputBlob);
        const fileSizeMB = Number((outputBlob.size / (1024 * 1024)).toFixed(2));
        const ext = isMp4 ? 'mp4' : 'webm';
        const outputFilename = `${lesson.title.replace(/[\/\\?%*:|"<>]/g, '_')}_${options.aspectRatio}.${ext}`;

        onProgress({
          stage: 'completed',
          percent: 100,
          currentFrame: totalFrames,
          totalFrames,
          outputBlob,
          outputUrl,
          outputFilename,
          fileSizeMB,
          message: `Xuất video thành công (${fileSizeMB} MB)!`,
        });

        resolve(outputBlob);
      };

      recorder.onerror = (e) => {
        audioContext.close().catch(() => {});
        reject(e);
      };

      recorder.start(100);

      const frameIntervalMs = 1000 / fps;
      let frame = 0;

      const renderInterval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(renderInterval);
          recorder.stop();
          reject(new Error('Đã huỷ xuất video.'));
          return;
        }

        if (frame >= totalFrames) {
          clearInterval(renderInterval);
          setTimeout(() => recorder.stop(), 300);
          return;
        }

        const timeInSeconds = frame / fps;
        this.renderFrame(ctx, lesson, settings, timelinePlan, timeInSeconds, width, height, options);

        if (frame % 10 === 0 || frame === totalFrames - 1) {
          const percent = 20 + Math.round(((frame + 1) / totalFrames) * 75);
          onProgress({
            stage: 'rendering_frames',
            percent,
            currentFrame: frame + 1,
            totalFrames,
            message: `Đang ghi video ${frame + 1}/${totalFrames} (${percent}%)...`,
          });
        }

        frame++;
      }, frameIntervalMs);
    });
  }

  /**
   * Cancel ongoing export process
   */
  public cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
