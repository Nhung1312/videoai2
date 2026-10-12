import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Ratio,
  Maximize2,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Film,
} from 'lucide-react';
import { TimelineState } from '../lib/useTimeline';
import { LessonStep, LessonPresentationSettings } from '../types/lesson';
import { AudioEngine, VoiceSettings } from '../lib/audioEngine';

interface PlayerControlsProps {
  timeline: TimelineState;
  steps: LessonStep[];
  aspectRatio: '16:9' | '9:16';
  settings: LessonPresentationSettings;
  onAspectRatioChange: (ratio: '16:9' | '9:16') => void;
  onSettingsChange: (settings: LessonPresentationSettings) => void;
  onToggleFullscreen?: () => void;
  onOpenExport?: () => void;
  className?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  timeline,
  steps,
  aspectRatio,
  settings,
  onAspectRatioChange,
  onSettingsChange,
  onToggleFullscreen,
  onOpenExport,
  className = '',
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceSettings>({ ...AudioEngine.settings });
  const [isPreparingForPlay, setIsPreparingForPlay] = useState(false);
  const [audioGateMessage, setAudioGateMessage] = useState<string | null>(null);

  const {
    currentTime,
    totalDuration,
    isPlaying,
    speed,
    currentStepIndex,
    togglePlay,
    restart,
    seek,
    nextStep,
    prevStep,
    setSpeed,
  } = timeline;

  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
  const speeds = [0.5, 1, 1.25, 1.5, 2];

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    seek(ratio * totalDuration);
  };

  const handlePlayPause = async () => {
    if (isPlaying) {
      togglePlay();
      return;
    }

    if (!voiceConfig.enabled) {
      togglePlay();
      return;
    }

    // Requirement 5: Step không có narration thì bỏ qua, KHÔNG tính là “thiếu giọng”.
    const narratedSteps = steps.filter((step) => step.narration?.trim());
    if (narratedSteps.length === 0) {
      setAudioGateMessage(null);
      togglePlay();
      return;
    }

    const readyBefore = narratedSteps.filter((step) => {
      const cached = AudioEngine.getCachedAudio(step.id, step.narration);
      return cached && !!cached.audioUrl;
    }).length;

    if (readyBefore === narratedSteps.length) {
      // Requirement 6: Khi tất cả step có narration đã có audio: trạng thái thành "Giọng đọc sẵn sàng", mới cho Play
      setAudioGateMessage('Giọng đọc sẵn sàng');
      togglePlay();
      window.setTimeout(() => setAudioGateMessage(null), 2000);
      return;
    }

    setIsPreparingForPlay(true);
    setAudioGateMessage(`Đang chuẩn bị giọng đọc (${readyBefore}/${narratedSteps.length} bước)...`);
    try {
      const result = await AudioEngine.preloadLesson(narratedSteps);
      const readyAfter = narratedSteps.filter((step) => {
        const cached = AudioEngine.getCachedAudio(step.id, step.narration);
        return cached && !!cached.audioUrl;
      }).length;

      if (readyAfter === narratedSteps.length) {
        // Requirement 6: Khi tất cả step có narration đã có audio -> “Giọng đọc sẵn sàng” -> mới cho Play
        setAudioGateMessage('Giọng đọc sẵn sàng');
        togglePlay();
        window.setTimeout(() => setAudioGateMessage(null), 2500);
      } else {
        // Requirement 7: Nếu vẫn thất bại: hiển thị rõ “Không tạo được giọng bước X: [lý do thật]” thay vì chỉ báo 1/2.
        const missingStep = narratedSteps.find((step) => {
          const cached = AudioEngine.getCachedAudio(step.id, step.narration);
          return !cached || !cached.audioUrl;
        });

        const stepNum = missingStep ? steps.indexOf(missingStep) + 1 : (result.failedStepIndex || 1);
        const realReason =
          (missingStep ? AudioEngine.getStepError(missingStep.id) : null) ||
          result.failedReason ||
          (result.quotaExceeded
            ? 'Hạn ngạch Gemini TTS đã đạt giới hạn (429 Quota Exceeded). Vui lòng thử lại sau.'
            : 'Không thể kết nối dịch vụ giọng đọc');

        setAudioGateMessage(`Không tạo được giọng bước ${stepNum}: ${realReason}`);
      }
    } finally {
      setIsPreparingForPlay(false);
    }
  };

  const handleVoiceConfigChange = (updated: Partial<VoiceSettings>) => {
    const next = { ...voiceConfig, ...updated };
    setVoiceConfig(next);
    AudioEngine.settings = next;
    if (!next.enabled) {
      AudioEngine.pause();
    }
  };

  return (
    <div className={`relative bg-slate-900/95 backdrop-blur-md border border-slate-800/80 rounded-2xl p-3 md:p-4 shadow-xl ${className}`}>
      {/* 1. TIMELINE PROGRESS BAR */}
      <div className="relative mb-3 group cursor-pointer" onClick={handleTimelineClick}>
        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden transition-all group-hover:h-3">
          <div
            className="h-full bg-linear-to-r from-sky-500 via-indigo-500 to-amber-400 transition-all duration-75"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Step Marker Divs */}
        <div className="absolute top-0 left-0 right-0 h-2 group-hover:h-3 flex pointer-events-none">
          {steps.map((step, idx) => {
            return (
              <div
                key={step.id || idx}
                className="h-full border-r border-slate-950/60"
                style={{
                  width: `${((step.duration || 3) / totalDuration) * 100}%`,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* 2. PLAYBACK CONTROLS & TIME */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Transport Buttons */}
        <div className="flex items-center gap-1.5 md:gap-2">
          {/* Restart */}
          <button
            onClick={restart}
            title="Bắt đầu lại (Restart)"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <RotateCcw className="w-4 h-4 md:w-5 md:h-5" />
          </button>

          {/* Prev Step */}
          <button
            onClick={prevStep}
            title="Bước trước (Previous Step)"
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            <SkipBack className="w-4 h-4 md:w-5 md:h-5" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            disabled={isPreparingForPlay}
            title={isPreparingForPlay ? 'Đang chuẩn bị giọng đọc...' : isPlaying ? 'Tạm dừng (Pause)' : 'Phát bài giảng (Play)'}
            className="p-2.5 md:p-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 disabled:cursor-wait text-white shadow-md shadow-sky-500/25 transition active:scale-95"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 md:w-6 md:h-6 fill-current" />
            ) : (
              <Play className="w-5 h-5 md:w-6 md:h-6 fill-current translate-x-0.5" />
            )}
          </button>

          {/* Next Step */}
          <button
            onClick={nextStep}
            title="Bước sau (Next Step)"
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            <SkipForward className="w-4 h-4 md:w-5 md:h-5" />
          </button>

          {/* Time Counter */}
          <div className="ml-2 text-xs md:text-sm font-mono text-slate-400">
            <span className="text-slate-100 font-semibold">{formatTime(currentTime)}</span>
            <span className="mx-1">/</span>
            <span>{formatTime(totalDuration)}</span>
          </div>

          {/* Step indicator */}
          <div className="hidden sm:inline-flex items-center ml-2 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300">
            Bước {currentStepIndex + 1}/{steps.length}
          </div>
        </div>

        {/* Right: Settings, Speed & Aspect Ratio Controls */}
        <div className="flex items-center gap-2">
          {/* Quick Voice Mute/Unmute Toggle */}
          <button
            onClick={() => handleVoiceConfigChange({ enabled: !voiceConfig.enabled })}
            className={`p-2 rounded-xl border transition ${
              voiceConfig.enabled
                ? 'bg-slate-800 text-emerald-400 border-emerald-500/30 hover:bg-slate-750'
                : 'bg-slate-800/60 text-slate-500 border-slate-700'
            }`}
            title={voiceConfig.enabled ? 'Giọng đọc đang BẬT (Bấm để tắt)' : 'Giọng đọc đang TẮT (Bấm để bật)'}
          >
            {voiceConfig.enabled ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )}
          </button>

          {/* Settings Toggle Button */}
          <button
            onClick={() => setIsSettingsOpen((prev) => !prev)}
            className={`p-2 rounded-xl border transition flex items-center gap-1 text-xs ${
              isSettingsOpen
                ? 'bg-sky-500 text-white border-sky-400'
                : 'bg-slate-800/90 text-slate-300 hover:text-white border-slate-700/60 hover:bg-slate-800'
            }`}
            title="Cài đặt giọng đọc và hiệu ứng"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden md:inline font-medium">Cài đặt</span>
          </button>

          {/* Speed Selector */}
          <div className="flex items-center bg-slate-800/90 rounded-xl p-1 border border-slate-700/60 text-xs font-medium">
            {speeds.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded-lg transition ${
                  speed === s
                    ? 'bg-sky-500 text-white font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Aspect Ratio Switcher */}
          <div className="flex items-center bg-slate-800/90 rounded-xl p-1 border border-slate-700/60 text-xs font-medium">
            <button
              onClick={() => onAspectRatioChange('16:9')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition ${
                aspectRatio === '16:9'
                  ? 'bg-indigo-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Khung hình ngang 16:9 (Chuẩn bài giảng)"
            >
              <Ratio className="w-3.5 h-3.5" />
              16:9
            </button>
            <button
              onClick={() => onAspectRatioChange('9:16')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition ${
                aspectRatio === '9:16'
                  ? 'bg-indigo-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Khung hình dọc 9:16 (Shorts / Reels)"
            >
              9:16
            </button>
          </div>

          {/* Fullscreen Button */}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Toàn màn hình"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}

          {/* Export Video Button */}
          {onOpenExport && (
            <button
              onClick={onOpenExport}
              className="ml-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-linear-to-r from-amber-500 via-rose-500 to-pink-500 hover:from-amber-400 hover:via-rose-400 hover:to-pink-400 text-white shadow-md shadow-amber-500/20 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
              title="Xuất video MP4/WebM bài giảng hoạt hình"
            >
              <Film className="w-3.5 h-3.5" />
              <span>Xuất video</span>
            </button>
          )}
        </div>
      </div>

      {audioGateMessage && (
        <div className="mt-3 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs font-medium">
          {audioGateMessage}
        </div>
      )}

            {/* 3. SETTINGS POPOVER (Requirement 11 & 15) */}
      {isSettingsOpen && (
        <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-slate-950/70 p-3 rounded-xl border border-slate-800 animate-in fade-in">
          {/* GIỌNG ĐỌC TIẾNG VIỆT (Requirement 11) */}
          <div>
            <div className="text-slate-400 font-semibold mb-1.5 flex items-center gap-1 text-emerald-400">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Giọng đọc (TTS):</span>
            </div>
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => handleVoiceConfigChange({ enabled: true })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  voiceConfig.enabled
                    ? 'bg-emerald-500 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Bật
              </button>
              <button
                type="button"
                onClick={() => handleVoiceConfigChange({ enabled: false })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  !voiceConfig.enabled
                    ? 'bg-rose-500 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Tắt
              </button>
            </div>
          </div>

          {/* CHỌN GIỌNG NỮ / NAM */}
          <div>
            <div className="text-slate-400 font-semibold mb-1.5">Giọng đọc:</div>
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => handleVoiceConfigChange({ voiceName: 'Kore' })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  voiceConfig.voiceName === 'Kore'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Nữ (Kore)
              </button>
              <button
                type="button"
                onClick={() => handleVoiceConfigChange({ voiceName: 'Puck' })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  voiceConfig.voiceName === 'Puck'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Nam (Puck)
              </button>
            </div>
          </div>

          {/* TỐC ĐỘ ĐỌC GIỌNG */}
          <div>
            <div className="text-slate-400 font-semibold mb-1.5">Tốc độ đọc:</div>
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => handleVoiceConfigChange({ voiceSpeed: 'slow' })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  voiceConfig.voiceSpeed === 'slow'
                    ? 'bg-amber-500 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Chậm
              </button>
              <button
                type="button"
                onClick={() => handleVoiceConfigChange({ voiceSpeed: 'normal' })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  voiceConfig.voiceSpeed === 'normal'
                    ? 'bg-amber-500 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Vừa
              </button>
              <button
                type="button"
                onClick={() => handleVoiceConfigChange({ voiceSpeed: 'fast' })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  voiceConfig.voiceSpeed === 'fast'
                    ? 'bg-amber-500 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Nhanh
              </button>
            </div>
          </div>

          {/* HIỆU ỨNG GÕ CHỮ */}
          <div>
            <div className="text-slate-400 font-semibold mb-1.5">Hiệu ứng chữ:</div>
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => onSettingsChange({ ...settings, revealMode: 'typewriter' })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  (settings.revealMode || 'typewriter') === 'typewriter'
                    ? 'bg-sky-500 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Gõ chữ
              </button>
              <button
                type="button"
                onClick={() => onSettingsChange({ ...settings, revealMode: 'immediate' })}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  settings.revealMode === 'immediate'
                    ? 'bg-sky-500 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Hiện ngay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
