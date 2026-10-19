import React, { useState, useEffect } from 'react';
import { LessonScript, LessonStep } from '../types/lesson';
import { Edit3, Plus, Trash2, Clock, Volume2, ArrowUp, ArrowDown, Copy } from 'lucide-react';
import { MathRenderer } from './MathRenderer';

interface ScriptEditorModalProps {
  isOpen: boolean;
  lesson: LessonScript;
  onClose: () => void;
  onSaveLesson: (updated: LessonScript) => void;
}

export const ScriptEditorModal: React.FC<ScriptEditorModalProps> = ({
  isOpen,
  lesson,
  onClose,
  onSaveLesson,
}) => {
  const [editedLesson, setEditedLesson] = useState<LessonScript>(() =>
    JSON.parse(JSON.stringify(lesson))
  );

  useEffect(() => {
    if (isOpen) {
      setEditedLesson(JSON.parse(JSON.stringify(lesson)));
    }
  }, [isOpen, lesson]);

  if (!isOpen) return null;

  const handleStepChange = (index: number, field: keyof LessonStep, value: any) => {
    setEditedLesson((prev) => {
      const newSteps = [...prev.steps];
      const updated = { ...newSteps[index], [field]: value };
      if (field === 'displayText') {
        updated.boardText = value;
      } else if (field === 'boardText') {
        updated.displayText = value;
      } else if (field === 'latex') {
        updated.boardMath = value;
      } else if (field === 'boardMath') {
        updated.latex = value;
      }
      newSteps[index] = updated;
      return { ...prev, steps: newSteps };
    });
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= editedLesson.steps.length) return;
    setEditedLesson((prev) => {
      const newSteps = [...prev.steps];
      const temp = newSteps[index];
      newSteps[index] = newSteps[targetIndex];
      newSteps[targetIndex] = temp;
      return { ...prev, steps: newSteps };
    });
  };

  const handleDuplicateStep = (index: number) => {
    setEditedLesson((prev) => {
      const sourceStep = prev.steps[index];
      const duplicatedStep: LessonStep = {
        ...JSON.parse(JSON.stringify(sourceStep)),
        id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: `${sourceStep.title || 'Bước'} (Bản sao)`,
      };
      const newSteps = [...prev.steps];
      newSteps.splice(index + 1, 0, duplicatedStep);
      return { ...prev, steps: newSteps };
    });
  };

  const handleAddStep = () => {
    const newStep: LessonStep = {
      id: `step-${Date.now()}`,
      type: 'math',
      title: `Bước ${editedLesson.steps.length + 1}`,
      narration: 'Lời thuyết minh cho bước giải này.',
      displayText: 'Tóm tắt nội dung hiển thị',
      boardText: 'Tóm tắt nội dung hiển thị',
      latex: 'x = 0',
      boardMath: 'x = 0',
      duration: 4,
    };
    setEditedLesson((prev) => ({
      ...prev,
      steps: [...prev.steps, newStep],
    }));
  };

  const handleDeleteStep = (index: number) => {
    if (editedLesson.steps.length <= 1) return;
    setEditedLesson((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, idx) => idx !== index),
    }));
  };

  const handleSave = () => {
    onSaveLesson(editedLesson);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-slate-100 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/10 rounded-xl text-amber-400 border border-amber-500/20">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Chỉnh sửa kịch bản bài giảng (Script Editor)</h2>
              <p className="text-xs text-slate-400">
                Hiệu chỉnh nội dung, công thức KaTeX, lời thuyết minh narration và thời lượng từng bước trước khi xuất.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-2">
          {/* Title & Problem metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Tiêu đề video bài giảng
              </label>
              <input
                type="text"
                value={editedLesson.title}
                onChange={(e) =>
                  setEditedLesson((prev) => ({ ...prev, title: e.target.value }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-hidden focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Loại bài toán
              </label>
              <select
                value={editedLesson.problemType}
                onChange={(e) =>
                  setEditedLesson((prev) => ({
                    ...prev,
                    problemType: e.target.value as any,
                  }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-hidden focus:border-sky-500"
              >
                <option value="geometry">Hình học (Geometry)</option>
                <option value="equation">Phương trình (Equation)</option>
                <option value="algebra">Đại số (Algebra)</option>
                <option value="arithmetic">Số học (Arithmetic)</option>
                <option value="inequality">Bất đẳng thức (Inequality)</option>
                <option value="word_problem">Toán có lời văn (Word Problem)</option>
                <option value="mixed">Tổng hợp (Mixed)</option>
              </select>
            </div>
          </div>

          {/* Presentation Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Hiệu ứng gõ chữ (Reveal Mode)
              </label>
              <select
                value={editedLesson.presentation?.revealMode || 'typewriter'}
                onChange={(e) =>
                  setEditedLesson((prev) => ({
                    ...prev,
                    presentation: {
                      ...prev.presentation,
                      revealMode: e.target.value as any,
                    },
                  }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-hidden focus:border-sky-500"
              >
                <option value="typewriter">Gõ từng chữ (Typewriter)</option>
                <option value="chunk">Hiện theo cụm (Chunk)</option>
                <option value="immediate">Hiện ngay lập tức (Immediate)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Tốc độ gõ chữ (ms/ký tự, mặc định: 32ms)
              </label>
              <input
                type="number"
                min="10"
                max="100"
                step="5"
                value={editedLesson.presentation?.typingSpeed || 32}
                onChange={(e) =>
                  setEditedLesson((prev) => ({
                    ...prev,
                    presentation: {
                      ...prev.presentation,
                      typingSpeed: parseInt(e.target.value) || 32,
                    },
                  }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-hidden focus:border-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Đề bài gốc
            </label>
            <textarea
              rows={2}
              value={editedLesson.originalProblem}
              onChange={(e) =>
                setEditedLesson((prev) => ({
                  ...prev,
                  originalProblem: e.target.value,
                }))
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-sky-500 resize-none"
            />
          </div>

          {/* List of Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-200">
                Danh sách các bước trình bày ({editedLesson.steps.length} bước)
              </h3>
              <button
                type="button"
                onClick={handleAddStep}
                className="flex items-center gap-1 px-3 py-1 bg-sky-500/20 hover:bg-sky-500/30 text-sky-400 border border-sky-500/30 rounded-lg text-xs font-medium transition"
              >
                <Plus className="w-3.5 h-3.5" /> Thêm bước
              </button>
            </div>

            <div className="space-y-4">
              {editedLesson.steps.map((step, idx) => (
                <div
                  key={step.id || idx}
                  className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-400 uppercase tracking-wide">
                      Bước {idx + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {/* Move Up */}
                      <button
                        type="button"
                        onClick={() => handleMoveStep(idx, 'up')}
                        disabled={idx === 0}
                        title="Di chuyển bước lên trên"
                        className="p-1.5 rounded-md text-slate-400 hover:text-sky-300 hover:bg-slate-900 transition disabled:opacity-20 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      {/* Move Down */}
                      <button
                        type="button"
                        onClick={() => handleMoveStep(idx, 'down')}
                        disabled={idx === editedLesson.steps.length - 1}
                        title="Di chuyển bước xuống dưới"
                        className="p-1.5 rounded-md text-slate-400 hover:text-sky-300 hover:bg-slate-900 transition disabled:opacity-20 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      {/* Duplicate Step */}
                      <button
                        type="button"
                        onClick={() => handleDuplicateStep(idx)}
                        title="Nhân bản bước này"
                        className="p-1.5 rounded-md text-slate-400 hover:text-emerald-300 hover:bg-slate-900 transition"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>

                      {/* Duration */}
                      <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-900 px-2 py-1 rounded-md border border-slate-800">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>Thời lượng:</span>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          step="0.5"
                          value={step.duration}
                          onChange={(e) =>
                            handleStepChange(idx, 'duration', parseFloat(e.target.value) || 3)
                          }
                          className="w-12 bg-slate-950 text-center text-xs text-amber-300 font-mono rounded px-1 py-0.5 border border-slate-700"
                        />
                        <span>giây</span>
                      </div>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={() => handleDeleteStep(idx)}
                        disabled={editedLesson.steps.length <= 1}
                        title="Xóa bước này"
                        className="text-slate-500 hover:text-rose-400 p-1.5 rounded-md hover:bg-slate-900 transition disabled:opacity-20"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title & Display text */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400">Tiêu đề bước</label>
                      <input
                        type="text"
                        value={step.title || ''}
                        onChange={(e) => handleStepChange(idx, 'title', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400">Dòng giải thích trên bảng</label>
                      <input
                        type="text"
                        value={step.displayText || ''}
                        onChange={(e) => handleStepChange(idx, 'displayText', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-sky-500"
                      />
                    </div>
                  </div>

                  {/* LaTeX Formula */}
                  <div>
                    <label className="text-[11px] text-slate-400">Công thức KaTeX (LaTeX)</label>
                    <input
                      type="text"
                      value={step.latex || step.boardMath || ''}
                      onChange={(e) => handleStepChange(idx, 'latex', e.target.value)}
                      placeholder="Ví dụ: \Delta ABC \text{ cân tại } A"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-sky-300 focus:outline-hidden focus:border-sky-500"
                    />
                    {(step.latex || step.boardMath) && (
                      <div className="mt-1.5 p-2 bg-slate-950/80 rounded-lg border border-slate-800/80 flex items-center justify-between overflow-x-auto">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mr-2 shrink-0">
                          Xem trước KaTeX:
                        </span>
                        <div className="text-sm text-sky-200">
                          <MathRenderer
                            latex={step.latex || step.boardMath}
                            displayMode={false}
                            fontSize="sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Narration voiceover text */}
                  <div>
                    <div className="flex items-center gap-1 text-[11px] text-amber-400 font-medium mb-1">
                      <Volume2 className="w-3 h-3" />
                      <span>Kịch bản lời giảng đọc (Narration cho TTS):</span>
                    </div>
                    <textarea
                      rows={2}
                      value={step.narration}
                      onChange={(e) => handleStepChange(idx, 'narration', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-hidden focus:border-amber-500/80 resize-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition active:scale-95"
          >
            Lưu kịch bản
          </button>
        </div>
      </div>
    </div>
  );
};
