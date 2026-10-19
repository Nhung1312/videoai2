import React, { useState, useEffect } from 'react';
import {
  Library,
  FolderOpen,
  Edit2,
  Trash2,
  Calendar,
  Layers,
  Check,
  X,
  AlertCircle,
  FileQuestion,
  Sparkles,
} from 'lucide-react';
import { LessonScript, ProblemType } from '../types/lesson';
import { LessonStorage, SavedLessonEntry } from '../lib/lessonStorage';

interface SavedLessonsModalProps {
  isOpen: boolean;
  currentSavedLessonId: string | null;
  onClose: () => void;
  onOpenLesson: (entry: SavedLessonEntry) => void;
  onLessonRenamed?: (id: string, newTitle: string) => void;
  onLessonDeleted?: (id: string) => void;
}

const PROBLEM_TYPE_LABELS: Record<ProblemType, { label: string; badgeClass: string; icon: string }> = {
  geometry: { label: 'Hình học', badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30', icon: '📐' },
  coordinate_geometry: { label: 'Hình giải tích', badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30', icon: '📐' },
  algebra: { label: 'Đại số', badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: '🔢' },
  equation: { label: 'Phương trình', badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: '🔢' },
  inequality: { label: 'Bất đẳng thức', badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30', icon: '⚖️' },
  arithmetic: { label: 'Số học', badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30', icon: '🧮' },
  graph: { label: 'Đồ thị', badgeClass: 'bg-teal-500/15 text-teal-300 border-teal-500/30', icon: '📈' },
  statistics: { label: 'Thống kê', badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: '📊' },
  probability: { label: 'Xác suất', badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30', icon: '🎲' },
  word_problem: { label: 'Toán có lời văn', badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30', icon: '📝' },
  mixed: { label: 'Tổng hợp', badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30', icon: '✨' },
};

export const SavedLessonsModal: React.FC<SavedLessonsModalProps> = ({
  isOpen,
  currentSavedLessonId,
  onClose,
  onOpenLesson,
  onLessonRenamed,
  onLessonDeleted,
}) => {
  const [lessons, setLessons] = useState<SavedLessonEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reload saved lessons whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setLessons(LessonStorage.getSavedLessons());
      setEditingId(null);
      setDeletingId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStartRename = (entry: SavedLessonEntry) => {
    setEditingId(entry.id);
    setEditingTitle(entry.title);
    setDeletingId(null);
  };

  const handleConfirmRename = (id: string) => {
    if (!editingTitle.trim()) return;
    const success = LessonStorage.renameSavedLesson(id, editingTitle.trim());
    if (success) {
      setLessons(LessonStorage.getSavedLessons());
      onLessonRenamed?.(id, editingTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const handleConfirmDelete = (id: string) => {
    const success = LessonStorage.deleteSavedLesson(id);
    if (success) {
      setLessons(LessonStorage.getSavedLessons());
      onLessonDeleted?.(id);
    }
    setDeletingId(null);
  };

  const formatDate = (timestamp: number) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-slate-100 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-linear-to-tr from-sky-500 to-indigo-600 rounded-2xl text-white shadow-md shadow-sky-500/20">
              <Library className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Kho Bài Đã Lưu
                </h2>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-800 text-sky-400 border border-slate-700">
                  {lessons.length} bài
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Lưu trữ bài giảng trên trình duyệt • Mở lại kịch bản, lời giải và hình học bất kỳ lúc nào
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Đóng kho bài"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lesson List Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-3">
          {lessons.length === 0 ? (
            /* Empty State */
            <div className="py-14 px-4 text-center flex flex-col items-center justify-center text-slate-400">
              <div className="p-4 bg-slate-800/60 rounded-3xl border border-slate-700/50 mb-3 text-slate-500">
                <FileQuestion className="w-10 h-10 text-sky-400/80" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-200 mb-1">
                Chưa có bài giảng nào trong kho
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mb-4 leading-relaxed">
                Khi đang xem một bài học, bạn hãy bấm nút <span className="font-semibold text-sky-400">💾 Lưu bài</span> trên thanh công cụ để lưu kịch bản vào đây mà không sợ bị ghi đè.
              </p>
            </div>
          ) : (
            lessons.map((entry) => {
              const isCurrent = entry.id === currentSavedLessonId;
              const isEditing = entry.id === editingId;
              const isDeleting = entry.id === deletingId;
              const typeInfo = PROBLEM_TYPE_LABELS[entry.problemType] || {
                label: entry.problemType,
                badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
                icon: '📐',
              };
              const stepCount = entry.lesson?.steps?.length || 0;

              return (
                <div
                  key={entry.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    isCurrent
                      ? 'bg-slate-800/80 border-sky-500/50 shadow-md shadow-sky-500/5 ring-1 ring-sky-500/30'
                      : 'bg-slate-950/60 hover:bg-slate-900 border-slate-800/90 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Title & Metadata */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleConfirmRename(entry.id);
                              if (e.key === 'Escape') handleCancelRename();
                            }}
                            autoFocus
                            className="flex-1 bg-slate-900 border border-sky-500/70 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                            placeholder="Nhập tên bài mới..."
                          />
                          <button
                            type="button"
                            onClick={() => handleConfirmRename(entry.id)}
                            className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white transition cursor-pointer"
                            title="Xác nhận đổi tên"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelRename}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                            title="Hủy"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mb-1.5">
                          <h3
                            className="text-xs sm:text-sm font-bold text-white truncate"
                            title={entry.title}
                          >
                            {entry.title}
                          </h3>
                          {isCurrent && (
                            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-400 border border-sky-500/30">
                              Đang phát
                            </span>
                          )}
                        </div>
                      )}

                      {/* Tags & Time */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold flex items-center gap-1 ${typeInfo.badgeClass}`}
                        >
                          <span>{typeInfo.icon}</span>
                          <span>{typeInfo.label}</span>
                        </span>

                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3 text-slate-500" />
                          <span>{stepCount} bước</span>
                        </span>

                        <span className="text-slate-600">•</span>

                        <span className="flex items-center gap-1 text-slate-500">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(entry.updatedAt)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800">
                      {isDeleting ? (
                        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 px-3 py-1.5 rounded-xl">
                          <span className="text-xs text-rose-300 font-semibold">
                            Xác nhận xóa?
                          </span>
                          <button
                            type="button"
                            onClick={() => handleConfirmDelete(entry.id)}
                            className="px-2 py-0.5 rounded-md text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white transition cursor-pointer"
                          >
                            Xóa
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            className="px-2 py-0.5 rounded-md text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStartRename(entry)}
                            className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition flex items-center gap-1 cursor-pointer"
                            title="Đổi tên bài học"
                          >
                            <Edit2 className="w-3 h-3 text-amber-400" />
                            <span className="hidden sm:inline">Đổi tên</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeletingId(entry.id)}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                            title="Xóa bài học khỏi kho"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              onOpenLesson(entry);
                              onClose();
                            }}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95 cursor-pointer ${
                              isCurrent
                                ? 'bg-slate-800 text-sky-400 border border-sky-500/40 hover:bg-slate-750'
                                : 'bg-linear-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-md shadow-sky-500/20'
                            }`}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>{isCurrent ? 'Mở lại' : 'Mở bài'}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 bg-slate-900/60">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>Mở bài đã lưu: toàn bộ lời giải, hình học và giọng đọc hoạt động ngay, không gọi lại AI.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
