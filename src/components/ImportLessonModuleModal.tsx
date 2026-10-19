import React, { useState } from 'react';
import {
  X,
  Upload,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  Play,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { LessonScript } from '../types/lesson';
import { LessonModule } from '../types/lessonModule';
import { LessonModuleRegistry } from '../lib/lessonModuleRegistry';
import { lessonModuleToScript } from '../lib/lessonModuleAdapter';

interface ImportLessonModuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyLesson: (
    lesson: LessonScript,
    message?: string,
    options?: { source?: 'ai' | 'sample' | 'custom'; id?: string }
  ) => void;
}

export const ImportLessonModuleModal: React.FC<ImportLessonModuleModalProps> = ({
  isOpen,
  onClose,
  onApplyLesson,
}) => {
  const [rawCode, setRawCode] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{
    tested: boolean;
    success: boolean;
    error?: string;
    module?: LessonModule;
  }>({ tested: false, success: false });

  if (!isOpen) return null;

  const handleValidate = (codeToTest = rawCode) => {
    if (!codeToTest.trim()) {
      setValidationResult({
        tested: true,
        success: false,
        error: 'Vui lòng tải tệp hoặc dán nội dung mã Lesson Module.',
      });
      return;
    }

    const res = LessonModuleRegistry.parseAndValidate(codeToTest);
    if (res.success) {
      setValidationResult({
        tested: true,
        success: true,
        module: res.module,
      });
    } else {
      setValidationResult({
        tested: true,
        success: false,
        error: res.error,
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setRawCode(content);
      handleValidate(content);
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!validationResult.success || !validationResult.module) {
      handleValidate();
      return;
    }

    const mod = validationResult.module;

    // 1. Register module in registry and persist raw code
    LessonModuleRegistry.register(mod, rawCode);

    // 2. Convert to LessonScript (geometryScene remains undefined, renderer intact)
    const script = lessonModuleToScript(mod);

    // 3. Apply lesson directly to App & Storage without calling AI
    onApplyLesson(
      script,
      `Đã nhập thành công Lesson Module "${mod.title}" vào Kho bài!`,
      { source: 'custom', id: mod.id }
    );

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Nhập Lesson Module
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Deterministic Renderer
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Thêm bài giảng tự dựng hình với renderer riêng (không qua AI geometry planner).
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* File Upload Area */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Cách 1: Tải lên tệp Module (.js, .ts, .json, .txt)
            </label>
            <label className="border-2 border-dashed border-slate-700 hover:border-sky-500 bg-slate-950/40 hover:bg-slate-800/40 rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors group">
              <Upload className="w-6 h-6 text-slate-400 group-hover:text-sky-400 transition-colors" />
              <div className="text-center">
                <span className="text-xs font-medium text-slate-300">
                  {fileName ? `Đã chọn: ${fileName}` : 'Bấm để chọn tệp hoặc kéo thả tệp vào đây'}
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">Hỗ trợ các định dạng .js, .ts, .json</p>
              </div>
              <input
                type="file"
                accept=".js,.ts,.json,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Paste Code Area */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Cách 2: Dán mã Lesson Module
              </label>
              {rawCode && (
                <button
                  type="button"
                  onClick={() => handleValidate(rawCode)}
                  className="text-xs text-sky-400 hover:text-sky-300 cursor-pointer font-medium"
                >
                  Kiểm tra cú pháp
                </button>
              )}
            </div>
            <textarea
              value={rawCode}
              onChange={(e) => {
                setRawCode(e.target.value);
                setValidationResult({ tested: false, success: false });
              }}
              placeholder={`// Dán mã Lesson Module ở đây, ví dụ:
export default {
  id: "trapezoid-dh-ck",
  title: "Chứng minh DH = CK trong hình thang cân",
  problemType: "geometry",
  steps: [
    {
      phase: "problem",
      displayText: "Cho hình thang cân ABCD (AB // CD)...",
      narration: "Cho hình thang cân A B C D với đáy lớn C D..."
    },
    ...
  ],
  render(ctx, stepIndex, progress, viewport) {
    // Logic vẽ canvas deterministic...
  }
};`}
              rows={9}
              className="w-full bg-slate-950 font-mono text-xs text-slate-200 border border-slate-700 rounded-xl p-3 focus:outline-none focus:border-sky-500 transition-colors leading-relaxed"
              spellCheck={false}
            />
          </div>

          {/* Validation Feedback */}
          {validationResult.tested && (
            <div>
              {validationResult.success && validationResult.module ? (
                <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-emerald-200 text-xs space-y-1.5 animate-in fade-in">
                  <div className="flex items-center gap-2 font-semibold text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    Lesson Module hợp lệ và an toàn!
                  </div>
                  <div className="text-slate-300 space-y-0.5 pl-6">
                    <div>
                      <span className="text-slate-400">Tiêu đề:</span>{' '}
                      <span className="font-semibold text-white">{validationResult.module.title}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Mã module:</span>{' '}
                      <code className="text-sky-300">{validationResult.module.id}</code>
                    </div>
                    <div>
                      <span className="text-slate-400">Số bước:</span>{' '}
                      <span className="text-amber-300 font-semibold">{validationResult.module.steps.length} bước</span>{' '}
                      ({validationResult.module.steps.filter((s) => s.phase === 'problem').length} đề bài,{' '}
                      {validationResult.module.steps.filter((s) => s.phase === 'solution').length} bài giải)
                    </div>
                    <div className="text-emerald-400/90 text-[11px] pt-1">
                      ✓ Đã chạy thử nghiệm hàm render(ctx, stepIndex, progress, viewport) thành công.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-rose-950/40 border border-rose-500/30 rounded-xl text-rose-200 text-xs flex items-start gap-2.5 animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-rose-300">Không thể nhập Module</div>
                    <div className="text-slate-300 mt-0.5">{validationResult.error}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            Đóng
          </button>
          <div className="flex items-center gap-2">
            {!validationResult.success && (
              <button
                type="button"
                onClick={() => handleValidate()}
                disabled={!rawCode.trim()}
                className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Layers className="w-3.5 h-3.5" />
                Kiểm tra Module
              </button>
            )}
            <button
              type="button"
              onClick={handleImport}
              disabled={!validationResult.success}
              className="px-5 py-2 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-white rounded-xl shadow-lg shadow-sky-500/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Nhập vào Kho bài & Mở ngay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
