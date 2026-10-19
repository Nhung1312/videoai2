import { useState, useEffect } from 'react';
import { SAMPLE_GEOMETRY_LESSON, SAMPLE_ALGEBRA_LESSON } from './lib/sampleLessons';
import { LessonScript, LessonPresentationSettings } from './types/lesson';
import { useTimeline } from './lib/useTimeline';
import { VideoCanvas } from './components/VideoCanvas';
import { PlayerControls } from './components/PlayerControls';
import { ProblemInputModal } from './components/ProblemInputModal';
import { ScriptEditorModal } from './components/ScriptEditorModal';
import { ExportVideoModal } from './components/ExportVideoModal';
import { SaveLessonModal } from './components/SaveLessonModal';
import { LessonLibraryModal } from './components/LessonLibraryModal';
import { ImportLessonModuleModal } from './components/ImportLessonModuleModal';
import { HtmlLessonPlayerModal } from './components/HtmlLessonPlayerModal';
import { HtmlLessonExportWindow } from './components/HtmlLessonExportWindow';
import { AudioEngine } from './lib/audioEngine';
import { DraftStorage } from './lib/draftStorage';
import { LessonStorage, SavedLessonEntry } from './lib/lessonStorage';
import {
  Sparkles,
  Edit,
  Video,
  FileQuestion,
  Film,
  Volume2,
  CheckCircle2,
  Save,
  FolderArchive,
  FileCode,
} from 'lucide-react';

export default function App() {
  const htmlExportId = new URLSearchParams(window.location.search).get('html-kore-export');

  if (htmlExportId) {
    return <HtmlLessonExportWindow exportId={htmlExportId} />;
  }

  return <MainApplication />;
}

function MainApplication() {
  const [currentLesson, setCurrentLesson] = useState<LessonScript>(SAMPLE_GEOMETRY_LESSON);
  const [currentLessonId, setCurrentLessonId] = useState<string | null>('sample-geometry-ahbk');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [isInputModalOpen, setIsInputModalOpen] = useState(false);
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [isImportModuleModalOpen, setIsImportModuleModalOpen] = useState(false);
  const [isHtmlLessonModalOpen, setIsHtmlLessonModalOpen] = useState(false);
  const [savedLessonsCount, setSavedLessonsCount] = useState<number>(() => {
    return LessonStorage.getAll().length;
  });
  const [isLabelEditable, setIsLabelEditable] = useState(false);
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isPreparingVoice, setIsPreparingVoice] = useState(false);

  // Typewriter & Math Reveal presentation settings (Requirement 10 & 15)
  const [presentationSettings, setPresentationSettings] = useState<LessonPresentationSettings>({
    revealMode: 'typewriter',
    typingSpeed: 32,
    mathRevealMode: 'semantic',
    showTypingCursor: true,
  });

  // Initialize Timeline Hook
  const timeline = useTimeline(currentLesson.steps, {
    autoPlay: false,
    initialSpeed: 1,
  });

  // Check if an uncompleted draft exists in storage
  useEffect(() => {
    setHasSavedDraft(DraftStorage.hasDraft());
  }, [isInputModalOpen]);

  const handleApplyLesson = (
    newLesson: LessonScript,
    message?: string,
    options?: { source?: 'ai' | 'sample' | 'custom'; id?: string }
  ) => {
    AudioEngine.restart();
    setCurrentLesson(newLesson);
    if (newLesson.presentation) {
      setPresentationSettings((prev) => ({
        ...prev,
        ...newLesson.presentation,
      }));
    }
    timeline.seek(0);
    timeline.pause();
    setHasSavedDraft(false);

    // Auto-save new AI lesson into library so that the current lesson and previous lessons are preserved!
    const source = options?.source || 'ai';
    const saved = LessonStorage.save(newLesson, {
      id: options?.id,
      source,
      aspectRatio,
      presentationSettings: newLesson.presentation || presentationSettings,
    });
    setCurrentLessonId(saved.id);
    setSavedLessonsCount(LessonStorage.getAll().length);

    setToastMessage(
      message ||
        `Đã tạo kịch bản bài "${newLesson.title}" thành công và tự động lưu vào Kho bài!`
    );
    setTimeout(() => {
      setToastMessage(null);
    }, 6000);
    // Note: TTS is intentionally NOT preloaded eagerly here (Requirement 16)
  };

  const handleSelectLessonFromLibrary = (entry: SavedLessonEntry) => {
    AudioEngine.restart();
    setCurrentLesson(entry.lesson);
    setCurrentLessonId(entry.id);
    if (entry.aspectRatio) {
      setAspectRatio(entry.aspectRatio);
    }
    if (entry.presentationSettings) {
      setPresentationSettings(entry.presentationSettings);
    } else if (entry.lesson.presentation) {
      setPresentationSettings((prev) => ({
        ...prev,
        ...entry.lesson.presentation,
      }));
    }
    timeline.seek(0);
    timeline.pause();
    setToastMessage(`Đã mở bài học: "${entry.title}" từ Kho bài.`);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const handleSavedLesson = (savedEntry: SavedLessonEntry, message: string) => {
    setCurrentLessonId(savedEntry.id);
    setCurrentLesson(savedEntry.lesson);
    setSavedLessonsCount(LessonStorage.getAll().length);
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 5000);
  };

  const handlePrepareVoice = async () => {
    if (isPreparingVoice) return;
    setIsPreparingVoice(true);
    const narratedSteps = currentLesson.steps.filter((s) => s.narration?.trim());
    if (narratedSteps.length === 0) {
      setToastMessage('Bài giảng không có bước nào cần đọc lời.');
      setIsPreparingVoice(false);
      return;
    }
    setToastMessage('Đang chuẩn bị giọng đọc cho toàn bộ bài...');
    try {
      const result = await AudioEngine.preloadLesson(narratedSteps);
      if (result.ready === narratedSteps.length) {
        setToastMessage(`Giọng đọc sẵn sàng (${result.ready}/${narratedSteps.length} bước). Bây giờ có thể bấm Play.`);
      } else {
        const missingStep = narratedSteps.find((step) => {
          const cached = AudioEngine.getCachedAudio(step.id, step.narration);
          return !cached || !cached.audioUrl;
        });
        const stepNum = missingStep ? currentLesson.steps.indexOf(missingStep) + 1 : (result.failedStepIndex || 1);
        const realReason =
          (missingStep ? AudioEngine.getStepError(missingStep.id) : null) ||
          result.failedReason ||
          'Không thể kết nối dịch vụ giọng đọc';
        setToastMessage(`Không tạo được giọng bước ${stepNum}: ${realReason}`);
      }
    } finally {
      setIsPreparingVoice(false);
    }
  };

  const handlePointMoved = (pointId: string, newOffset: { x: number; y: number }) => {
    if (!currentLesson.geometryScene) return;
    setCurrentLesson((prev) => {
      if (!prev.geometryScene) return prev;
      const updatedPoints = prev.geometryScene.points.map((p) => {
        if (p.id === pointId) {
          return {
            ...p,
            labelPosition: 'custom' as const,
            labelOffset: newOffset,
          };
        }
        return p;
      });
      return {
        ...prev,
        geometryScene: {
          ...prev.geometryScene,
          points: updatedPoints,
        },
      };
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
      {/* 1. TOP NAVBAR */}
      <header className="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40 px-3 lg:px-5 py-2">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-linear-to-tr from-sky-500 to-indigo-600 rounded-xl shadow-md shadow-sky-500/20 text-white">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base md:text-lg tracking-tight bg-linear-to-r from-sky-400 via-indigo-300 to-amber-300 bg-clip-text text-transparent">
                  AI MATH VIDEO STUDIO
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-sky-400 border border-slate-700">
                  ĐỢT 3B
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Approved Draft → Final Lesson Video Workflow • Hoạt Hình & MP4
              </p>
            </div>
          </div>

          {/* Quick Regression Test Switcher */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() =>
                handleApplyLesson(
                  SAMPLE_GEOMETRY_LESSON,
                  'Đã chuyển sang bài mẫu Hình học (AHBK).',
                  { id: 'sample-geometry-ahbk', source: 'sample' }
                )
              }
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                currentLesson.problemType === 'geometry'
                  ? 'bg-sky-500 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📐 Test Hình học (AHBK)
            </button>
            <button
              onClick={() =>
                handleApplyLesson(
                  SAMPLE_ALGEBRA_LESSON,
                  'Đã chuyển sang bài mẫu Đại số (Phương trình).',
                  { id: 'sample-algebra-equation', source: 'sample' }
                )
              }
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                currentLesson.problemType === 'equation'
                  ? 'bg-amber-500 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🔢 Test Đại số (Phương trình)
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Storage Actions */}
            <button
              onClick={() => setIsSaveModalOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
              title="Lưu bài học hiện tại vào Kho bài đã lưu"
            >
              <Save className="w-3.5 h-3.5 text-sky-400" />
              <span>Lưu bài</span>
            </button>

            <button
              onClick={() => setIsLibraryModalOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 hover:border-slate-600 transition flex items-center gap-1.5 cursor-pointer relative"
              title="Mở Kho bài đã lưu để quản lý và chọn bài"
            >
              <FolderArchive className="w-3.5 h-3.5 text-amber-400" />
              <span>Kho bài</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900 text-amber-300 border border-amber-500/30">
                {savedLessonsCount}
              </span>
            </button>

            <button
              onClick={() => setIsEditorModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
              title="Chỉnh sửa kịch bản lời giải và thời lượng"
            >
              <Edit className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Sửa kịch bản</span>
            </button>

            <button
              onClick={() => setIsInputModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-linear-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-md shadow-sky-500/20 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Nhập đề AI</span>
            </button>

            <button
              onClick={() => setIsHtmlLessonModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white shadow-md shadow-violet-600/20 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
              title="Nhập HTML bài giảng có narrationScript + cue và phát bằng Kore"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>HTML + Kore</span>
            </button>

            <button
              onClick={() => setIsImportModuleModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
              title="Nhập Lesson Module với Canvas Renderer deterministic riêng"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Nhập Lesson Module</span>
            </button>

            <button
              onClick={() => setIsExportModalOpen(true)}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-linear-to-r from-amber-500 via-rose-500 to-pink-500 hover:from-amber-400 hover:via-rose-400 hover:to-pink-400 text-white shadow-md shadow-amber-500/20 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
              title="Xuất video MP4/WebM bài giảng hoạt hình"
            >
              <Film className="w-3.5 h-3.5" />
              <span>Xuất video</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-2 sm:p-3 lg:p-4 flex flex-col gap-3">
        {/* Approved Lesson Success Toast */}
        {toastMessage && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs flex items-center justify-between gap-3 shadow-lg shadow-emerald-500/10 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-semibold text-emerald-100">{toastMessage}</span>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-emerald-400 hover:text-white px-2 py-0.5 rounded-lg hover:bg-emerald-500/20 text-xs transition"
            >
              ✕
            </button>
          </div>
        )}

        {/* Unfinished Draft Restored Banner (Requirement 18) */}
        {hasSavedDraft && (
          <div className="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-between gap-3 text-xs animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <div>
                <span className="font-bold text-indigo-200">
                  Đã khôi phục bản nháp chưa hoàn thành.
                </span>
                <span className="text-slate-400 ml-1.5 hidden sm:inline">
                  Bạn có thể tiếp tục kiểm tra hoặc tạo bài giảng.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsInputModalOpen(true)}
                className="px-3 py-1.5 rounded-xl font-bold bg-indigo-500 hover:bg-indigo-400 text-white transition active:scale-95 cursor-pointer"
              >
                Tiếp tục
              </button>
              <button
                onClick={() => {
                  DraftStorage.clearDraft();
                  setHasSavedDraft(false);
                }}
                className="px-2.5 py-1.5 rounded-xl font-medium text-slate-400 hover:text-white transition cursor-pointer"
              >
                Bỏ bản nháp
              </button>
            </div>
          </div>
        )}

        {/* Sub-header info and tools bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <FileQuestion className="w-4 h-4 text-sky-400" />
            <span>Đang phát:</span>
            <span className="font-semibold text-slate-200 truncate max-w-[280px] sm:max-w-md">
              {currentLesson.title}
            </span>
            <button
              onClick={() => setIsSaveModalOpen(true)}
              className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer px-1.5 py-0.5 rounded-md hover:bg-sky-500/10 transition"
              title="Lưu bài học hiện tại hoặc đổi tên"
            >
              <Save className="w-3 h-3" />
              <span>Lưu</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrepareVoice}
              className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1.5 cursor-pointer transition"
              title="Chủ động nạp giọng đọc TTS cho bài giảng hiện tại"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>{isPreparingVoice ? 'Đang tạo giọng...' : 'Chuẩn bị giọng đọc'}</span>
            </button>

            {currentLesson.geometryScene && (
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-400 hover:text-slate-200 text-xs">
                <input
                  type="checkbox"
                  checked={isLabelEditable}
                  onChange={(e) => setIsLabelEditable(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500"
                />
                <span>Kéo thả nhãn</span>
              </label>
            )}
          </div>
        </div>

        {/* Video Canvas Container */}
        <div className="w-full flex items-center justify-center min-h-[520px] md:min-h-[620px] xl:min-h-[700px]">
          <VideoCanvas
            lesson={currentLesson}
            timeline={timeline}
            aspectRatio={aspectRatio}
            isEditable={isLabelEditable}
            settings={presentationSettings}
            onPointMoved={handlePointMoved}
          />
        </div>

        {/* Player Controls Bar with Settings */}
        <div className="w-full max-w-6xl mx-auto">
          <PlayerControls
            timeline={timeline}
            steps={currentLesson.steps}
            aspectRatio={aspectRatio}
            settings={presentationSettings}
            onAspectRatioChange={setAspectRatio}
            onSettingsChange={setPresentationSettings}
            onOpenExport={() => setIsExportModalOpen(true)}
          />
        </div>

        {/* Info Highlights Card */}
        <div className="mt-2 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/60 max-w-4xl mx-auto w-full grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-400">
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
            <div>
              <strong className="text-slate-300">Typewriter & Cursor:</strong> Hiển thị chữ từng ký tự kèm con trỏ nhấp nháy, điều khiển đồng bộ qua Timeline.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 shrink-0" />
            <div>
              <strong className="text-slate-300">Math Reveal KaTeX:</strong> Công thức Toán xuất hiện dần theo token ngữ nghĩa, luôn là KaTeX hợp lệ ở mọi khung hình.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
            <div>
              <strong className="text-slate-300">Xuất video MP4:</strong> Render off-screen Canvas, tích hợp giọng đọc Web Audio, tải về MP4/WebM trực tiếp không cần quay màn hình.
            </div>
          </div>
        </div>
      </main>

      {/* 3. MODALS */}
      <ProblemInputModal
        isOpen={isInputModalOpen}
        onClose={() => setIsInputModalOpen(false)}
        onApplyLesson={handleApplyLesson}
      />

      <ScriptEditorModal
        isOpen={isEditorModalOpen}
        lesson={currentLesson}
        onClose={() => setIsEditorModalOpen(false)}
        onSaveLesson={(updated) =>
          handleApplyLesson(updated, 'Đã cập nhật kịch bản bài giảng!', {
            id: currentLessonId || undefined,
            source: 'custom',
          })
        }
      />

      <ExportVideoModal
        isOpen={isExportModalOpen}
        lesson={currentLesson}
        settings={presentationSettings}
        initialAspectRatio={aspectRatio}
        onClose={() => setIsExportModalOpen(false)}
      />

      <SaveLessonModal
        isOpen={isSaveModalOpen}
        lesson={currentLesson}
        currentLessonId={currentLessonId}
        aspectRatio={aspectRatio}
        presentationSettings={presentationSettings}
        onClose={() => setIsSaveModalOpen(false)}
        onSaved={handleSavedLesson}
      />

      <LessonLibraryModal
        isOpen={isLibraryModalOpen}
        currentLessonId={currentLessonId}
        currentLesson={currentLesson}
        onClose={() => setIsLibraryModalOpen(false)}
        onSelectLesson={handleSelectLessonFromLibrary}
        onOpenSaveCurrent={() => setIsSaveModalOpen(true)}
      />

      <HtmlLessonPlayerModal
        isOpen={isHtmlLessonModalOpen}
        onClose={() => setIsHtmlLessonModalOpen(false)}
      />

      <ImportLessonModuleModal
        isOpen={isImportModuleModalOpen}
        onClose={() => setIsImportModuleModalOpen(false)}
        onApplyLesson={handleApplyLesson}
      />
    </div>
  );
}
