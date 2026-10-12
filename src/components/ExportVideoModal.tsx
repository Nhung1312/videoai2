import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  X,
  Video,
  Film,
  Volume2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FileText,
  Clock,
  Sparkles,
  Play,
  RotateCcw,
} from 'lucide-react';
import { LessonScript, LessonPresentationSettings } from '../types/lesson';
import {
  VideoExporter,
  VideoExportOptions,
  ExportProgress,
} from '../lib/videoExporter';
import { AudioEngine } from '../lib/audioEngine';

interface ExportVideoModalProps {
  isOpen: boolean;
  lesson: LessonScript;
  settings: LessonPresentationSettings;
  initialAspectRatio: '16:9' | '9:16';
  onClose: () => void;
}

export const ExportVideoModal: React.FC<ExportVideoModalProps> = ({
  isOpen,
  lesson,
  settings,
  initialAspectRatio,
  onClose,
}) => {
  const [options, setOptions] = useState<VideoExportOptions>({
    resolution: '720p',
    aspectRatio: initialAspectRatio,
    fps: 30,
    includeAudio: true,
    includeSubtitles: false,
  });

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>({
    stage: 'idle',
    percent: 0,
    currentFrame: 0,
    totalFrames: 0,
    message: '',
  });

  const exporterRef = useRef<VideoExporter | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  // Sync initial aspect ratio when modal opens
  useEffect(() => {
    if (isOpen) {
      setOptions((prev) => ({ ...prev, aspectRatio: initialAspectRatio }));
    }
  }, [isOpen, initialAspectRatio]);

  if (!isOpen) return null;

  // Calculate timeline plan stats
  const timelinePlan = VideoExporter.calculateTimelinePlan(lesson);
  const totalDurationSec = Math.round(timelinePlan.totalDuration);
  const durationMin = Math.floor(totalDurationSec / 60);
  const durationRemSec = totalDurationSec % 60;
  const formattedDuration = `${durationMin}:${durationRemSec.toString().padStart(2, '0')}`;

  const cachedCount = lesson.steps.filter((s) =>
    AudioEngine.hasCachedAudio(s.id, s.narration)
  ).length;

  const handleStartExport = async () => {
    setIsExporting(true);
    setProgress({
      stage: 'preparing_audio',
      percent: 0,
      currentFrame: 0,
      totalFrames: Math.ceil(timelinePlan.totalDuration * options.fps),
      message: 'Khởi động quá trình xuất video...',
    });

    const exporter = new VideoExporter();
    exporterRef.current = exporter;

    try {
      await exporter.exportVideo(lesson, settings, options, (p) => {
        setProgress(p);
      });
    } catch (err: any) {
      console.error('Export error:', err);
      setProgress((prev) => ({
        ...prev,
        stage: 'error',
        error: err?.message || 'Có lỗi xảy ra khi xuất video. Vui lòng thử lại.',
      }));
    } finally {
      setIsExporting(false);
      exporterRef.current = null;
    }
  };

  const handleCancel = () => {
    if (exporterRef.current) {
      exporterRef.current.cancel();
    }
    setIsExporting(false);
    setProgress((prev) => ({
      ...prev,
      stage: 'cancelled',
      message: 'Đã huỷ xuất video.',
    }));
  };

  const handleClose = () => {
    if (isExporting) {
      handleCancel();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* MODAL HEADER */}
        <div className="px-5 py-4 border-b border-slate-800/90 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-linear-to-tr from-sky-500 to-indigo-600 rounded-xl text-white shadow-md shadow-sky-500/20">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                Xuất Video Bài Giảng Hoạt Hình
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  ĐỢT 2B
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Xuất video MP4 độc lập kèm chữ typewriter, công thức KaTeX và giọng đọc tiếng Việt
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {progress.stage === 'completed' && progress.outputUrl ? (
            /* COMPLETED STATE */
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-bold text-emerald-300 text-sm sm:text-base">
                    Xuất video thành công!
                  </h3>
                  <p className="text-xs text-emerald-200/80 mt-0.5">
                    Tệp video đã được đóng gói hoàn tất với đầy đủ âm thanh giọng đọc và hình ảnh animation.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2 text-[11px] font-semibold text-slate-300">
                    <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700">
                      Tỉ lệ: {options.aspectRatio}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700">
                      Độ phân giải: {options.resolution}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700">
                      Dung lượng: {progress.fileSizeMB} MB
                    </span>
                  </div>
                </div>
              </div>

              {/* Video Player Preview inside Modal */}
              <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center max-h-[340px]">
                <video
                  ref={videoPreviewRef}
                  src={progress.outputUrl}
                  controls
                  className={`w-full ${
                    options.aspectRatio === '9:16'
                      ? 'max-h-[320px] aspect-[9/16]'
                      : 'aspect-video'
                  }`}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <a
                  href={progress.outputUrl}
                  download={progress.outputFilename || 'bai_giang_toan.mp4'}
                  className="w-full sm:flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 transition active:scale-95"
                >
                  <Download className="w-4 h-4" />
                  Tải xuống Video ({progress.fileSizeMB} MB)
                </a>

                <button
                  onClick={() => {
                    setProgress({
                      stage: 'idle',
                      percent: 0,
                      currentFrame: 0,
                      totalFrames: 0,
                      message: '',
                    });
                  }}
                  className="w-full sm:w-auto px-4 py-3 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Xuất bản khác
                </button>
              </div>
            </div>
          ) : isExporting || progress.stage === 'rendering_frames' || progress.stage === 'preparing_audio' ? (
            /* RENDERING PROGRESS STATE */
            <div className="space-y-5 py-4">
              <div className="text-center space-y-2">
                <div className="inline-flex p-3 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-400 mb-1 animate-pulse">
                  <Film className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-slate-100 text-base">
                  Đang xuất video bài giảng...
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {progress.message || 'Đang vẽ từng khung hình và ghép âm thanh giọng đọc'}
                </p>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-300">
                    {progress.stage === 'preparing_audio'
                      ? 'Giai đoạn 1: Chuẩn bị âm thanh'
                      : progress.stage === 'encoding_audio'
                      ? 'Giai đoạn 3: Mã hoá âm thanh'
                      : progress.stage === 'finalizing'
                      ? 'Giai đoạn 4: Đóng gói MP4'
                      : 'Giai đoạn 2: Render khung hình'}
                  </span>
                  <span className="text-sky-400 font-mono text-sm">{progress.percent}%</span>
                </div>
                <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/60">
                  <div
                    className="h-full bg-linear-to-r from-sky-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-200"
                    style={{ width: `${Math.min(100, Math.max(2, progress.percent))}%` }}
                  />
                </div>
              </div>

              {/* Stats badges */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Khung hình:</span>
                  <span className="font-semibold text-slate-200 font-mono">
                    {progress.currentFrame} / {progress.totalFrames}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Thời gian còn lại:</span>
                  <span className="font-semibold text-amber-300 font-mono">
                    {progress.timeRemainingSec !== undefined
                      ? `~${progress.timeRemainingSec}s`
                      : 'Đang ước tính...'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 col-span-2 sm:col-span-1">
                  <span className="text-slate-500 block text-[11px]">Định dạng đích:</span>
                  <span className="font-semibold text-sky-300">
                    MP4 • {options.resolution}
                  </span>
                </div>
              </div>

              {/* Cancel Button */}
              <div className="pt-2 flex justify-center">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  Huỷ xuất video
                </button>
              </div>
            </div>
          ) : (
            /* CONFIGURATION & OPTIONS STATE */
            <div className="space-y-4">
              {/* Lesson Overview Card */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <span className="text-slate-400 block text-[11px]">Bài giảng:</span>
                  <strong className="text-slate-100 font-semibold">{lesson.title}</strong>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Thời lượng:</span>
                    <strong className="text-amber-400 font-mono">{formattedDuration}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Số bước:</span>
                    <strong className="text-sky-400">{lesson.steps.length} bước</strong>
                  </div>
                </div>
              </div>

              {/* Error Alert if any */}
              {progress.stage === 'error' && progress.error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{progress.error}</span>
                </div>
              )}

              {/* Aspect Ratio Options */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5 text-sky-400" />
                  Tỉ lệ khung hình (Aspect Ratio)
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setOptions((o) => ({ ...o, aspectRatio: '16:9' }))}
                    className={`p-3 rounded-2xl border text-left transition flex items-start gap-2.5 ${
                      options.aspectRatio === '16:9'
                        ? 'bg-sky-500/15 border-sky-500 text-white shadow-sm'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-7 h-4 rounded-sm border-2 border-current mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-xs text-slate-200">16:9 Ngang</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        YouTube, Máy tính, Máy chiếu
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOptions((o) => ({ ...o, aspectRatio: '9:16' }))}
                    className={`p-3 rounded-2xl border text-left transition flex items-start gap-2.5 ${
                      options.aspectRatio === '9:16'
                        ? 'bg-sky-500/15 border-sky-500 text-white shadow-sm'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-4 h-7 rounded-sm border-2 border-current mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-xs text-slate-200">9:16 Dọc</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        TikTok, Reels, Shorts
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Resolution Options */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Độ phân giải xuất (Resolution)
                </label>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setOptions((o) => ({ ...o, resolution: '720p' }))}
                    className={`p-2.5 rounded-xl border text-center transition ${
                      options.resolution === '720p'
                        ? 'bg-indigo-500/20 border-indigo-500 text-white font-bold'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 font-medium'
                    }`}
                  >
                    720p HD (Khuyên dùng • Nhanh)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOptions((o) => ({ ...o, resolution: '1080p' }))}
                    className={`p-2.5 rounded-xl border text-center transition ${
                      options.resolution === '1080p'
                        ? 'bg-indigo-500/20 border-indigo-500 text-white font-bold'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 font-medium'
                    }`}
                  >
                    1080p Full HD (Nét cao)
                  </button>
                </div>
              </div>

              {/* Audio & Subtitle Toggles */}
              <div className="space-y-2 pt-1 border-t border-slate-800/80">
                <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                  <div className="flex items-center gap-2.5">
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        Kèm giọng đọc tiếng Việt (TTS)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {AudioEngine.isQuotaExceeded
                          ? 'Đã đạt hạn mức Gemini TTS miễn phí (10 lượt/ngày). Video sẽ xuất kèm dải âm thanh đồng bộ và phụ đề hiển thị chuẩn xác.'
                          : cachedCount === lesson.steps.length
                          ? `Đã nạp sẵn ${cachedCount}/${lesson.steps.length} bước trong bộ nhớ đệm (0 tốn API)`
                          : `Tái sử dụng ${cachedCount} bước có sẵn, chỉ nạp thêm ${lesson.steps.length - cachedCount} bước thiếu`}
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={options.includeAudio}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, includeAudio: e.target.checked }))
                    }
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-amber-400" />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        Kèm phụ đề lời giảng ở cạnh dưới
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Chữ phụ đề chạy theo nhịp nói (phong cách video bài giảng chuyên nghiệp)
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={options.includeSubtitles}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, includeSubtitles: e.target.checked }))
                    }
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500"
                  />
                </label>
              </div>

              {/* Start Export Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleStartExport}
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-linear-to-r from-sky-500 via-indigo-600 to-amber-500 hover:from-sky-400 hover:via-indigo-500 hover:to-amber-400 text-white shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  BẮT ĐẦU XUẤT VIDEO ({options.aspectRatio} • {options.resolution})
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
