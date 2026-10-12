import React, { useState, useEffect, useRef } from 'react';
import {
  FolderArchive,
  Search,
  Play,
  Copy,
  Trash2,
  Download,
  Upload,
  PlusCircle,
  Clock,
  Layers,
  Sparkles,
  CheckCircle2,
  X,
  FileCode,
  Calendar,
} from 'lucide-react';
import { LessonScript } from '../types/lesson';
import { SavedLessonEntry, LessonStorage } from '../lib/lessonStorage';

interface LessonLibraryModalProps {
  isOpen: boolean;
  currentLessonId: string | null;
  currentLesson: LessonScript;
  onClose: () => void;
  onSelectLesson: (entry: SavedLessonEntry) => void;
  onOpenSaveCurrent: () => void;
}

export const LessonLibraryModal: React.FC<LessonLibraryModalProps> = ({
  isOpen,
  currentLessonId,
  currentLesson,
  onClose,
  onSelectLesson,
  onOpenSaveCurrent,
}) => {
  const [lessons, setLessons] = useState<SavedLessonEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'geometry' | 'equation'>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshLessons = () => {
    const list = LessonStorage.getAll();
    setLessons(list);
  };

  useEffect(() => {
    if (isOpen) {
      refreshLessons();
      setDeleteConfirmId(null);
      setNotification(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  const filteredLessons = lessons.filter((entry) => {
    // Problem type filter
    if (filterType === 'geometry' && entry.problemType !== 'geometry') return false;
    if (filterType === 'equation' && entry.problemType === 'geometry') return false;

    // Search query filter
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const titleMatch = entry.title.toLowerCase().includes(query);
    const problemMatch = entry.lesson.originalProblem?.toLowerCase().includes(query);
    return titleMatch || problemMatch;
  });

  const handleDuplicate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const duplicated = LessonStorage.duplicate(id);
    if (duplicated) {
      refreshLessons();
      showNotification(`Đã tạo bản sao: "${duplicated.title}"`);
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }
    const success = LessonStorage.delete(id);
    if (success) {
      refreshLessons();
      setDeleteConfirmId(null);
      showNotification('Đã xóa bài học khỏi kho.');
    }
  };

  const handleExportSingle = (entry: SavedLessonEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(entry, null, 2));
    const downloadAnchor = document.createElement('a');
    const safeTitle = entry.title.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${safeTitle || 'lesson'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showNotification(`Đã tải về tệp JSON cho bài "${entry.title}"`);
  };

  const handleExportAll = () => {
    const jsonStr = LessonStorage.exportAllToJson();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(jsonStr);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `kho_bai_giang_math_studio_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showNotification(`Đã xuất toàn bộ ${lessons.length} bài học thành tệp JSON.`);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = LessonStorage.importFromJson(content);
      if (res.importedCount > 0) {
        refreshLessons();
        showNotification(`Đã nhập thành công ${res.importedCount} bài giảng vào kho!`);
      } else {
        showNotification(res.error || 'Không thể nhập bài học từ tệp.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatDate = (ts: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-slate-100 flex flex-col max-h-[90vh] overflow-hidden">
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-linear-to-tr from-sky-500 to-indigo-600 rounded-xl text-white shadow-md shadow-sky-500/20">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">Kho bài đã lưu</h2>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-sky-400 border border-slate-700">
                  {lessons.length} bài
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Toàn bộ bài giảng đã tạo và lưu. Mở lại bất kỳ lúc nào để Preview hoặc Xuất video.
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

        {/* NOTIFICATION BANNER */}
        {notification && (
          <div className="px-5 py-2.5 bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{notification}</span>
          </div>
        )}

        {/* CONTROLS & SEARCH */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-950/50 flex flex-wrap items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên bài hoặc đề bài..."
              className="w-full pl-9 pr-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-hidden text-xs text-white placeholder-slate-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                filterType === 'all'
                  ? 'bg-sky-500 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Tất cả ({lessons.length})
            </button>
            <button
              onClick={() => setFilterType('geometry')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                filterType === 'geometry'
                  ? 'bg-sky-500 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📐 Hình học
            </button>
            <button
              onClick={() => setFilterType('equation')}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                filterType === 'equation'
                  ? 'bg-amber-500 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🔢 Đại số
            </button>
          </div>

          {/* Import / Export All */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition flex items-center gap-1.5 cursor-pointer"
              title="Nhập bài giảng từ tệp JSON sao lưu"
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Nhập JSON</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />

            <button
              onClick={handleExportAll}
              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition flex items-center gap-1.5 cursor-pointer"
              title="Tải toàn bộ kho bài về máy dưới dạng JSON"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Sao lưu tất cả</span>
            </button>
          </div>
        </div>

        {/* LIST OF LESSONS */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3">
          {filteredLessons.length === 0 ? (
            <div className="p-10 text-center flex flex-col items-center justify-center gap-3 text-slate-400">
              <div className="p-3 bg-slate-800/80 rounded-2xl text-slate-500">
                <FolderArchive className="w-8 h-8" />
              </div>
              <div>
                <p className="font-semibold text-slate-300 text-sm">Không tìm thấy bài học nào</p>
                <p className="text-xs text-slate-500 mt-1">
                  {searchQuery
                    ? 'Thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc.'
                    : 'Hãy lưu bài hiện tại hoặc nhập đề AI để tạo bài mới.'}
                </p>
              </div>
            </div>
          ) : (
            filteredLessons.map((entry) => {
              const isCurrentlyOpen = entry.id === currentLessonId;
              const stepCount = entry.lesson.steps?.length || 0;
              const duration = Math.round(
                (entry.lesson.steps || []).reduce((acc, s) => acc + (s.duration || 0), 0)
              );
              const isGeometry = entry.problemType === 'geometry';

              return (
                <div
                  key={entry.id}
                  className={`p-4 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    isCurrentlyOpen
                      ? 'bg-sky-950/20 border-sky-500/50 shadow-md shadow-sky-500/5'
                      : 'bg-slate-900/60 hover:bg-slate-800/50 border-slate-800/90'
                  }`}
                >
                  {/* Left: Info */}
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Problem type badge */}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          isGeometry
                            ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {isGeometry ? '📐 Hình học' : '🔢 Đại số'}
                      </span>

                      {/* Source badge */}
                      {(entry.moduleId || entry.lesson.module) && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <FileCode className="w-2.5 h-2.5" />
                          Lesson Module
                        </span>
                      )}
                      {entry.source === 'ai' && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          AI
                        </span>
                      )}
                      {entry.source === 'sample' && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/30">
                          Mẫu chuẩn
                        </span>
                      )}

                      {/* Currently open indicator */}
                      {isCurrentlyOpen && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Đang mở trong Studio
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="font-bold text-sm sm:text-base text-white truncate">
                      {entry.title}
                    </h3>

                    {/* Problem statement preview */}
                    {entry.lesson.originalProblem && (
                      <p className="text-xs text-slate-400 line-clamp-1 italic">
                        "{entry.lesson.originalProblem}"
                      </p>
                    )}

                    {/* Metadata stats */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-1">
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3 text-slate-400" />
                        {stepCount} bước
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        ~{duration}s
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        {formatDate(entry.updatedAt || entry.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    {/* Open Button */}
                    <button
                      onClick={() => {
                        onSelectLesson(entry);
                        onClose();
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                        isCurrentlyOpen
                          ? 'bg-slate-800 text-sky-400 border border-sky-500/30 hover:bg-slate-700'
                          : 'bg-linear-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-md shadow-sky-500/20 active:scale-95'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{isCurrentlyOpen ? 'Đang mở' : 'Mở bài'}</span>
                    </button>

                    {/* Duplicate Button */}
                    <button
                      onClick={(e) => handleDuplicate(entry.id, e)}
                      className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                      title="Nhân bản bài học này"
                    >
                      <Copy className="w-4 h-4" />
                    </button>

                    {/* Export Single JSON */}
                    <button
                      onClick={(e) => handleExportSingle(entry, e)}
                      className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                      title="Tải tệp JSON của bài này"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    {/* Delete Button */}
                    <button
                      onClick={(e) => handleDelete(entry.id, e)}
                      className={`p-1.5 rounded-xl transition cursor-pointer ${
                        deleteConfirmId === entry.id
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                          : 'hover:bg-slate-800 text-slate-400 hover:text-rose-400'
                      }`}
                      title={deleteConfirmId === entry.id ? 'Bấm lần nữa để xác nhận xóa' : 'Xóa bài học'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => {
              onClose();
              onOpenSaveCurrent();
            }}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5 text-sky-400" />
            <span>Lưu bài đang mở thành bản mới</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
