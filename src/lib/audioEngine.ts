/**
 * AudioEngine Module
 * Handles Vietnamese Text-to-Speech generation, preloading, playback,
 * session caching, quota circuit breaker, and synchronization with the timeline.
 * Uses Gemini TTS only for lesson narration; no browser-voice fallback.
 */

import { getTtsProfile, matchesTtsProfile, getClientTtsCacheKey, type TtsProfile } from './ttsProfile';
import {
  getStoredAudioClip,
  saveStoredAudioClip,
  getAllStoredAudioClips,
} from './ttsStorage';

export interface VoiceSettings {
  enabled: boolean;
  voiceName: 'Kore' | 'Puck' | 'Zephyr' | 'Charon'; // Kore = Nữ, Puck = Nam
  voiceSpeed: 'slow' | 'normal' | 'fast'; // 0.85x | 1.0x | 1.15x
}

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error';

export interface StepAudioInfo {
  stepId: string;
  audioUrl?: string;
  duration?: number;
  status: AudioStatus;
  error?: string;
}

export interface CachedAudioItem {
  audioUrl: string;
  duration: number;
  blob: Blob;
  arrayBuffer: ArrayBuffer;
  ttsProfile: Readonly<TtsProfile>;
}

export interface PreloadLessonResult {
  ready: number;
  failed: number;
  total: number;
  failedStepIndex?: number;
  failedStepId?: string;
  failedReason?: string;
  quotaExceeded: boolean;
}

export interface AudioEngineListener {
  onStatusChange?: (stepId: string, status: AudioStatus, error?: string) => void;
  onDurationsUpdated?: (durations: Record<string, number>) => void;
  onQuotaExceededChange?: (isExceeded: boolean) => void;
}

class AudioEngineClass {
  // Session cache distinguishes the complete TTS profile as well as the transcript.
  private cache = new Map<string, CachedAudioItem>();
  private stepDurations: Record<string, number> = {};
  private stepStatus: Record<string, AudioStatus> = {};
  private stepErrors = new Map<string, string>();
  private hydrationPromise: Promise<void> | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private narrationCueAudio: HTMLAudioElement | null = null;
  private cancelNarrationCuePlayback: (() => void) | null = null;
  private currentStepId: string | null = null;
  private listeners = new Set<AudioEngineListener>();
  private activePreloadAbortControllers = new Map<string, AbortController>();

  private lastSpokenStepId: string | null = null;

  public isQuotaExceeded = false;
  public leadIn = 0.25; // seconds before narration starts
  public tailPadding = 0.45; // seconds after narration completes

  public settings: VoiceSettings = {
    enabled: true,
    voiceName: 'Kore',
    voiceSpeed: 'normal',
  };

  constructor() {
    if (typeof window !== 'undefined') {
      this.currentAudioElement = new Audio();
      this.currentAudioElement.preload = 'auto';

      this.currentAudioElement.onerror = (e) => {
        console.warn('Audio element error:', e);
      };
      this.hydrationPromise = this.hydrateFromIndexedDB();
    }
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const storedItems = await getAllStoredAudioClips();
      for (const item of storedItems) {
        if (!item.audioBase64 || !item.cacheKey) continue;
        if (this.cache.has(item.cacheKey)) continue;

        try {
          const byteCharacters = atob(item.audioBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const arrayBuffer = byteArray.buffer.slice(0);
          const blob = new Blob([byteArray], { type: item.mimeType || 'audio/wav' });
          const audioUrl = URL.createObjectURL(blob);

          const result: CachedAudioItem = {
            audioUrl,
            duration: item.duration || 4.0,
            blob,
            arrayBuffer,
            ttsProfile: item.ttsProfile,
          };
          this.cache.set(item.cacheKey, result);
        } catch (itemErr) {
          console.warn('Failed to hydrate audio item from IndexedDB:', itemErr);
        }
      }
    } catch (err) {
      console.warn('Failed to hydrate audio cache from IndexedDB:', err);
    }
  }

  public subscribe(listener: AudioEngineListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyStatus(stepId: string, status: AudioStatus, error?: string) {
    this.stepStatus[stepId] = status;
    this.listeners.forEach((l) => l.onStatusChange?.(stepId, status, error));
  }

  private notifyDurations() {
    this.listeners.forEach((l) => l.onDurationsUpdated?.({ ...this.stepDurations }));
  }

  public setQuotaExceeded(exceeded: boolean) {
    this.isQuotaExceeded = exceeded;
    this.listeners.forEach((l) => l.onQuotaExceededChange?.(exceeded));
  }

  public getCacheKey(stepId: string, narration: string, voiceName = this.settings.voiceName): string {
    return getClientTtsCacheKey(getTtsProfile(voiceName), stepId, narration, this.settings.voiceSpeed);
  }

  public getStepStatus(stepId: string): AudioStatus {
    return this.stepStatus[stepId] || 'idle';
  }

  public getStepError(stepId: string): string | undefined {
    return this.stepErrors.get(stepId);
  }

  public getStepDuration(stepId: string): number | null {
    return this.stepDurations[stepId] || null;
  }

  public setStepDuration(stepId: string, duration: number) {
    if (isFinite(duration) && duration > 0) {
      this.stepDurations[stepId] = duration;
      this.notifyDurations();
    }
  }

  public getAllStepDurations(): Record<string, number> {
    return { ...this.stepDurations };
  }

  /**
   * Estimate reasonable speech duration in seconds for Vietnamese (~13-15 chars per sec)
   */
  public estimateSpeechDuration(narration: string): number {
    if (!narration) return 3.5;
    const clean = narration.trim();
    return Math.max(3.2, Math.min(12, Number((clean.length / 14.5).toFixed(2))));
  }

  /**
   * Generates a clean silent PCM WAV ArrayBuffer for offline video muxing when API is unavailable
   */
  private generateSilentWavBuffer(durationSec: number, sampleRate = 44100): ArrayBuffer {
    const numSamples = Math.ceil(durationSec * sampleRate);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // WAV Header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, 1, true); // NumChannels (1 mono)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true); // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    return buffer;
  }

  public hasCachedAudio(stepId: string, narration: string, voiceName = this.settings.voiceName): boolean {
    const key = this.getCacheKey(stepId, narration, voiceName);
    return this.cache.has(key);
  }

  public getCachedAudio(stepId: string, narration: string, voiceName = this.settings.voiceName): CachedAudioItem | null {
    const key = this.getCacheKey(stepId, narration, voiceName);
    return this.cache.get(key) || null;
  }

  /**
   * Returns ArrayBuffer for a step's audio. If API quota is exceeded, creates a silent fallback WAV
   */
  public async getAudioArrayBuffer(
    stepId: string,
    narration: string,
    voiceName = this.settings.voiceName
  ): Promise<ArrayBuffer | null> {
    const cached = this.getCachedAudio(stepId, narration, voiceName);
    if (cached) {
      return cached.arrayBuffer.slice(0);
    }

    if (this.isQuotaExceeded) return null;

    const loaded = await this.loadStepAudio(stepId, narration, voiceName);
    return loaded ? loaded.arrayBuffer.slice(0) : null;
  }

  /**
   * Fetches Gemini TTS audio from cache, IndexedDB, or /api/tts
   */
  public async loadStepAudio(
    stepId: string,
    narration: string,
    voiceName = this.settings.voiceName
  ): Promise<CachedAudioItem | null> {
    if (!narration || !narration.trim()) {
      return null;
    }

    const profile = getTtsProfile(voiceName);
    const key = getClientTtsCacheKey(profile, stepId, narration, this.settings.voiceSpeed);

    // 1. In-memory cache check
    if (this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      this.stepDurations[stepId] = cached.duration;
      this.stepErrors.delete(stepId);
      this.notifyStatus(stepId, 'ready');
      return cached;
    }

    // Wait for initial IndexedDB hydration if still in progress
    if (this.hydrationPromise) {
      await this.hydrationPromise;
      if (this.cache.has(key)) {
        const cached = this.cache.get(key)!;
        this.stepDurations[stepId] = cached.duration;
        this.stepErrors.delete(stepId);
        this.notifyStatus(stepId, 'ready');
        return cached;
      }
    }

    // 2. Direct IndexedDB persistent cache lookup (survives F5 / page reload)
    try {
      const stored = await getStoredAudioClip(key);
      if (stored && stored.audioBase64) {
        const byteCharacters = atob(stored.audioBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const arrayBuffer = byteArray.buffer.slice(0);
        const blob = new Blob([byteArray], { type: stored.mimeType || 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        const duration = stored.duration || (await this.measureAudioDuration(audioUrl));

        const result: CachedAudioItem = { audioUrl, duration, blob, arrayBuffer, ttsProfile: profile };
        this.cache.set(key, result);
        this.stepDurations[stepId] = duration;
        this.stepErrors.delete(stepId);
        this.notifyStatus(stepId, 'ready');
        this.notifyDurations();
        return result;
      }
    } catch (storageReadErr) {
      console.warn('Error reading stored audio from IndexedDB:', storageReadErr);
    }

    // A quota/error state must never create or cache fake/silent narration.
    if (this.isQuotaExceeded) {
      const quotaMsg = 'Hạn ngạch Gemini TTS đã đạt giới hạn (429 Quota Exceeded). Vui lòng thử lại sau.';
      this.stepErrors.set(stepId, quotaMsg);
      this.notifyStatus(stepId, 'error', quotaMsg);
      return null;
    }

    this.notifyStatus(stepId, 'loading');

    const controller = new AbortController();
    this.activePreloadAbortControllers.set(stepId, controller);

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: narration,
          voiceName,
          ttsProfile: profile,
        }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        const errJson = await response.json().catch(() => ({}));
        const quotaMsg =
          errJson.message ||
          'Hạn ngạch Gemini TTS đã đạt giới hạn (429 Quota Exceeded). Vui lòng thử lại sau.';
        this.setQuotaExceeded(true);
        this.stepErrors.set(stepId, quotaMsg);
        this.activePreloadAbortControllers.forEach((c) => c.abort());
        this.activePreloadAbortControllers.clear();

        this.notifyStatus(stepId, 'error', quotaMsg);
        return null;
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const realReason = errJson.message || errJson.error || `Lỗi máy chủ HTTP ${response.status}`;
        this.stepErrors.set(stepId, realReason);
        throw new Error(realReason);
      }

      const data = await response.json();
      if (!data.audioBase64) {
        const emptyMsg = 'Dữ liệu âm thanh rỗng từ API';
        this.stepErrors.set(stepId, emptyMsg);
        throw new Error(emptyMsg);
      }
      if (!matchesTtsProfile(data.ttsProfile, profile)) {
        const profileMsg = 'Profile giọng đọc không khớp. Vui lòng tải lại ứng dụng để dùng giọng đồng nhất.';
        this.stepErrors.set(stepId, profileMsg);
        throw new Error(profileMsg);
      }

      // Convert base64 to Blob & ArrayBuffer
      const byteCharacters = atob(data.audioBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const arrayBuffer = byteArray.buffer.slice(0);
      const blob = new Blob([byteArray], { type: data.mimeType || 'audio/wav' });
      const audioUrl = URL.createObjectURL(blob);

      // Measure exact audio duration
      const duration = await this.measureAudioDuration(audioUrl);

      const result: CachedAudioItem = { audioUrl, duration, blob, arrayBuffer, ttsProfile: profile };
      this.cache.set(key, result);
      this.stepDurations[stepId] = duration;
      this.stepErrors.delete(stepId);

      // Persist to IndexedDB so F5 does not require re-fetching
      saveStoredAudioClip({
        cacheKey: key,
        audioBase64: data.audioBase64,
        mimeType: data.mimeType || 'audio/wav',
        duration,
        ttsProfile: profile,
        timestamp: Date.now(),
      }).catch((saveErr) => console.warn('Failed to save to IndexedDB:', saveErr));

      this.notifyStatus(stepId, 'ready');
      this.notifyDurations();

      return result;
    } catch (err: any) {
      if (err.name === 'AbortError') return null;

      const isQuotaErr =
        String(err?.message || '').includes('QUOTA') ||
        String(err?.message || '').includes('429');

      const realErrorMsg = isQuotaErr
        ? 'Hạn ngạch Gemini TTS đã đạt giới hạn (429 Quota Exceeded). Vui lòng thử lại sau.'
        : err?.message || 'Lỗi không xác định khi tạo giọng đọc';

      if (isQuotaErr) {
        this.setQuotaExceeded(true);
      }

      this.stepErrors.set(stepId, realErrorMsg);
      const estDuration = this.estimateSpeechDuration(narration);
      this.stepDurations[stepId] = estDuration;
      this.notifyStatus(stepId, 'error', realErrorMsg);
      this.notifyDurations();
      return null;
    } finally {
      this.activePreloadAbortControllers.delete(stepId);
    }
  }

  /**
   * Preloads narration sequentially so playback never outruns TTS generation.
   * - Never recreates successfully cached clips.
   * - Retries missing steps sequentially (max 2 attempts/step) with a gentle delay.
   * - Retains single TTS profile (Kore) across the entire lesson.
   * - Skips steps without narration (never marks them as missing).
   * - Captures the exact failing step index and real error message.
   */
  public async preloadLesson(
    steps: { id: string; narration: string; title?: string }[],
    voiceName = this.settings.voiceName
  ): Promise<PreloadLessonResult> {
    if (!this.settings.enabled) {
      return { ready: 0, failed: 0, total: 0, quotaExceeded: false };
    }

    if (this.hydrationPromise) {
      await this.hydrationPromise;
    }

    // A fresh preparation attempt resets transient state to try missing steps
    this.setQuotaExceeded(false);

    // Requirement 5: Step không có narration thì bỏ qua, KHÔNG tính là “thiếu giọng”
    const narratedSteps = steps.filter((step) => step?.narration?.trim());
    if (narratedSteps.length === 0) {
      return { ready: 0, failed: 0, total: 0, quotaExceeded: false };
    }

    let ready = 0;
    let failed = 0;
    let firstFailedStepIndex: number | undefined;
    let firstFailedStepId: string | undefined;
    let firstFailedReason: string | undefined;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const text = step?.narration?.trim();
      if (!text) continue; // Skip steps without narration completely

      const stepIndex = i + 1; // 1-based index for user/teacher display

      // Requirement 2: KHÔNG tạo lại clip đã thành công. Chỉ retry những step còn thiếu audio.
      if (this.hasCachedAudio(step.id, text, voiceName)) {
        ready++;
        continue;
      }

      // If quota was already exceeded by an earlier step, stop immediately
      if (this.isQuotaExceeded) {
        failed++;
        if (!firstFailedStepIndex) {
          firstFailedStepIndex = stepIndex;
          firstFailedStepId = step.id;
          firstFailedReason =
            this.getStepError(step.id) ||
            'Hạn ngạch Gemini TTS đã đạt giới hạn (429 Quota Exceeded). Vui lòng thử lại sau.';
        }
        break;
      }

      // Requirement 3: Retry tuần tự, không gọi TTS song song: tối đa 2 lần/step, có delay ngắn
      let loaded: CachedAudioItem | null = null;
      for (let attempt = 1; attempt <= 2 && !this.isQuotaExceeded; attempt++) {
        loaded = await this.loadStepAudio(step.id, text, voiceName);
        if (loaded) break;
        if (attempt < 2 && !this.isQuotaExceeded) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      if (loaded) {
        ready++;
        // Gentle gap between successful step generations
        if (!this.isQuotaExceeded) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } else {
        failed++;
        if (!firstFailedStepIndex) {
          firstFailedStepIndex = stepIndex;
          firstFailedStepId = step.id;
          firstFailedReason =
            this.getStepError(step.id) ||
            (this.isQuotaExceeded
              ? 'Hạn ngạch Gemini TTS đã đạt giới hạn (429 Quota Exceeded). Vui lòng thử lại sau.'
              : 'Không nhận được âm thanh từ Gemini TTS');
        }
        if (this.isQuotaExceeded) break;
      }
    }

    return {
      ready,
      failed,
      total: narratedSteps.length,
      failedStepIndex: firstFailedStepIndex,
      failedStepId: firstFailedStepId,
      failedReason: firstFailedReason,
      quotaExceeded: this.isQuotaExceeded,
    };
  }

  private measureAudioDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const tempAudio = new Audio(url);
      tempAudio.onloadedmetadata = () => {
        const d = tempAudio.duration;
        if (isFinite(d) && d > 0) {
          resolve(d);
        } else {
          resolve(4.0);
        }
      };
      tempAudio.onerror = () => {
        resolve(4.0);
      };
    });
  }

  /**
   * Called synchronously from a user click before a long TTS preload. This
   * primes browser audio permission so the later Kore cue is not treated as
   * unsolicited autoplay after the async preload has finished.
   */
  public unlockPlayback() {
    if (typeof window === 'undefined') return;
    if (!this.currentAudioElement) {
      this.currentAudioElement = new Audio();
      this.currentAudioElement.preload = 'auto';
    }

    try {
      const silentBuffer = this.generateSilentWavBuffer(0.06, 8000);
      const silentBlob = new Blob([silentBuffer], { type: 'audio/wav' });
      const silentUrl = URL.createObjectURL(silentBlob);
      const audio = this.currentAudioElement;
      audio.src = silentUrl;
      audio.currentTime = 0;
      void audio
        .play()
        .then(() => {
          window.setTimeout(() => {
            audio.pause();
            audio.currentTime = 0;
            URL.revokeObjectURL(silentUrl);
          }, 80);
        })
        .catch(() => {
          URL.revokeObjectURL(silentUrl);
        });
    } catch {
      // The real cue playback still reports a clear browser error if needed.
    }
  }

  public getPlaybackRateMultiplier(): number {
    switch (this.settings.voiceSpeed) {
      case 'slow':
        return 0.85;
      case 'fast':
        return 1.15;
      case 'normal':
      default:
        return 1.0;
    }
  }

  /**
   * Synchronizes audio playback with timeline state
   */
  public syncPlayback(
    stepId: string,
    narration: string,
    stepElapsedTime: number,
    isPlaying: boolean,
    timelineSpeed = 1
  ) {
    if (!this.settings.enabled) {
      this.pause();
      return;
    }

    const key = this.getCacheKey(stepId, narration);
    const cached = this.cache.get(key);

    // Gemini TTS is the only narration source. Invalid cache entries stay silent.
    if (cached && !cached.audioUrl) return;

    // If audio is not yet loaded and not quota exceeded: load on demand
    if (!cached) {
      if (this.stepStatus[stepId] !== 'loading' && this.stepStatus[stepId] !== 'error') {
        this.loadStepAudio(stepId, narration);
      }
      return;
    }

    if (!this.currentAudioElement) return;

    // Normal Gemini Audio playback
    if (this.currentStepId !== stepId || this.currentAudioElement.src !== cached.audioUrl) {
      this.currentStepId = stepId;
      this.currentAudioElement.src = cached.audioUrl;
    }

    const rate = timelineSpeed * this.getPlaybackRateMultiplier();
    this.currentAudioElement.playbackRate = Math.max(0.5, Math.min(2.0, rate));

    const targetAudioTime = Math.max(0, stepElapsedTime - this.leadIn);

    if (isPlaying) {
      if (targetAudioTime < cached.duration) {
        if (Math.abs(this.currentAudioElement.currentTime - targetAudioTime) > 0.25) {
          this.currentAudioElement.currentTime = targetAudioTime;
        }

        if (this.currentAudioElement.paused) {
          this.currentAudioElement.play().catch(() => {});
        }
      } else {
        if (!this.currentAudioElement.paused) {
          this.currentAudioElement.pause();
        }
      }
    } else {
      if (!this.currentAudioElement.paused) {
        this.currentAudioElement.pause();
      }
      this.currentAudioElement.currentTime = targetAudioTime;
    }
  }

  /**
   * Plays one imported-HTML narration cue to completion with the same Kore
   * TTS/cache as normal lessons. `onStarted` fires as soon as the browser has
   * actually begun playback; the HTML bridge uses that moment to start its
   * matching animation while this Promise keeps the host queue serialized.
   */
  public async playNarrationCue(
    cueId: string,
    narration: string,
    voiceName = this.settings.voiceName,
    onStarted?: () => void
  ): Promise<void> {
    if (!this.settings.enabled || !narration?.trim()) {
      onStarted?.();
      return;
    }

    const cached = await this.loadStepAudio(cueId, narration, voiceName);
    if (!cached?.audioUrl) {
      throw new Error(
        this.getStepError(cueId) ||
          'Không tạo được giọng Kore cho đoạn lời đọc này.'
      );
    }

    this.cancelActiveNarrationCue();
    const audio = new Audio(cached.audioUrl);
    audio.preload = 'auto';
    audio.playbackRate = this.getPlaybackRateMultiplier();
    this.narrationCueAudio = audio;
    this.notifyStatus(cueId, 'playing');

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
        if (this.narrationCueAudio === audio) this.narrationCueAudio = null;
        if (this.cancelNarrationCuePlayback === handleCancel) {
          this.cancelNarrationCuePlayback = null;
        }
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const handleEnded = () =>
        finish(() => {
          this.notifyStatus(cueId, 'ready');
          resolve();
        });

      const handleError = () =>
        finish(() => {
          const message = 'Trình duyệt không phát được âm thanh Kore.';
          this.stepErrors.set(cueId, message);
          this.notifyStatus(cueId, 'error', message);
          reject(new Error(message));
        });

      const handleCancel = () =>
        finish(() => {
          audio.pause();
          resolve();
        });

      this.cancelNarrationCuePlayback = handleCancel;
      audio.addEventListener('ended', handleEnded, { once: true });
      audio.addEventListener('error', handleError, { once: true });

      audio
        .play()
        .then(() => onStarted?.())
        .catch((err) => {
          finish(() => {
            const message =
              err?.name === 'NotAllowedError'
                ? 'Trình duyệt đang chặn tự phát âm thanh. Hãy bấm Chạy bài có tiếng một lần nữa.'
                : err?.message || 'Không phát được âm thanh Kore.';
            this.stepErrors.set(cueId, message);
            this.notifyStatus(cueId, 'error', message);
            reject(new Error(message));
          });
        });
    });
  }

  private cancelActiveNarrationCue() {
    if (this.cancelNarrationCuePlayback) {
      const cancel = this.cancelNarrationCuePlayback;
      this.cancelNarrationCuePlayback = null;
      cancel();
    } else if (this.narrationCueAudio) {
      this.narrationCueAudio.pause();
      this.narrationCueAudio = null;
    }
  }

  public pause() {
    if (this.currentAudioElement && !this.currentAudioElement.paused) {
      this.currentAudioElement.pause();
    }
  }

  public restart() {
    this.cancelActiveNarrationCue();
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement.currentTime = 0;
    }
    this.currentStepId = null;
    this.lastSpokenStepId = null;
    // Reset transient session state when switching/restarting a lesson.
    this.setQuotaExceeded(false);
    this.stepStatus = {};
  }
}

export const AudioEngine = new AudioEngineClass();
