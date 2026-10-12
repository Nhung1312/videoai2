import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  Trash2,
  RotateCcw,
  Check,
  HelpCircle,
  FileText,
  ChevronRight,
  Maximize2,
} from 'lucide-react';
import {
  LessonScript,
  ImportedQuestion,
  ProblemImportResult,
  DraftStorageState,
} from '../types/lesson';
import { DraftStorage } from '../lib/draftStorage';
import { buildLessonScriptFromDraft } from '../lib/lessonBuilder';
import {
  validateGeometryTopology,
  generateAccurateGeometryScene,
  normalizeGeometryScene,
  orchestrateGeometrySteps,
} from '../lib/geometryValidator';
import { GeometryRenderer } from './GeometryRenderer';

interface ProblemInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyLesson: (lesson: LessonScript) => void;
}

// Regression Test samples
const SAMPLE_CASE_A_ONLY_PROBLEM =
  'Giải phương trình sau trên tập số thực: 2(x - 3) + 5 = 3x - 7.';

const SAMPLE_CASE_B_CHOICE = `Câu 1. Cho phương trình 3x - 6 = 0. Nghiệm của phương trình là:
A. x = 1
B. x = 2
C. x = 3
D. x = -2
Đáp án: B`;

const SAMPLE_CASE_C_USER_SOLUTION = `Cho tam giác ABC cân tại A, đường cao AH. Gọi I là trung điểm AB. Lấy K thuộc HI sao cho I là trung điểm HK. Chứng minh AHBK là hình chữ nhật.

Lời giải:
I là trung điểm AB và HK nên hai đường chéo AB và HK của tứ giác AHBK cắt nhau tại trung điểm mỗi đường. Do đó AHBK là hình bình hành.
Vì AH là đường cao nên AH vuông góc BC. H, B thuộc BC nên AH vuông góc HB.
Hình bình hành AHBK có một góc vuông nên AHBK là hình chữ nhật.`;

export const ProblemInputModal: React.FC<ProblemInputModalProps> = ({
  isOpen,
  onClose,
  onApplyLesson,
}) => {
  // Modal workflow step: 'input' or 'review'
  const [modalStep, setModalStep] = useState<'input' | 'review'>('input');

  // Input states
  const [rawText, setRawText] = useState(SAMPLE_CASE_C_USER_SOLUTION);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>('image/png');
  const [imageName, setImageName] = useState<string | null>(null);

  // Analysis state
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Review states
  const [importResult, setImportResult] = useState<ProblemImportResult | null>(null);
  const [selectedQuestionIdx, setSelectedQuestionIdx] = useState(0);
  const [editedQuestion, setEditedQuestion] = useState<ImportedQuestion | null>(null);

  // Re-analyze confirmation state
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const answerInputRef = useRef<HTMLInputElement | null>(null);

  // Check and restore draft on initial open if exists
  useEffect(() => {
    if (isOpen) {
      const savedDraft = DraftStorage.loadDraft();
      if (savedDraft) {
        if (savedDraft.importResult && savedDraft.importResult.questions?.length > 0) {
          setImportResult(savedDraft.importResult);
          const idx = savedDraft.importResult.questions.findIndex(
            (q) => q.id === savedDraft.selectedQuestionId
          );
          const effectiveIdx = idx >= 0 ? idx : 0;
          setSelectedQuestionIdx(effectiveIdx);
          setEditedQuestion(
            savedDraft.editedQuestion || savedDraft.importResult.questions[effectiveIdx]
          );
          setModalStep('review');
        } else if (savedDraft.rawInputText) {
          setRawText(savedDraft.rawInputText);
          if (savedDraft.selectedImagePreview) {
            setImagePreview(savedDraft.selectedImagePreview);
          }
        }
      }
    }
  }, [isOpen]);

  // Support clipboard paste (Ctrl+V) for images
  useEffect(() => {
    if (!isOpen || modalStep !== 'input') return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            processImageFile(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, modalStep]);

  if (!isOpen) return null;

  const processImageFile = (file: File) => {
    setImageName(file.name);
    setImageMimeType(file.type || 'image/png');
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setImagePreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  const handleRemoveImage = () => {
    setImagePreview(null);
    setImageName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Perform AI Analysis (Called only once per user click!)
  const handleAnalyzeWithAI = async () => {
    if (!rawText.trim() && !imagePreview) {
      setErrorMsg('Vui lòng dán nội dung đề bài hoặc tải ảnh đề bài.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setConfirmReanalyze(false);

    try {
      const response = await fetch('/api/parse-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemText: rawText.trim(),
          imageBase64: imagePreview || undefined,
          imageMimeType: imageMimeType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Lỗi kết nối máy chủ phân tích.');
      }

      const result: ProblemImportResult = await response.json();
      if (!result.questions || result.questions.length === 0) {
        throw new Error('AI không nhận diện được câu hỏi nào từ nội dung.');
      }

      setImportResult(result);
      setSelectedQuestionIdx(0);
      const firstQ = result.questions[0];
      setEditedQuestion(firstQ);

      // Save draft to localStorage
      const draftState: DraftStorageState = {
        rawInputText: rawText,
        selectedImagePreview: imagePreview || undefined,
        importResult: result,
        selectedQuestionId: firstQ.id,
        editedQuestion: firstQ,
        savedAt: Date.now(),
      };
      DraftStorage.saveDraft(draftState);

      // Transition to Review step
      setModalStep('review');
    } catch (err: any) {
      console.error('AI Math analysis error:', err);
      setErrorMsg(err.message || 'Không thể phân tích đề bài. Vui lòng kiểm tra lại.');
    } finally {
      setIsLoading(false);
    }
  };

  // Switch between multiple questions detected
  const handleSelectQuestion = (idx: number) => {
    if (!importResult || !importResult.questions[idx]) return;
    setSelectedQuestionIdx(idx);
    const q = importResult.questions[idx];
    setEditedQuestion(q);

    // Update draft storage
    DraftStorage.saveDraft({
      rawInputText: rawText,
      selectedImagePreview: imagePreview || undefined,
      importResult,
      selectedQuestionId: q.id,
      editedQuestion: q,
      savedAt: Date.now(),
    });
  };

  // User edits draft fields (NO AI call!)
  const handleUpdateEditedQuestion = (updates: Partial<ImportedQuestion>) => {
    if (!editedQuestion) return;
    const updated = { ...editedQuestion, ...updates };
    setEditedQuestion(updated);

    if (importResult) {
      const updatedQuestions = [...importResult.questions];
      updatedQuestions[selectedQuestionIdx] = updated;
      const updatedResult = { ...importResult, questions: updatedQuestions };
      setImportResult(updatedResult);

      DraftStorage.saveDraft({
        rawInputText: rawText,
        selectedImagePreview: imagePreview || undefined,
        importResult: updatedResult,
        selectedQuestionId: updated.id,
        editedQuestion: updated,
        savedAt: Date.now(),
      });
    }
  };

  // Deterministic solution draft generator if user has answer but no solution text
  const handleCreateSolutionDraft = () => {
    if (!editedQuestion) return;
    const ans = editedQuestion.providedAnswer?.trim() || 'đáp án đúng';
    const isChoice = editedQuestion.choices && editedQuestion.choices.length > 0;
    const matchingChoice = isChoice
      ? editedQuestion.choices?.find((c) => c.label.toUpperCase() === ans.toUpperCase())
      : null;

    let generatedSolution = `1. Phân tích đề bài: Đọc kỹ giả thiết và nhận diện yêu cầu của bài toán.\n`;
    if (isChoice && matchingChoice) {
      generatedSolution += `2. Đối chiếu các phương án trắc nghiệm: Kiểm tra điều kiện bài toán tương ứng với phương án ${matchingChoice.label}: ${matchingChoice.content}.\n`;
      generatedSolution += `3. Kết luận: Phương án chính xác là ${matchingChoice.label}.`;
    } else {
      generatedSolution += `2. Biến đổi và tính toán: Áp dụng các quy tắc đại số và công thức để tìm ra kết quả.\n`;
      generatedSolution += `3. Kết luận: Đáp án chính xác của bài toán là ${ans}.`;
    }

    handleUpdateEditedQuestion({
      providedSolution: generatedSolution,
      hasProvidedSolution: true,
      solutionSource: 'user',
    });
    setErrorMsg(null);
  };

  // Re-generate / Normalize Geometry accurately according to the problem constraints
  const handleNormalizeGeometry = () => {
    if (!editedQuestion) return;
    const accurateScene = generateAccurateGeometryScene(
      editedQuestion.problemText,
      editedQuestion.visibleLabels
    );
    const existingSteps = editedQuestion.proposedLessonScript?.steps || [];
    const orchestratedSteps = existingSteps.length > 0
      ? orchestrateGeometrySteps(accurateScene, existingSteps, editedQuestion.problemText)
      : existingSteps;

    handleUpdateEditedQuestion({
      proposedLessonScript: {
        ...(editedQuestion.proposedLessonScript || {
          title: editedQuestion.problemText.slice(0, 48),
          problemType: 'geometry',
          originalProblem: editedQuestion.problemText,
          steps: [],
        }),
        geometryScene: accurateScene,
        steps: orchestratedSteps,
      },
      visibleLabels: accurateScene.points.map((p) => p.name),
    });
    setErrorMsg(null);
  };

  // Approve & Build Final Lesson (NO AI call, NO TTS call!)
  const handleApproveAndBuildLesson = () => {
    if (!editedQuestion) return;

    const hasSolution = Boolean(
      (editedQuestion.providedSolution && editedQuestion.providedSolution.trim()) ||
      (editedQuestion.proposedLessonScript?.steps && editedQuestion.proposedLessonScript.steps.length > 0)
    );

    if (!hasSolution) {
      setErrorMsg('Bài này cần tạo lời giải trước khi xuất bản giảng. Hãy bấm "Tạo lời giải" hoặc nhập lời giải chi tiết.');
      return;
    }

    // Safety validation: Ensure geometry scene matches the problem topology
    const isGeo = editedQuestion.questionType === 'geometry' || editedQuestion.hasFigure;
    if (isGeo) {
      const existingScene = editedQuestion.proposedLessonScript?.geometryScene;
      const normalizedScene = normalizeGeometryScene(
        existingScene,
        editedQuestion.problemText,
        editedQuestion.visibleLabels
      );
      const existingSteps = editedQuestion.proposedLessonScript?.steps || [];
      const orchestratedSteps = existingSteps.length > 0
        ? orchestrateGeometrySteps(normalizedScene, existingSteps, editedQuestion.problemText)
        : existingSteps;

      editedQuestion.proposedLessonScript = {
        ...(editedQuestion.proposedLessonScript || {
          title: editedQuestion.problemText.slice(0, 48),
          problemType: 'geometry',
          originalProblem: editedQuestion.problemText,
          steps: [],
        }),
        geometryScene: normalizedScene,
        steps: orchestratedSteps,
      };
      editedQuestion.visibleLabels = normalizedScene.points.map((p) => p.name);
    }

    // Build finalized LessonScript completely client-side
    const finalLesson = buildLessonScriptFromDraft(editedQuestion);

    // Clear unapproved draft or save approved state
    DraftStorage.clearDraft();

    // Pass to application workspace
    onApplyLesson(finalLesson);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-slate-100 flex flex-col max-h-[92vh] overflow-hidden">
        {/* MODAL HEADER */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-linear-to-tr from-sky-500 to-indigo-600 rounded-xl text-white shadow-md shadow-sky-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  {modalStep === 'input'
                    ? 'Nhập & Phân Tích Đề Bài Toán'
                    : 'Kiểm Tra & Duyệt Bản Nháp Bài Giảng'}
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  ĐỢT 3B
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {modalStep === 'input'
                  ? 'Dán đề tự do hoặc tải ảnh đề bài • AI phân loại và tạo bản nháp'
                  : 'Kiểm tra kỹ nội dung trước khi duyệt • Tuyệt đối không sinh giọng đọc TTS trước'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* STEP 1: INPUT SCREEN */}
        {modalStep === 'input' && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Quick Test Samples */}
            <div>
              <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                <span>Mẫu thử nghiệm nhanh (3 Trường Hợp):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRawText(SAMPLE_CASE_C_USER_SOLUTION);
                    handleRemoveImage();
                  }}
                  className="p-2.5 rounded-xl text-left bg-slate-950/60 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition"
                >
                  <div className="text-xs font-bold text-emerald-400 mb-0.5">
                    Trường hợp C: Đề + Lời giải
                  </div>
                  <div className="text-[11px] text-slate-400 line-clamp-2">
                    Hình học AHBK • Giữ phương pháp và trình tự của người dùng.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRawText(SAMPLE_CASE_B_CHOICE);
                    handleRemoveImage();
                  }}
                  className="p-2.5 rounded-xl text-left bg-slate-950/60 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition"
                >
                  <div className="text-xs font-bold text-amber-400 mb-0.5">
                    Trường hợp B: Đề + Đáp án
                  </div>
                  <div className="text-[11px] text-slate-400 line-clamp-2">
                    Trắc nghiệm A, B, C, D • Ưu tiên đáp án người dùng cung cấp.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRawText(SAMPLE_CASE_A_ONLY_PROBLEM);
                    handleRemoveImage();
                  }}
                  className="p-2.5 rounded-xl text-left bg-slate-950/60 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition"
                >
                  <div className="text-xs font-bold text-sky-400 mb-0.5">
                    Trường hợp A: Chỉ có đề
                  </div>
                  <div className="text-[11px] text-slate-400 line-clamp-2">
                    Phương trình bậc nhất • AI tự giải và chia bước tuần tự.
                  </div>
                </button>
              </div>
            </div>

            {/* Smart Paste Textarea */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Văn bản đề bài, đáp án hoặc lời giải (Smart Paste):</span>
                <span className="text-[11px] text-slate-500 font-normal">
                  Tự động phân loại cấu trúc
                </span>
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Dán đề bài, đáp án hoặc lời giải vào đây... Bạn có thể dán nhiều câu (Câu 1, Câu 2...)."
                rows={7}
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3.5 text-sm font-sans focus:outline-none focus:border-sky-500 text-slate-200 placeholder:text-slate-600 transition"
              />
            </div>

            {/* Multimodal Image Input (File, Drag & Drop, Clipboard) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                <span>Tải ảnh đề bài (Hỗ trợ hình học, đồ thị, chữ in hoặc viết tay):</span>
              </label>

              {imagePreview ? (
                /* Uploaded Image Preview */
                <div className="relative rounded-2xl border border-slate-800 bg-slate-950 p-2 flex items-center gap-3">
                  <img
                    src={imagePreview}
                    alt="Đề bài"
                    className="w-20 h-20 object-cover rounded-xl border border-slate-800"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-200 truncate">
                      {imageName || 'Ảnh đề bài đã tải lên'}
                    </div>
                    <div className="text-[11px] text-emerald-400 mt-0.5">
                      ✓ Đã đính kèm ảnh • Sẽ gửi trực tiếp cho Gemini Multimodal
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition"
                    title="Xóa ảnh"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                /* Drag & Drop / File Input Box */
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.startsWith('image/')) {
                      processImageFile(file);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-800 hover:border-sky-500/50 rounded-2xl p-4 text-center cursor-pointer bg-slate-950/40 hover:bg-slate-950 transition group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Upload className="w-6 h-6 text-slate-500 group-hover:text-sky-400 mx-auto mb-1.5 transition" />
                  <div className="text-xs font-semibold text-slate-300">
                    Bấm để chọn ảnh, kéo thả hoặc dán từ clipboard (Ctrl + V)
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Hỗ trợ PNG, JPG, JPEG, WEBP • Nhận diện cả chữ và hình vẽ
                  </div>
                </div>
              )}
            </div>

            {/* Error Message Alert */}
            {errorMsg && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Action Bar */}
            <div className="pt-2 flex items-center justify-between">
              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Chỉ gọi AI đúng 1 lần • Không sinh giọng đọc trước</span>
              </div>

              <button
                type="button"
                onClick={handleAnalyzeWithAI}
                disabled={isLoading || (!rawText.trim() && !imagePreview)}
                className="py-3 px-6 rounded-2xl font-bold text-sm bg-linear-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-50 text-white shadow-lg shadow-sky-500/25 flex items-center gap-2 transition active:scale-95 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>AI đang phân tích & tạo bản nháp...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>PHÂN TÍCH & TẠO BẢN NHÁP</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: DRAFT REVIEW & EDIT SCREEN (KIỂM TRA BẢN NHÁP) */}
        {modalStep === 'review' && editedQuestion && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Multiple Questions Selector (if more than 1 question found) */}
            {importResult && importResult.questions.length > 1 && (
              <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Phát hiện {importResult.questions.length} câu hỏi. Chọn câu muốn tạo bài giảng:</span>
                  <span className="text-[11px] text-amber-400 font-medium">(Mỗi video xử lý 1 câu)</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {importResult.questions.map((q, idx) => (
                    <button
                      key={q.id || idx}
                      type="button"
                      onClick={() => handleSelectQuestion(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                        selectedQuestionIdx === idx
                          ? 'bg-sky-500 text-white font-bold shadow-xs'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      Câu {idx + 1}: {q.problemText.slice(0, 25)}...
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Solution Source & Metadata Badges */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Nguồn lời giải:</span>
                {editedQuestion.solutionSource === 'user' ? (
                  <span className="px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Người dùng cung cấp (Bảo toàn phương pháp)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    AI tạo tự động
                  </span>
                )}
              </div>

              {editedQuestion.hasFigure && (
                <span className="px-2.5 py-0.5 rounded-full font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  📐 Có hình vẽ ({editedQuestion.figureType || 'hình học'})
                </span>
              )}
            </div>

            {/* Warnings Alert Banner (if any warnings returned) */}
            {editedQuestion.warnings && editedQuestion.warnings.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>Cảnh báo cần kiểm tra:</span>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  {editedQuestion.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>

                {/* Conflict resolution actions if answer differs */}
                {editedQuestion.providedAnswer && (
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-amber-300 font-medium">Lựa chọn xử lý:</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleUpdateEditedQuestion({
                          warnings: editedQuestion.warnings?.filter((w) => !w.includes('Đáp án')),
                        });
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 transition"
                    >
                      ✓ Giữ đáp án đã nhập ({editedQuestion.providedAnswer})
                    </button>

                    {editedQuestion.proposedLessonScript?.steps && (
                      <button
                        type="button"
                        onClick={() => {
                          const steps = editedQuestion.proposedLessonScript?.steps || [];
                          const lastStep = steps[steps.length - 1];
                          const match = lastStep?.displayText?.match(/([A-D]|\d+)/);
                          const aiAns = match ? match[0] : 'đáp án AI';
                          handleUpdateEditedQuestion({
                            providedAnswer: aiAns,
                            warnings: editedQuestion.warnings?.filter((w) => !w.includes('Đáp án')),
                          });
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-500/40 transition"
                      >
                        ⚡ Dùng kết quả AI
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        answerInputRef.current?.focus();
                        answerInputRef.current?.select();
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                    >
                      ✏️ Sửa thủ công
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Editable Fields: Problem, Type, Choices, Answer, Solution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: Problem, Choices, Answer */}
              <div className="space-y-3">
                {/* Editable Problem Statement */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Đề bài toán (Có thể chỉnh sửa):
                  </label>
                  <textarea
                    value={editedQuestion.problemText}
                    onChange={(e) => handleUpdateEditedQuestion({ problemText: e.target.value })}
                    rows={4}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs focus:outline-none focus:border-sky-500 text-slate-200 font-sans"
                  />
                </div>

                {/* Question Type Selector */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Dạng bài toán:</label>
                  <select
                    value={editedQuestion.questionType}
                    onChange={(e) =>
                      handleUpdateEditedQuestion({
                        questionType: e.target.value as any,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                  >
                    <option value="geometry">Hình học (Geometry)</option>
                    <option value="equation">Phương trình (Equation)</option>
                    <option value="algebra">Đại số (Algebra)</option>
                    <option value="multiple-choice">Trắc nghiệm (Multiple Choice)</option>
                    <option value="short-answer">Đáp án ngắn (Short Answer)</option>
                    <option value="word_problem">Toán có lời văn</option>
                  </select>
                </div>

                {/* Multiple-Choice Options Editor (A, B, C, D) */}
                {editedQuestion.choices && editedQuestion.choices.length > 0 && (
                  <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                    <label className="text-xs font-semibold text-slate-300">
                      Các phương án trắc nghiệm:
                    </label>
                    <div className="space-y-1.5">
                      {editedQuestion.choices.map((ch, cIdx) => (
                        <div key={ch.label || cIdx} className="flex items-center gap-2">
                          <span className="w-6 text-center text-xs font-bold text-sky-400">
                            {ch.label}
                          </span>
                          <input
                            type="text"
                            value={ch.content}
                            onChange={(e) => {
                              const newChoices = [...(editedQuestion.choices || [])];
                              newChoices[cIdx] = { ...ch, content: e.target.value };
                              handleUpdateEditedQuestion({ choices: newChoices });
                            }}
                            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Answer Field */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Đáp án (Người dùng hoặc AI):
                  </label>
                  <input
                    ref={answerInputRef}
                    type="text"
                    value={editedQuestion.providedAnswer || ''}
                    onChange={(e) => handleUpdateEditedQuestion({ providedAnswer: e.target.value })}
                    placeholder="Ví dụ: B hoặc x = 2 hoặc AHBK là hình chữ nhật"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Right Column: Solution & Geometry Preview */}
              <div className="space-y-3">
                {/* Solution Editor */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300">
                      Lời giải chi tiết (Từng bước):
                    </label>
                    {(!editedQuestion.providedSolution?.trim() &&
                      (!editedQuestion.proposedLessonScript?.steps ||
                        editedQuestion.proposedLessonScript.steps.length === 0)) && (
                      <button
                        type="button"
                        onClick={handleCreateSolutionDraft}
                        className="text-[11px] font-bold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-500/30 transition flex items-center gap-1 cursor-pointer"
                      >
                        ⚡ Tạo lời giải
                      </button>
                    )}
                  </div>

                  {(!editedQuestion.providedSolution?.trim() &&
                    (!editedQuestion.proposedLessonScript?.steps ||
                      editedQuestion.proposedLessonScript.steps.length === 0)) && (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-2">
                      <span>Bài này cần tạo lời giải trước khi xuất bản giảng. Hãy bấm <strong>Tạo lời giải</strong>.</span>
                      <button
                        type="button"
                        onClick={handleCreateSolutionDraft}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 shrink-0 transition"
                      >
                        Tạo lời giải
                      </button>
                    </div>
                  )}

                  <textarea
                    value={
                      editedQuestion.providedSolution ||
                      editedQuestion.proposedLessonScript?.steps
                        ?.map((s, i) => `${i + 1}. ${s.displayText || s.narration}`)
                        .join('\n') ||
                      ''
                    }
                    onChange={(e) =>
                      handleUpdateEditedQuestion({
                        providedSolution: e.target.value,
                        hasProvidedSolution: Boolean(e.target.value.trim()),
                      })
                    }
                    rows={6}
                    placeholder="Nhập hoặc dán các bước giải chi tiết tại đây..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs focus:outline-none focus:border-sky-500 text-slate-200 font-sans"
                  />
                </div>

                {/* Mini SVG Geometry Preview (if geometry scene available) */}
                {editedQuestion.proposedLessonScript?.geometryScene && (() => {
                  const geoVal = validateGeometryTopology(
                    editedQuestion.problemText,
                    editedQuestion.proposedLessonScript.geometryScene
                  );

                  return (
                    <div className="space-y-2 p-3.5 rounded-2xl bg-white text-slate-900 border border-slate-200 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-800">
                            Kiểm tra hình vẽ SVG (Dựng tự động):
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              geoVal.isValid
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-rose-100 text-rose-800 border border-rose-300'
                            }`}
                          >
                            {geoVal.isValid ? `✓ Chuẩn: ${geoVal.figureName}` : `⚠️ Sai cấu trúc: ${geoVal.figureName}`}
                          </span>
                        </div>
                        <span className="text-[10px] text-sky-700 font-semibold font-mono">
                          {editedQuestion.visibleLabels?.join(', ') || 'A, B, C, D, H, K'}
                        </span>
                      </div>

                      {/* Geometry validation error warning & 1-click repair */}
                      {!geoVal.isValid && (
                        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex flex-col gap-1.5">
                          <div className="font-semibold text-[11px] leading-tight">
                            {geoVal.errors.join(' ')}
                          </div>
                          <button
                            type="button"
                            onClick={handleNormalizeGeometry}
                            className="self-start px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white transition active:scale-95 cursor-pointer shadow-xs"
                          >
                            ⚡ Tự động chuẩn hóa hình vẽ đúng theo đề bài
                          </button>
                        </div>
                      )}

                      <div className="h-44 w-full flex items-center justify-center relative overflow-hidden bg-slate-50 rounded-xl border border-slate-200">
                        <GeometryRenderer
                          scene={editedQuestion.proposedLessonScript.geometryScene}
                          stepProgress={1}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Re-analyze warning box if clicked */}
            {confirmReanalyze && (
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200 flex items-center justify-between">
                <span>⚠️ Thao tác phân tích lại bằng AI sẽ sử dụng thêm một lượt AI quota. Bạn có chắc không?</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmReanalyze(false)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300"
                  >
                    Huỷ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModalStep('input');
                      handleAnalyzeWithAI();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-sky-500 text-white font-bold"
                  >
                    Xác nhận
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalStep('input')}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                >
                  ← Quay lại sửa đề
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmReanalyze(true)}
                  className="px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition"
                  title="Phân tích lại đề bằng AI"
                >
                  <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
                  Phân tích lại AI
                </button>
              </div>

              {/* Big Primary Approve Button */}
              <button
                type="button"
                onClick={handleApproveAndBuildLesson}
                className="py-3 px-6 rounded-2xl font-bold text-sm bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/25 flex items-center gap-2 transition active:scale-95 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>DUYỆT & TẠO BÀI GIẢNG</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
