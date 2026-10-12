import React, { useState, useEffect } from 'react';
import { Bookmark, Save, PlusCircle, Check, X } from 'lucide-react';
import { LessonScript, LessonPresentationSettings } from '../types/lesson';
import { SavedLessonEntry, LessonStorage } from '../lib/lessonStorage';

interface SaveLessonModalProps {
  isOpen: boolean;
  lesson: LessonScript;
  currentLessonId: string | null;
  aspectRatio: '16:9' | '9:16';
  presentationSettings: LessonPresentationSettings;
  onClose: () => void;
  onSaved: (savedEntry: SavedLessonEntry, message: string) => void;
}

export const SaveLessonModal: React.FC<SaveLessonModalProps> = ({
  isOpen,
  lesson,
  currentLessonId,
  aspectRatio,
  presentationSettings,
  onClose,
  onSaved,
}) => {
  const [title, setTitle] = useState(lesson.title);
  const [saveMode, setSaveMode] = useState<'update' | 'new'>('update');
  const existingEntry = currentLessonId ? LessonStorage.getById(currentLessonId) : null;

  useEffect(() => {
    if (isOpen) {
      setTitle(lesson.title);
      // If the current lesson is already saved in library, default to update mode; otherwise save as new
      setSaveMode(existingEntry ? 'update' : 'new');
    }
  }, [isOpen, lesson.title, currentLessonId]);

  if (!isOpen) return null;

  const totalDuration = lesson.steps.reduce((acc, s) => acc + (s.duration || 0), 0);
  const stepCount = lesson.steps.length;

  const handleSave = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;

    const targetId = saveMode === 'update' && currentLessonId ? currentLessonId : undefined;
    const isNew = !targetId;

    const saved = LessonStorage.save(lesson, {
      id: targetId,
      title: title.trim(),
      source: isNew ? 'custom' : existingEntry?.source || 'custom',
      aspectRatio,
      presentationSettings,
    });

    const msg = isNew
      ? `Đã lưu bài học mới "${saved.title}" vào Kho bài đã lưu!`
      : `Đã cập nhật bài học "${saved.title}" trong Kho bài đã lưu!`;

    onSaved(saved, msg);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-slate-100 flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-linear-to-tr from-sky-500 to-indigo-600 rounded-xl text-white shadow-md shadow-sky-500/20">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Lưu bài học hiện tại</h2>
              <p className="text-xs text-slate-400">
                Lưu vào bộ nhớ trình duyệt để mở lại bất cứ lúc nào
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <form onSubmit={handleSave} className="p-5 flex flex-col gap-4">
          {/* Title Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300">Tiêu đề bài học</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề bài học..."
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 focus:border-sky-500 focus:outline-hidden text-sm text-white placeholder-slate-500"
            />
          </div>

          {/* Mode Selector (if existing) */}
          {existingEntry && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-300">Tùy chọn lưu</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSaveMode('update')}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition cursor-pointer ${
                    saveMode === 'update'
                      ? 'bg-sky-500/10 border-sky-500 text-sky-200'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <Save className="w-3.5 h-3.5" />
                    <span>Cập nhật bài này</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Ghi đè thay đổi vào bài đã lưu trước đó
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSaveMode('new')}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition cursor-pointer ${
                    saveMode === 'new'
                      ? 'bg-indigo-500/10 border-indigo-500 text-indigo-200'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Lưu thành bản mới</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Tạo một mục bài học riêng biệt trong kho
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Info Card */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs flex items-center justify-between text-slate-400">
            <div>
              <span className="font-semibold text-slate-300">Dạng bài:</span>{' '}
              {lesson.problemType === 'geometry' ? '📐 Hình học' : '🔢 Đại số / Phương trình'}
            </div>
            <div>
              <span className="font-semibold text-slate-300">Số bước:</span> {stepCount} bước
            </div>
            <div>
              <span className="font-semibold text-slate-300">Thời lượng:</span> ~
              {Math.round(totalDuration)}s
            </div>
          </div>

          {/* FOOTER ACTIONS */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-linear-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-md shadow-sky-500/20 transition active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{saveMode === 'update' ? 'Cập nhật' : 'Lưu vào Kho'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
