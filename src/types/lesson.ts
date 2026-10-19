/**
 * Data structures for AI Math Video Studio
 */

export type ProblemType =
  | 'arithmetic'
  | 'algebra'
  | 'equation'
  | 'inequality'
  | 'geometry'
  | 'coordinate_geometry'
  | 'graph'
  | 'statistics'
  | 'probability'
  | 'word_problem'
  | 'mixed';

export type StepType = 'text' | 'math' | 'geometry' | 'highlight' | 'conclusion';

export interface GeometricPoint {
  id: string; // e.g. "point-A"
  name: string; // e.g. "A"
  x: number;
  y: number;
  labelPosition?: 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'custom';
  labelOffset?: { x: number; y: number };
  color?: string;
  visible?: boolean;
}

export interface GeometricSegment {
  id: string; // e.g. "segment-AB"
  fromPointId: string;
  toPointId: string;
  style?: 'solid' | 'dashed' | 'dotted';
  color?: string;
  strokeWidth?: number;
  isAuxiliary?: boolean; // auxiliary construction lines (đường phụ)
  isHelper?: boolean; // subsegment or helper segment (e.g. segment-AI, segment-IB)
  visible?: boolean;
}

export interface GeometricPolygon {
  id: string; // e.g. "polygon-AHBK"
  pointIds: string[]; // Order of vertices, e.g. ["point-A", "point-H", "point-B", "point-K"]
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  visible?: boolean;
}

export interface GeometricAngleMarker {
  id: string; // e.g. "angle-AHB"
  vertexPointId: string;
  point1Id: string;
  point2Id: string;
  isRightAngle?: boolean;
  isEqualAngle?: boolean;
  angleValueText?: string; // e.g. "90°"
  arcCount?: number;
  color?: string;
  visible?: boolean;
}

export interface GeometricEqualLengthMarker {
  id: string; // e.g. "equal-AI-IB"
  segmentIds: string[]; // e.g. ["segment-AI", "segment-IB"]
  ticksCount?: number; // 1 = single tick |, 2 = double tick ||
  color?: string;
  visible?: boolean;
}

export interface GeometricCircle {
  id: string;
  centerPointId: string;
  radius: number;
  radiusPointId?: string;
  style?: 'solid' | 'dashed';
  color?: string;
  visible?: boolean;
}

export interface GeometricRelation {
  type:
    | 'midpoint'
    | 'perpendicular'
    | 'parallel'
    | 'equal_length'
    | 'collinear'
    | 'intersection'
    | 'belongs_to'
    | 'angle_equal'
    | 'triangle_isosceles';
  description: string;
  targetIds: string[];
}

export interface GeometryScene {
  viewBox: { width: number; height: number };
  points: GeometricPoint[];
  segments: GeometricSegment[];
  polygons?: GeometricPolygon[];
  angleMarkers?: GeometricAngleMarker[];
  equalLengthMarkers?: GeometricEqualLengthMarker[];
  circles?: GeometricCircle[];
  relations?: GeometricRelation[];
}

export interface StepAction {
  targetId: string; // ID of point, segment, polygon, or math line
  actionType: 'draw' | 'show' | 'hide' | 'highlight' | 'fade-in' | 'pulse';
  delay?: number; // delay within step in seconds
  duration?: number;
}

export interface CuePoint {
  time: number; // seconds relative to step start
  event: 'startNarration' | 'revealMath' | 'drawGeometry' | 'highlight' | 'custom';
  payload?: any;
}

export interface LessonPresentationSettings {
  revealMode?: 'typewriter' | 'chunk' | 'immediate';
  typingSpeed?: number; // ms per character (default ~30-35ms)
  mathRevealMode?: 'semantic' | 'immediate';
  showTypingCursor?: boolean;
}

export interface LessonStep {
  id: string;
  type: StepType;
  title?: string;
  narration: string; // Lời giáo viên nói (TTS), có thể giải thích rộng hơn phần ghi bảng
  phase?: 'problem' | 'solution'; // Hình học: đọc/dựng đề trước, sau đó mới viết bài giải
  problemReveal?: string; // Mẩu đề xuất hiện đồng bộ với lời đọc ở pha problem
  boardText?: string; // Nội dung ngắn gọn học sinh cần ghi vào vở
  boardMath?: string; // Công thức/chứng minh chính cần ghi
  boardMathLines?: string[]; // Các dòng bài giải cần tích lũy trên bảng
  displayText?: string; // Legacy: nội dung màn hình cũ, dùng làm fallback cho boardText
  latex?: string; // Legacy: công thức cũ, dùng làm fallback cho boardMath
  latexLines?: string[]; // Legacy: các dòng cũ, dùng làm fallback cho boardMathLines
  highlightedLineIndex?: number; // Dòng biến đổi đang được chú ý
  duration: number; // Thời lượng bước tính bằng giây
  actions?: StepAction[];
  cuePoints?: CuePoint[];
  typingSpeed?: number; // step override in ms
  revealMode?: 'typewriter' | 'chunk' | 'immediate';
  mathRevealMode?: 'semantic' | 'immediate';
  visibleObjectIds?: string[]; // Các ID hình học hiển thị tại bước này
  highlightedObjectIds?: string[]; // Các ID hình học được highlight tại bước này
}

import type { LessonModule, LessonModuleStep, LessonViewport } from './lessonModule.ts';

export type { LessonModule, LessonModuleStep, LessonViewport };

export interface LessonScript {
  title: string;
  problemType: ProblemType;
  originalProblem: string;
  presentation?: LessonPresentationSettings;
  geometryScene?: GeometryScene;
  steps: LessonStep[];
  module?: LessonModule;
}

export interface ChoiceOption {
  label: string; // "A", "B", "C", "D"...
  content: string; // Nội dung phương án
}

export interface ImportedQuestion {
  id: string; // e.g. "q-1"
  problemText: string; // Đề bài nhận diện được
  mathExpressions?: string[]; // Các biểu thức toán học chính
  questionType:
    | 'multiple-choice'
    | 'short-answer'
    | 'algebra'
    | 'equation'
    | 'geometry'
    | 'graph'
    | 'word_problem'
    | 'other';
  choices?: ChoiceOption[];
  providedAnswer?: string; // Đáp án nếu người dùng cung cấp (e.g. "C" hoặc "12")
  providedSolution?: string; // Lời giải chi tiết nếu người dùng cung cấp
  hasProvidedAnswer: boolean;
  hasProvidedSolution: boolean;
  solutionSource: 'user' | 'ai' | 'hybrid'; // Nguồn lời giải: do người dùng cung cấp hay do AI giải
  hasFigure: boolean; // Có hình vẽ trong đề/ảnh hay không
  figureType?: 'geometry' | 'graph' | 'coordinate' | 'chart' | 'spatial' | 'unknown';
  figureDescription?: string;
  visibleLabels?: string[]; // e.g. ["A", "B", "C", "H", "I", "K"]
  geometryRelations?: string[]; // e.g. ["Tam giác ABC cân tại A", "AH vuông góc BC"]
  confidence: number; // 0 - 1
  warnings?: string[]; // Cảnh báo mâu thuẫn đáp án, lỗi toán học hoặc cần kiểm tra hình
  proposedLessonScript?: LessonScript; // Kịch bản bài giảng do AI chuẩn hóa sẵn ngay trong lượt gọi duy nhất
}

export interface ProblemImportResult {
  questions: ImportedQuestion[];
  rawInputText?: string;
  hasImage?: boolean;
}

export interface DraftStorageState {
  rawInputText: string;
  selectedImagePreview?: string;
  importResult?: ProblemImportResult;
  selectedQuestionId?: string;
  editedQuestion?: ImportedQuestion;
  savedAt: number;
}

