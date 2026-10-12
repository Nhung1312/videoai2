/**
 * Geometry Semantic Validator and Accurate Scene Planner
 * Validates whether a geometryScene matches the problem text topology and constraints,
 * and generates geometrically accurate scenes for Middle School Geometry (THCS).
 */

import {
  GeometryScene,
  GeometricPoint,
  GeometricSegment,
  GeometricPolygon,
  GeometricAngleMarker,
  GeometricEqualLengthMarker,
  GeometricRelation,
  LessonStep,
} from '../types/lesson';

export type DetectedFigureType =
  | 'isosceles_trapezoid'
  | 'right_trapezoid'
  | 'trapezoid'
  | 'rectangle'
  | 'square'
  | 'rhombus'
  | 'parallelogram'
  | 'quadrilateral'
  | 'equilateral_triangle'
  | 'isosceles_triangle'
  | 'right_triangle'
  | 'triangle'
  | 'unknown';

export interface GeometryConstraintSpec {
  figureType: DetectedFigureType;
  mainVertices: string[]; // e.g. ['A', 'B', 'C', 'D'] or ['A', 'B', 'C']
  parallelPairs: [string, string][]; // e.g. [['AB', 'CD']]
  lengthComparisons: { smaller: string; larger: string }[]; // e.g. [{ smaller: 'AB', larger: 'CD' }]
  perpendiculars: { line1: string; line2: string; footPoint?: string }[]; // e.g. [{ line1: 'AH', line2: 'CD', footPoint: 'H' }]
  pointsOnSegments: { point: string; segment: string }[]; // e.g. [{ point: 'H', segment: 'CD' }, { point: 'K', segment: 'CD' }]
  midpoints: { point: string; segment: string }[]; // e.g. [{ point: 'I', segment: 'AB' }]
  equalSegments: [string, string][]; // e.g. [['AD', 'BC'], ['DH', 'CK']]
  allMentionedPoints: string[];
}

export interface GeometryValidationResult {
  isValid: boolean;
  figureType: DetectedFigureType;
  figureName: string;
  expectedPoints: string[];
  actualPoints: string[];
  missingPoints: string[];
  missingSegments: string[];
  errors: string[];
  warnings: string[];
}

/**
 * Extracts geometric constraints and figure specifications from problem text.
 */
export function extractGeometryConstraints(problemText: string): GeometryConstraintSpec {
  const text = problemText.replace(/\s+/g, ' ');
  const lower = text.toLowerCase();

  // 1. Detect main figure type and vertex letters
  let figureType: DetectedFigureType = 'unknown';
  let mainVertices: string[] = [];

  // Clean up LaTeX formatting and noise
  const cleanText = text.replace(/\$/g, '');
  const cleanLower = cleanText.toLowerCase();

  // Flag if the text explicitly describes a quadrilateral / trapezoid
  const hasQuadKeyword = /(?:hình\s+thang|tứ\s+giác|hình\s+bình\s+hành|hình\s+chữ\s+nhật|hình\s+thoi|hình\s+vuông)/i.test(cleanLower);

  // Search for quadrilateral in problem statement
  const quadMatch = cleanText.match(
    /(?:hình\s+thang\s+cân|hình\s+thang\s+vuông|hình\s+thang|hình\s+bình\s+hành|hình\s+chữ\s+nhật|hình\s+thoi|hình\s+vuông|tứ\s+giác)\s*[\(\{]?([A-Z]{4})[\)\}]?\b/i
  );

  // Search for triangle in problem statement
  const triMatch = cleanText.match(
    /(?:tam\s+giác\s+đều|tam\s+giác\s+vuông\s+cân|tam\s+giác\s+cân|tam\s+giác\s+vuông|tam\s+giác)\s*[\(\{]?([A-Z]{3})[\)\}]?\b/i
  );

  // Determine which figure is introduced earliest in the problem statement
  const quadIndex = quadMatch && quadMatch.index !== undefined ? quadMatch.index : Infinity;
  const triIndex = triMatch && triMatch.index !== undefined ? triMatch.index : Infinity;

  if (quadMatch && quadIndex < triIndex) {
    const letters = quadMatch[1].toUpperCase().split('');
    mainVertices = letters;
    const quadMatchedStr = quadMatch[0];
    const afterQuad = cleanText.slice(quadIndex + quadMatchedStr.length, quadIndex + quadMatchedStr.length + 25).toLowerCase();

    if (/hình\s+thang\s+cân/i.test(quadMatchedStr) || (/hình\s+thang/i.test(quadMatchedStr) && afterQuad.includes('cân'))) {
      figureType = 'isosceles_trapezoid';
    } else if (/hình\s+thang\s+vuông/i.test(quadMatchedStr) || (/hình\s+thang/i.test(quadMatchedStr) && afterQuad.includes('vuông'))) {
      figureType = 'right_trapezoid';
    } else if (/hình\s+thang/i.test(quadMatchedStr)) {
      figureType = 'trapezoid';
    } else if (/hình\s+bình\s+hành/i.test(quadMatchedStr)) {
      figureType = 'parallelogram';
    } else if (/hình\s+chữ\s+nhật/i.test(quadMatchedStr)) {
      figureType = 'rectangle';
    } else if (/hình\s+thoi/i.test(quadMatchedStr)) {
      figureType = 'rhombus';
    } else if (/hình\s+vuông/i.test(quadMatchedStr)) {
      figureType = 'square';
    } else {
      figureType = 'quadrilateral';
    }
  } else if (triMatch && triIndex < quadIndex) {
    mainVertices = triMatch[1].toUpperCase().split('');
    const triMatchedStr = triMatch[0];
    const afterTri = cleanText.slice(triIndex + triMatchedStr.length, triIndex + triMatchedStr.length + 25).toLowerCase();

    if (/tam\s+giác\s+đều/i.test(triMatchedStr) || afterTri.includes('đều')) {
      figureType = 'equilateral_triangle';
    } else if (/tam\s+giác\s+vuông\s+cân/i.test(triMatchedStr) || (afterTri.includes('vuông') && afterTri.includes('cân'))) {
      figureType = 'right_triangle';
    } else if (/tam\s+giác\s+cân/i.test(triMatchedStr) || afterTri.includes('cân')) {
      figureType = 'isosceles_triangle';
    } else if (/tam\s+giác\s+vuông/i.test(triMatchedStr) || afterTri.includes('vuông')) {
      figureType = 'right_triangle';
    } else {
      figureType = 'triangle';
    }
  }

  // If no direct attached letters matched yet, check general keywords
  if (figureType === 'unknown') {
    const quad4 = cleanText.match(/\b([A-Z]{4})\b/);
    const tri3 = cleanText.match(/\b([A-Z]{3})\b/);

    if (hasQuadKeyword && quad4) {
      if (/hình\s+thang\s+cân/i.test(cleanLower)) {
        figureType = 'isosceles_trapezoid';
      } else if (/hình\s+thang\s+vuông/i.test(cleanLower)) {
        figureType = 'right_trapezoid';
      } else if (/hình\s+thang/i.test(cleanLower)) {
        figureType = 'trapezoid';
      } else if (/hình\s+chữ\s+nhật/i.test(cleanLower)) {
        figureType = 'rectangle';
      } else if (/hình\s+bình\s+hành/i.test(cleanLower)) {
        figureType = 'parallelogram';
      } else if (/hình\s+thoi/i.test(cleanLower)) {
        figureType = 'rhombus';
      } else if (/hình\s+vuông/i.test(cleanLower)) {
        figureType = 'square';
      } else {
        figureType = 'quadrilateral';
      }
      mainVertices = quad4[1].split('');
    } else if (tri3 && !hasQuadKeyword) {
      if (/tam\s+giác\s+cân/i.test(cleanLower)) {
        figureType = 'isosceles_triangle';
      } else if (/tam\s+giác\s+vuông/i.test(cleanLower)) {
        figureType = 'right_triangle';
      } else {
        figureType = 'triangle';
      }
      mainVertices = tri3[1].split('');
    }
  }

  // 2. Extract parallel pairs: e.g. "AB ∥ CD", "AB // CD", "AB song song CD"
  const parallelPairs: [string, string][] = [];
  const parallelRegex = /\b([A-Z]{2})\s*(?:∥|\/\/|song\s+song\s+(?:với\s+)?|\\parallel)\s*([A-Z]{2})\b/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = parallelRegex.exec(text)) !== null) {
    parallelPairs.push([pMatch[1].toUpperCase(), pMatch[2].toUpperCase()]);
  }

  // 3. Extract length comparisons: e.g. "AB < CD", "AB > CD"
  const lengthComparisons: { smaller: string; larger: string }[] = [];
  const compRegex = /\b([A-Z]{2})\s*(<|>)\s*([A-Z]{2})\b/g;
  let cMatch: RegExpExecArray | null;
  while ((cMatch = compRegex.exec(text)) !== null) {
    if (cMatch[2] === '<') {
      lengthComparisons.push({ smaller: cMatch[1].toUpperCase(), larger: cMatch[3].toUpperCase() });
    } else {
      lengthComparisons.push({ smaller: cMatch[3].toUpperCase(), larger: cMatch[1].toUpperCase() });
    }
  }

  // 4. Extract perpendiculars: e.g. "AH ⟂ CD", "AH vuông góc CD", "kẻ AH vuông góc với CD"
  const perpendiculars: { line1: string; line2: string; footPoint?: string }[] = [];
  const perpRegex = /\b([A-Z]{2})\s*(?:⟂|vuông\s+góc\s+(?:với\s+)?|\\perp)\s*([A-Z]{2})\b/gi;
  let prMatch: RegExpExecArray | null;
  while ((prMatch = perpRegex.exec(text)) !== null) {
    const l1 = prMatch[1].toUpperCase();
    const l2 = prMatch[2].toUpperCase();
    // Common foot point is shared letter or 2nd letter of altitude
    const foot = l2.includes(l1[1]) ? l1[1] : l2.includes(l1[0]) ? l1[0] : l1[1];
    perpendiculars.push({ line1: l1, line2: l2, footPoint: foot });
  }

  // 5. Extract points on segments: e.g. "H, K ∈ CD", "H ∈ CD", "H thuộc CD", "H, K thuộc CD"
  const pointsOnSegments: { point: string; segment: string }[] = [];
  const onSegRegex = /(?:([A-Z](?:\s*,\s*[A-Z])*))\s*(?:∈|thuộc)\s*([A-Z]{2})\b/gi;
  let osMatch: RegExpExecArray | null;
  while ((osMatch = onSegRegex.exec(text)) !== null) {
    const pts = osMatch[1].split(',').map((p) => p.trim().toUpperCase());
    const seg = osMatch[2].toUpperCase();
    pts.forEach((pt) => {
      if (/^[A-Z]$/.test(pt)) {
        pointsOnSegments.push({ point: pt, segment: seg });
      }
    });
  }

  // Also check "H là chân đường cao kẻ từ A xuống CD"
  const footRegex = /([A-Z])\s+là\s+chân\s+đường\s+cao\s+(?:kẻ\s+từ\s+[A-Z]\s+xuống\s+|đến\s+)?([A-Z]{2})/gi;
  let fMatch: RegExpExecArray | null;
  while ((fMatch = footRegex.exec(text)) !== null) {
    pointsOnSegments.push({ point: fMatch[1].toUpperCase(), segment: fMatch[2].toUpperCase() });
  }

  // 6. Extract midpoints: e.g. "I là trung điểm AB", "gọi I là trung điểm của AB"
  const midpoints: { point: string; segment: string }[] = [];
  const midRegex = /\b([A-Z])\s+là\s+trung\s+điểm\s+(?:của\s+)?([A-Z]{2})\b/gi;
  let mMatch: RegExpExecArray | null;
  while ((mMatch = midRegex.exec(text)) !== null) {
    midpoints.push({ point: mMatch[1].toUpperCase(), segment: mMatch[2].toUpperCase() });
  }

  // 7. Extract equal segment targets: e.g. "AD = BC", "DH = CK", "chứng minh DH = CK"
  const equalSegments: [string, string][] = [];
  const eqRegex = /\b([A-Z]{2})\s*=\s*([A-Z]{2})\b/g;
  let eqMatch: RegExpExecArray | null;
  while ((eqMatch = eqRegex.exec(text)) !== null) {
    equalSegments.push([eqMatch[1].toUpperCase(), eqMatch[2].toUpperCase()]);
  }

  // 8. All mentioned single point uppercase letters in the problem
  const allMentionedPoints: string[] = [];
  const pointLetters = text.match(/\b[A-Z]\b/g) || [];
  const pSet = new Set<string>();
  pointLetters.forEach((p) => {
    // Exclude Roman numerals like V, X if not geometric
    if (['V', 'X'].includes(p) && text.includes(`phần ${p}`)) return;
    pSet.add(p);
  });
  // Also add letters from segments (e.g. AB -> A, B)
  mainVertices.forEach((v) => pSet.add(v));
  perpendiculars.forEach((pr) => {
    pSet.add(pr.line1[0]);
    pSet.add(pr.line1[1]);
    pSet.add(pr.line2[0]);
    pSet.add(pr.line2[1]);
  });
  pointsOnSegments.forEach((ps) => {
    pSet.add(ps.point);
    pSet.add(ps.segment[0]);
    pSet.add(ps.segment[1]);
  });
  midpoints.forEach((mp) => {
    pSet.add(mp.point);
    pSet.add(mp.segment[0]);
    pSet.add(mp.segment[1]);
  });

  return {
    figureType,
    mainVertices,
    parallelPairs,
    lengthComparisons,
    perpendiculars,
    pointsOnSegments,
    midpoints,
    equalSegments,
    allMentionedPoints: Array.from(pSet),
  };
}

/**
 * Validates whether a GeometryScene matches the geometric semantics and topology of the problem.
 */
export function validateGeometryTopology(
  problemText: string,
  scene?: GeometryScene
): GeometryValidationResult {
  const spec = extractGeometryConstraints(problemText);
  const errors: string[] = [];
  const warnings: string[] = [];

  const figureNameMap: Record<DetectedFigureType, string> = {
    isosceles_trapezoid: 'Hình thang cân',
    right_trapezoid: 'Hình thang vuông',
    trapezoid: 'Hình thang',
    rectangle: 'Hình chữ nhật',
    square: 'Hình vuông',
    rhombus: 'Hình thoi',
    parallelogram: 'Hình bình hành',
    quadrilateral: 'Tứ giác',
    equilateral_triangle: 'Tam giác đều',
    isosceles_triangle: 'Tam giác cân',
    right_triangle: 'Tam giác vuông',
    triangle: 'Tam giác',
    unknown: 'Hình học',
  };

  const figureName = figureNameMap[spec.figureType] || 'Hình học';

  if (!scene || !scene.points || scene.points.length === 0) {
    return {
      isValid: false,
      figureType: spec.figureType,
      figureName,
      expectedPoints: spec.mainVertices,
      actualPoints: [],
      missingPoints: spec.mainVertices,
      missingSegments: [],
      errors: ['Không có dữ liệu hình vẽ (geometryScene rỗng).'],
      warnings: [],
    };
  }

  const pointMap = new Map<string, GeometricPoint>();
  scene.points.forEach((p) => {
    if (p && p.name) pointMap.set(p.name.toUpperCase(), p);
    if (p && p.id) {
      const match = p.id.match(/point-([A-Z])/i);
      if (match) pointMap.set(match[1].toUpperCase(), p);
    }
  });

  const actualPoints = Array.from(pointMap.keys());

  // 1. Check Main Vertices
  const missingPoints: string[] = [];
  spec.mainVertices.forEach((v) => {
    if (!pointMap.has(v)) {
      missingPoints.push(v);
    }
  });

  if (missingPoints.length > 0) {
    errors.push(
      `Đề bài yêu cầu ${figureName} ${spec.mainVertices.join('')} nhưng hình vẽ thiếu đỉnh: ${missingPoints.join(', ')}.`
    );
  }

  // Critical topology check: A quadrilateral must NOT be rendered with only 3 points (like triangle ABC)
  const isQuad = [
    'isosceles_trapezoid',
    'right_trapezoid',
    'trapezoid',
    'rectangle',
    'square',
    'rhombus',
    'parallelogram',
    'quadrilateral',
  ].includes(spec.figureType);

  if (isQuad && spec.mainVertices.length === 4) {
    const quadVerticesPresent = spec.mainVertices.filter((v) => pointMap.has(v));
    if (quadVerticesPresent.length < 4) {
      errors.push(
        `Đề bài là tứ giác/hình thang 4 đỉnh (${spec.mainVertices.join('')}) nhưng hình hiện tại chỉ có ${quadVerticesPresent.length} đỉnh. Không được biến tứ giác thành tam giác.`
      );
    }
  }

  // 2. Check Boundary Segments
  const missingSegments: string[] = [];
  const segments = scene.segments || [];

  const hasSegmentBetween = (p1Name: string, p2Name: string): boolean => {
    const pt1 = pointMap.get(p1Name);
    const pt2 = pointMap.get(p2Name);
    if (!pt1 || !pt2) return false;

    // Direct segment
    const direct = segments.some(
      (s) =>
        (s.fromPointId === pt1.id && s.toPointId === pt2.id) ||
        (s.fromPointId === pt2.id && s.toPointId === pt1.id)
    );
    if (direct) return true;

    // Collinear subsegments on a line (e.g. CD formed by DH, HK, KC)
    return false;
  };

  // For main figure, check boundary sides
  if (spec.mainVertices.length >= 3) {
    for (let i = 0; i < spec.mainVertices.length; i++) {
      const v1 = spec.mainVertices[i];
      const v2 = spec.mainVertices[(i + 1) % spec.mainVertices.length];
      const segName = `${v1}${v2}`;

      // If both points exist, check if line connection exists (either direct or via intermediate points)
      if (pointMap.has(v1) && pointMap.has(v2)) {
        const direct = hasSegmentBetween(v1, v2);
        // If not direct, check if there are intermediate points on this segment
        const hasIntermediate = spec.pointsOnSegments.some(
          (pos) =>
            (pos.segment === segName || pos.segment === `${v2}${v1}`) &&
            hasSegmentBetween(v1, pos.point)
        );
        if (!direct && !hasIntermediate) {
          missingSegments.push(segName);
        }
      }
    }
  }

  if (missingSegments.length > 0) {
    warnings.push(`Hình vẽ có thể thiếu cạnh bao: ${missingSegments.join(', ')}.`);
  }

  // 3. Check Parallel Alignment (e.g. AB ∥ CD)
  spec.parallelPairs.forEach(([s1, s2]) => {
    const p1A = pointMap.get(s1[0]);
    const p1B = pointMap.get(s1[1]);
    const p2C = pointMap.get(s2[0]);
    const p2D = pointMap.get(s2[1]);

    if (p1A && p1B && p2C && p2D) {
      const v1 = { x: p1B.x - p1A.x, y: p1B.y - p1A.y };
      const v2 = { x: p2D.x - p2C.x, y: p2D.y - p2C.y };
      const len1 = Math.hypot(v1.x, v1.y) || 1;
      const len2 = Math.hypot(v2.x, v2.y) || 1;

      // 2D cross-product normalized: |v1.x*v2.y - v1.y*v2.x| / (|v1|*|v2|)
      const sinTheta = Math.abs(v1.x * v2.y - v1.y * v2.x) / (len1 * len2);
      if (sinTheta > 0.15) {
        errors.push(
          `Đoạn thẳng ${s1} và ${s2} không song song theo đúng giả thiết (${s1} ∥ ${s2}).`
        );
      }
    }
  });

  // 4. Check Length Inequality (e.g. AB < CD)
  spec.lengthComparisons.forEach(({ smaller, larger }) => {
    const pS1 = pointMap.get(smaller[0]);
    const pS2 = pointMap.get(smaller[1]);
    const pL1 = pointMap.get(larger[0]);
    const pL2 = pointMap.get(larger[1]);

    if (pS1 && pS2 && pL1 && pL2) {
      const lenS = Math.hypot(pS2.x - pS1.x, pS2.y - pS1.y);
      const lenL = Math.hypot(pL2.x - pL1.x, pL2.y - pL1.y);

      if (lenS >= lenL * 0.98) {
        errors.push(
          `Độ dài đoạn ${smaller} (${Math.round(lenS)}px) không nhỏ hơn đoạn ${larger} (${Math.round(lenL)}px) theo giả thiết (${smaller} < ${larger}).`
        );
      }
    }
  });

  // 5. Check Points Collinear On Segment (e.g. H, K ∈ CD)
  spec.pointsOnSegments.forEach(({ point: ptName, segment: segName }) => {
    const pt = pointMap.get(ptName);
    const pA = pointMap.get(segName[0]);
    const pB = pointMap.get(segName[1]);

    if (pt && pA && pB) {
      // Distance from pt to line AB
      const abLen = Math.hypot(pB.x - pA.x, pB.y - pA.y) || 1;
      const dist = Math.abs((pB.y - pA.y) * pt.x - (pB.x - pA.x) * pt.y + pB.x * pA.y - pB.y * pA.x) / abLen;
      if (dist > 12) {
        errors.push(`Điểm ${ptName} không nằm trên đoạn thẳng ${segName} (${ptName} ∉ ${segName}, sai lệch ${Math.round(dist)}px).`);
      }
    } else if (!pt) {
      errors.push(`Thiếu điểm ${ptName} thuộc đoạn ${segName}.`);
    }
  });

  // 6. Check Perpendiculars (e.g. AH ⟂ CD, BK ⟂ CD)
  spec.perpendiculars.forEach(({ line1, line2, footPoint }) => {
    const p1A = pointMap.get(line1[0]);
    const p1B = pointMap.get(line1[1]);
    const p2C = pointMap.get(line2[0]);
    const p2D = pointMap.get(line2[1]);

    if (p1A && p1B && p2C && p2D) {
      const v1 = { x: p1B.x - p1A.x, y: p1B.y - p1A.y };
      const v2 = { x: p2D.x - p2C.x, y: p2D.y - p2C.y };
      const len1 = Math.hypot(v1.x, v1.y) || 1;
      const len2 = Math.hypot(v2.x, v2.y) || 1;
      const cosTheta = Math.abs(v1.x * v2.x + v1.y * v2.y) / (len1 * len2);

      if (cosTheta > 0.18) {
        errors.push(`Đoạn ${line1} không vuông góc với ${line2} theo giả thiết (${line1} ⟂ ${line2}).`);
      }
    } else {
      if (!p1A || !p1B) missingPoints.push(line1);
    }
  });

  const isValid = errors.length === 0;

  return {
    isValid,
    figureType: spec.figureType,
    figureName,
    expectedPoints: spec.mainVertices,
    actualPoints,
    missingPoints: Array.from(new Set(missingPoints)),
    missingSegments,
    errors,
    warnings,
  };
}

/**
 * Deterministic, accurate geometry synthesizer for Middle School math problems.
 * Generates exact coordinates, boundary segments, altitudes, angle markers, and equal length ticks.
 */
export function generateAccurateGeometryScene(
  problemText: string,
  extraLabels?: string[]
): GeometryScene {
  const spec = extractGeometryConstraints(problemText);
  const points: GeometricPoint[] = [];
  const segments: GeometricSegment[] = [];
  const polygons: GeometricPolygon[] = [];
  const angleMarkers: GeometricAngleMarker[] = [];
  const equalLengthMarkers: GeometricEqualLengthMarker[] = [];
  const relations: GeometricRelation[] = [];

  const pointMap = new Map<string, GeometricPoint>();

  const addPoint = (name: string, x: number, y: number, color = '#38bdf8'): GeometricPoint => {
    const id = `point-${name}`;
    const pt: GeometricPoint = { id, name, x: Math.round(x), y: Math.round(y), color };
    points.push(pt);
    pointMap.set(name, pt);
    return pt;
  };

  const addSegment = (
    fromName: string,
    toName: string,
    options?: {
      strokeWidth?: number;
      style?: 'solid' | 'dashed' | 'dotted';
      color?: string;
      isHelper?: boolean;
      isAuxiliary?: boolean;
    }
  ): GeometricSegment | null => {
    const p1 = pointMap.get(fromName);
    const p2 = pointMap.get(toName);
    if (!p1 || !p2) return null;

    // Check if segment already exists in either direction
    const existing = segments.find(
      (s) =>
        (s.fromPointId === p1.id && s.toPointId === p2.id) ||
        (s.fromPointId === p2.id && s.toPointId === p1.id)
    );
    if (existing) return existing;

    const id = `segment-${fromName}${toName}`;
    const seg: GeometricSegment = {
      id,
      fromPointId: p1.id,
      toPointId: p2.id,
      strokeWidth: options?.strokeWidth || 2,
      style: options?.style || 'solid',
      color: options?.color,
      isHelper: options?.isHelper,
      isAuxiliary: options?.isAuxiliary,
    };
    segments.push(seg);
    return seg;
  };

  const addRightAngle = (vertexName: string, p1Name: string, p2Name: string, color = '#059669') => {
    const v = pointMap.get(vertexName);
    const p1 = pointMap.get(p1Name);
    const p2 = pointMap.get(p2Name);
    if (!v || !p1 || !p2) return;

    angleMarkers.push({
      id: `angle-${p1Name}${vertexName}${p2Name}`,
      vertexPointId: v.id,
      point1Id: p1.id,
      point2Id: p2.id,
      isRightAngle: true,
      color,
    });
  };

  // ==========================================
  // CASE 1: ISOSCELES TRAPEZOID (Hình thang cân ABCD, AB ∥ CD, AB < CD)
  // ==========================================
  if (spec.figureType === 'isosceles_trapezoid') {
    const [A, B, C, D] = spec.mainVertices.length === 4 ? spec.mainVertices : ['A', 'B', 'C', 'D'];

    // Top base AB horizontal at y = 95, length = 160 (x: 170 to 330)
    addPoint(A, 170, 95);
    addPoint(B, 330, 95);

    // Bottom base CD horizontal at y = 285, length = 310 (x: 95 to 405)
    addPoint(D, 95, 285);
    addPoint(C, 405, 285);

    // Trapezoid boundary segments
    addSegment(A, B);
    addSegment(B, C);
    addSegment(C, D);
    addSegment(D, A);

    // Polygon ABCD for boundary highlighting
    polygons.push({
      id: `polygon-${A}${B}${C}${D}`,
      pointIds: [`point-${A}`, `point-${B}`, `point-${C}`, `point-${D}`],
      fillColor: '#38bdf8',
      fillOpacity: 0.08,
      strokeColor: '#38bdf8',
      strokeWidth: 2,
    });

    relations.push({
      type: 'parallel',
      description: `${A}${B} song song với ${C}${D}`,
      targetIds: [`segment-${A}${B}`, `segment-${C}${D}`],
    });
    relations.push({
      type: 'equal_length',
      description: `Hình thang cân nên ${A}${D} = ${B}${C}`,
      targetIds: [`segment-${D}${A}`, `segment-${B}${C}`],
    });

    // Handle altitudes AH ⟂ CD, BK ⟂ CD
    // H has same x as A (170, 285), K has same x as B (330, 285)
    const hasAH = spec.perpendiculars.some((p) => p.line1.includes('A') && p.line1.includes('H'));
    const hasBK = spec.perpendiculars.some((p) => p.line1.includes('B') && p.line1.includes('K'));
    const hasH = spec.allMentionedPoints.includes('H') || hasAH;
    const hasK = spec.allMentionedPoints.includes('K') || hasBK;

    if (hasH) {
      addPoint('H', 170, 285, '#f59e0b');
      addSegment(A, 'H', { strokeWidth: 1.8, style: 'dashed', color: '#f59e0b', isAuxiliary: true });
      addRightAngle('H', A, D);
      // Subsegment helper for midpoint/equality ticks
      addSegment(D, 'H', { isHelper: true });
    }

    if (hasK) {
      addPoint('K', 330, 285, '#f59e0b');
      addSegment(B, 'K', { strokeWidth: 1.8, style: 'dashed', color: '#f59e0b', isAuxiliary: true });
      addRightAngle('K', B, C);
      // Subsegment helper for midpoint/equality ticks
      addSegment('K', C, { isHelper: true });
    }

    // Midpoint ticks or equality markers for DH = CK
    if (hasH && hasK) {
      equalLengthMarkers.push({
        id: 'equal-DH-KC',
        segmentIds: ['segment-DH', 'segment-KC'],
        ticksCount: 2,
        color: '#f59e0b',
      });
    }

    // Equal sides AD = BC ticks
    equalLengthMarkers.push({
      id: `equal-${D}${A}-${B}${C}`,
      segmentIds: [`segment-${D}${A}`, `segment-${B}${C}`],
      ticksCount: 1,
      color: '#38bdf8',
    });
  }

  // ==========================================
  // CASE 2: GENERAL OR RIGHT TRAPEZOID
  // ==========================================
  else if (spec.figureType === 'right_trapezoid') {
    const [A, B, C, D] = spec.mainVertices.length === 4 ? spec.mainVertices : ['A', 'B', 'C', 'D'];
    addPoint(A, 130, 95);
    addPoint(B, 330, 95);
    addPoint(D, 130, 285);
    addPoint(C, 410, 285);

    addSegment(A, B);
    addSegment(B, C);
    addSegment(C, D);
    addSegment(D, A);

    addRightAngle(A, B, D);
    addRightAngle(D, A, C);

    polygons.push({
      id: `polygon-${A}${B}${C}${D}`,
      pointIds: [`point-${A}`, `point-${B}`, `point-${C}`, `point-${D}`],
      fillColor: '#38bdf8',
      fillOpacity: 0.08,
    });
  } else if (spec.figureType === 'trapezoid') {
    const [A, B, C, D] = spec.mainVertices.length === 4 ? spec.mainVertices : ['A', 'B', 'C', 'D'];
    addPoint(A, 160, 95);
    addPoint(B, 320, 95);
    addPoint(D, 100, 285);
    addPoint(C, 420, 285);

    addSegment(A, B);
    addSegment(B, C);
    addSegment(C, D);
    addSegment(D, A);

    polygons.push({
      id: `polygon-${A}${B}${C}${D}`,
      pointIds: [`point-${A}`, `point-${B}`, `point-${C}`, `point-${D}`],
      fillColor: '#38bdf8',
      fillOpacity: 0.08,
    });
  }

  // ==========================================
  // CASE 3: RECTANGLE (Hình chữ nhật)
  // ==========================================
  else if (spec.figureType === 'rectangle') {
    const [A, B, C, D] = spec.mainVertices.length === 4 ? spec.mainVertices : ['A', 'B', 'C', 'D'];
    addPoint(A, 120, 95);
    addPoint(B, 380, 95);
    addPoint(C, 380, 285);
    addPoint(D, 120, 285);

    addSegment(A, B);
    addSegment(B, C);
    addSegment(C, D);
    addSegment(D, A);

    addRightAngle(A, B, D);
    addRightAngle(B, A, C);
    addRightAngle(C, B, D);
    addRightAngle(D, A, C);

    polygons.push({
      id: `polygon-${A}${B}${C}${D}`,
      pointIds: [`point-${A}`, `point-${B}`, `point-${C}`, `point-${D}`],
      fillColor: '#3b82f6',
      fillOpacity: 0.1,
    });
  }

  // ==========================================
  // CASE 4: SQUARE (Hình vuông)
  // ==========================================
  else if (spec.figureType === 'square') {
    const [A, B, C, D] = spec.mainVertices.length === 4 ? spec.mainVertices : ['A', 'B', 'C', 'D'];
    addPoint(A, 150, 90);
    addPoint(B, 350, 90);
    addPoint(C, 350, 290);
    addPoint(D, 150, 290);

    addSegment(A, B);
    addSegment(B, C);
    addSegment(C, D);
    addSegment(D, A);

    addRightAngle(A, B, D);
    addRightAngle(B, A, C);
    addRightAngle(C, B, D);
    addRightAngle(D, A, C);

    polygons.push({
      id: `polygon-${A}${B}${C}${D}`,
      pointIds: [`point-${A}`, `point-${B}`, `point-${C}`, `point-${D}`],
      fillColor: '#3b82f6',
      fillOpacity: 0.1,
    });
  }

  // ==========================================
  // CASE 5: PARALLELOGRAM (Hình bình hành)
  // ==========================================
  else if (spec.figureType === 'parallelogram') {
    const [A, B, C, D] = spec.mainVertices.length === 4 ? spec.mainVertices : ['A', 'B', 'C', 'D'];
    addPoint(A, 170, 95);
    addPoint(B, 390, 95);
    addPoint(C, 330, 285);
    addPoint(D, 110, 285);

    addSegment(A, B);
    addSegment(B, C);
    addSegment(C, D);
    addSegment(D, A);

    polygons.push({
      id: `polygon-${A}${B}${C}${D}`,
      pointIds: [`point-${A}`, `point-${B}`, `point-${C}`, `point-${D}`],
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
    });
  }

  // ==========================================
  // CASE 6: RHOMBUS (Hình thoi)
  // ==========================================
  else if (spec.figureType === 'rhombus') {
    const [A, B, C, D] = spec.mainVertices.length === 4 ? spec.mainVertices : ['A', 'B', 'C', 'D'];
    addPoint(A, 250, 70);
    addPoint(B, 390, 190);
    addPoint(C, 250, 310);
    addPoint(D, 110, 190);

    addSegment(A, B);
    addSegment(B, C);
    addSegment(C, D);
    addSegment(D, A);

    polygons.push({
      id: `polygon-${A}${B}${C}${D}`,
      pointIds: [`point-${A}`, `point-${B}`, `point-${C}`, `point-${D}`],
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
    });
  }

  // ==========================================
  // CASE 7: ISOSCELES TRIANGLE (Tam giác cân)
  // ==========================================
  else if (spec.figureType === 'isosceles_triangle') {
    const [A, B, C] = spec.mainVertices.length === 3 ? spec.mainVertices : ['A', 'B', 'C'];
    addPoint(A, 250, 70);
    addPoint(B, 110, 290);
    addPoint(C, 390, 290);

    addSegment(A, B);
    addSegment(A, C);
    addSegment(B, C);

    // Altitude AH if H mentioned
    if (spec.allMentionedPoints.includes('H') || spec.perpendiculars.some((p) => p.line1.includes('H'))) {
      addPoint('H', 250, 290, '#06b6d4');
      addSegment(A, 'H', { strokeWidth: 1.8, style: 'dashed', color: '#06b6d4' });
      addRightAngle('H', A, B);
    }

    // Midpoint I if I mentioned
    if (spec.allMentionedPoints.includes('I') || spec.midpoints.some((m) => m.point === 'I')) {
      addPoint('I', 180, 180, '#f59e0b');
    }

    equalLengthMarkers.push({
      id: `equal-${A}${B}-${A}${C}`,
      segmentIds: [`segment-${A}${B}`, `segment-${A}${C}`],
      ticksCount: 1,
      color: '#38bdf8',
    });
  }

  // ==========================================
  // CASE 8: RIGHT TRIANGLE (Tam giác vuông)
  // ==========================================
  else if (spec.figureType === 'right_triangle') {
    const [A, B, C] = spec.mainVertices.length === 3 ? spec.mainVertices : ['A', 'B', 'C'];
    addPoint(A, 130, 290);
    addPoint(B, 130, 90);
    addPoint(C, 400, 290);

    addSegment(A, B);
    addSegment(A, C);
    addSegment(B, C);
    addRightAngle(A, B, C);
  }

  // ==========================================
  // CASE 9: EQUILATERAL OR GENERAL TRIANGLE
  // ==========================================
  else if (spec.figureType === 'equilateral_triangle') {
    const [A, B, C] = spec.mainVertices.length === 3 ? spec.mainVertices : ['A', 'B', 'C'];
    addPoint(A, 250, 70);
    addPoint(B, 110, 312);
    addPoint(C, 390, 312);

    addSegment(A, B);
    addSegment(B, C);
    addSegment(A, C);
  } else {
    // General triangle ABC or fallback
    const [A, B, C] = spec.mainVertices.length >= 3 ? spec.mainVertices : ['A', 'B', 'C'];
    addPoint(A, 220, 80);
    addPoint(B, 110, 290);
    addPoint(C, 400, 290);

    addSegment(A, B);
    addSegment(B, C);
    addSegment(A, C);
  }

  // Add any explicitly mentioned additional perpendiculars or midpoints that weren't covered
  spec.perpendiculars.forEach(({ line1, line2, footPoint }) => {
    if (footPoint && !pointMap.has(footPoint)) {
      // Find point to drop perpendicular from
      const fromPtName = line1[0] === footPoint ? line1[1] : line1[0];
      const fromPt = pointMap.get(fromPtName);
      const lineP1 = pointMap.get(line2[0]);
      const lineP2 = pointMap.get(line2[1]);

      if (fromPt && lineP1 && lineP2) {
        // Project fromPt onto lineP1-lineP2
        const dx = lineP2.x - lineP1.x;
        const dy = lineP2.y - lineP1.y;
        const lenSq = dx * dx + dy * dy || 1;
        const t = ((fromPt.x - lineP1.x) * dx + (fromPt.y - lineP1.y) * dy) / lenSq;
        const footX = lineP1.x + t * dx;
        const footY = lineP1.y + t * dy;

        addPoint(footPoint, footX, footY, '#f59e0b');
        addSegment(fromPtName, footPoint, { strokeWidth: 1.8, style: 'dashed', color: '#f59e0b' });
        addRightAngle(footPoint, fromPtName, line2[0]);
      }
    }
  });

  // Add any explicitly mentioned midpoints
  spec.midpoints.forEach(({ point: ptName, segment: segName }) => {
    if (!pointMap.has(ptName)) {
      const p1 = pointMap.get(segName[0]);
      const p2 = pointMap.get(segName[1]);
      if (p1 && p2) {
        addPoint(ptName, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, '#ec4899');
      }
    }
  });

  return {
    viewBox: { width: 500, height: 360 },
    points,
    segments,
    polygons,
    angleMarkers,
    equalLengthMarkers,
    relations,
  };
}

/**
 * Normalizes raw geometryScene JSON from AI into standard GeometryScene format.
 * Fixes varied field names (label, p1/p2, start/end, etc.).
 * If the scene is missing or topologically invalid, automatically repairs it using generateAccurateGeometryScene.
 */
export function normalizeGeometryScene(
  rawScene: any,
  problemText: string,
  extraLabels?: string[]
): GeometryScene {
  if (!rawScene || typeof rawScene !== 'object') {
    return generateAccurateGeometryScene(problemText, extraLabels);
  }

  const rawPoints = Array.isArray(rawScene.points) ? rawScene.points : [];
  const points: GeometricPoint[] = [];
  const pointNameMap = new Map<string, GeometricPoint>();

  rawPoints.forEach((p: any, idx: number) => {
    if (!p) return;
    const nameMatch = (p.name || p.label || p.id || '').toString().match(/[A-Z]/i);
    const name = nameMatch ? nameMatch[0].toUpperCase() : String.fromCharCode(65 + idx);
    const id = `point-${name}`;
    const x = typeof p.x === 'number' && !isNaN(p.x) ? Math.round(p.x) : 100 + idx * 50;
    const y = typeof p.y === 'number' && !isNaN(p.y) ? Math.round(p.y) : 100 + idx * 40;
    const color = p.color || '#38bdf8';
    const pt: GeometricPoint = { id, name, x, y, color };
    points.push(pt);
    pointNameMap.set(name, pt);
  });

  const rawSegments = Array.isArray(rawScene.segments) ? rawScene.segments : [];
  const segments: GeometricSegment[] = [];

  rawSegments.forEach((s: any) => {
    if (!s) return;
    // Extract endpoint names
    const fromNameMatch = (s.fromPointId || s.p1 || s.start || s.from || '').toString().match(/[A-Z]/i);
    const toNameMatch = (s.toPointId || s.p2 || s.end || s.to || '').toString().match(/[A-Z]/i);
    if (!fromNameMatch || !toNameMatch) return;
    const fromName = fromNameMatch[0].toUpperCase();
    const toName = toNameMatch[0].toUpperCase();
    if (fromName === toName) return;

    const fromPt = pointNameMap.get(fromName);
    const toPt = pointNameMap.get(toName);
    if (!fromPt || !toPt) return;

    const segId = `segment-${fromName}${toName}`;
    const reverseSegId = `segment-${toName}${fromName}`;
    if (segments.some((existing) => existing.id === segId || existing.id === reverseSegId)) return;

    segments.push({
      id: segId,
      fromPointId: fromPt.id,
      toPointId: toPt.id,
      strokeWidth: s.strokeWidth || 2,
      style: s.style === 'dashed' || s.isAuxiliary ? 'dashed' : 'solid',
      color: s.color,
      isAuxiliary: Boolean(s.isAuxiliary || s.style === 'dashed'),
      isHelper: Boolean(s.isHelper),
    });
  });

  const rawPolygons = Array.isArray(rawScene.polygons) ? rawScene.polygons : [];
  const polygons: GeometricPolygon[] = [];

  rawPolygons.forEach((poly: any, idx: number) => {
    if (!poly) return;
    let pointLetters: string[] = [];
    if (typeof poly === 'string') {
      pointLetters = poly.replace(/[^A-Za-z]/g, '').toUpperCase().split('');
    } else if (Array.isArray(poly.pointIds)) {
      pointLetters = poly.pointIds.map((id: string) => {
        const m = id.toString().match(/[A-Z]/i);
        return m ? m[0].toUpperCase() : '';
      }).filter(Boolean);
    } else if (Array.isArray(poly.points)) {
      pointLetters = poly.points.map((p: any) => {
        const m = (typeof p === 'string' ? p : p.name || p.label || p.id || '').toString().match(/[A-Z]/i);
        return m ? m[0].toUpperCase() : '';
      }).filter(Boolean);
    }

    const validPointIds = pointLetters
      .map((l) => pointNameMap.get(l)?.id)
      .filter((id): id is string => Boolean(id));

    if (validPointIds.length >= 3) {
      polygons.push({
        id: poly.id || `polygon-${pointLetters.join('')}`,
        pointIds: validPointIds,
        fillColor: poly.fillColor || '#38bdf8',
        fillOpacity: typeof poly.fillOpacity === 'number' ? poly.fillOpacity : 0.08,
        strokeColor: poly.strokeColor || '#38bdf8',
        strokeWidth: poly.strokeWidth || 2,
      });
    }
  });

  const rawAngleMarkers = Array.isArray(rawScene.angleMarkers) ? rawScene.angleMarkers : [];
  const angleMarkers: GeometricAngleMarker[] = [];

  rawAngleMarkers.forEach((am: any, idx: number) => {
    if (!am) return;
    const vertexLetter = (am.vertexPointId || am.point || am.vertex || '').toString().match(/[A-Z]/i)?.[0]?.toUpperCase();
    if (!vertexLetter || !pointNameMap.has(vertexLetter)) return;
    const vertexPt = pointNameMap.get(vertexLetter)!;

    const p1Letter = (am.point1Id || am.p1 || am.side1 || '').toString().match(/[A-Z]/i)?.[0]?.toUpperCase();
    const p2Letter = (am.point2Id || am.p2 || am.side2 || '').toString().match(/[A-Z]/i)?.[0]?.toUpperCase();

    angleMarkers.push({
      id: am.id || `angle-${p1Letter || ''}${vertexLetter}${p2Letter || ''}-${idx}`,
      vertexPointId: vertexPt.id,
      point1Id: p1Letter && pointNameMap.has(p1Letter) ? pointNameMap.get(p1Letter)!.id : vertexPt.id,
      point2Id: p2Letter && pointNameMap.has(p2Letter) ? pointNameMap.get(p2Letter)!.id : vertexPt.id,
      isRightAngle: am.isRightAngle ?? (am.angle === 90 || am.type === 'right' || true),
      color: am.color || '#059669',
    });
  });

  const rawEqualMarkers = Array.isArray(rawScene.equalLengthMarkers) ? rawScene.equalLengthMarkers : [];
  const equalLengthMarkers: GeometricEqualLengthMarker[] = [];

  rawEqualMarkers.forEach((em: any, idx: number) => {
    if (!em) return;
    const segIds: string[] = [];
    if (Array.isArray(em.segmentIds)) {
      em.segmentIds.forEach((id: string) => segIds.push(String(id)));
    } else if (Array.isArray(em.segments)) {
      em.segments.forEach((s: any) => {
        if (typeof s === 'string' && s.length >= 2) {
          const l1 = s[0].toUpperCase();
          const l2 = s[1].toUpperCase();
          segIds.push(`segment-${l1}${l2}`);
        }
      });
    }

    if (segIds.length > 0) {
      equalLengthMarkers.push({
        id: em.id || `equal-marker-${idx}`,
        segmentIds: segIds,
        ticksCount: em.ticksCount || (em.type === 'double' ? 2 : 1),
        color: em.color || '#38bdf8',
      });
    }
  });

  const normalizedScene: GeometryScene = {
    viewBox: {
      width: rawScene.viewBox?.width || 500,
      height: rawScene.viewBox?.height || 360,
    },
    points,
    segments,
    polygons,
    angleMarkers,
    equalLengthMarkers,
    relations: rawScene.relations || [],
  };

  // Run Semantic Validation on normalized scene
  const validation = validateGeometryTopology(problemText, normalizedScene);
  if (!validation.isValid) {
    // If invalid (e.g. quad turned into triangle or missing required vertices), synthesize accurate scene
    return generateAccurateGeometryScene(problemText, extraLabels);
  }

  return normalizedScene;
}

/**
 * Orchestrates step-by-step pedagogical geometry reveal:
 * - Step 1: Only initial problem hypothesis figure (e.g. trapezoid ABCD with main sides AD = BC).
 * - Step 2: Draws auxiliary lines/altitudes (AH ⟂ CD, BK ⟂ CD, right angles at H, K).
 * - Step 3+: Mathematical deduction and highlights the triangles or segments under analysis.
 */
export function orchestrateGeometrySteps(
  scene: GeometryScene,
  steps: LessonStep[],
  problemText: string
): LessonStep[] {
  if (!scene || !scene.points || scene.points.length === 0 || !steps || steps.length === 0) {
    return steps;
  }

  const spec = extractGeometryConstraints(problemText);
  const mainVertexSet = new Set<string>(spec.mainVertices);

  // If spec.mainVertices is empty, infer main vertices as the first 3 or 4 points
  if (mainVertexSet.size === 0) {
    const count = scene.points.length >= 4 ? 4 : Math.min(scene.points.length, 3);
    for (let i = 0; i < count; i++) {
      if (scene.points[i]) mainVertexSet.add(scene.points[i].name.toUpperCase());
    }
  }

  // Base IDs: main vertices & boundary segments between main vertices
  const basePointIds = scene.points
    .filter((p) => mainVertexSet.has(p.name.toUpperCase()))
    .map((p) => p.id);

  const baseSegmentIds = scene.segments
    .filter((s) => {
      const p1 = scene.points.find((p) => p.id === s.fromPointId);
      const p2 = scene.points.find((p) => p.id === s.toPointId);
      return (
        p1 &&
        p2 &&
        mainVertexSet.has(p1.name.toUpperCase()) &&
        mainVertexSet.has(p2.name.toUpperCase()) &&
        !s.isAuxiliary
      );
    })
    .map((s) => s.id);

  const polygons = scene.polygons || [];
  const angleMarkers = scene.angleMarkers || [];
  const equalLengthMarkers = scene.equalLengthMarkers || [];
  const points = scene.points || [];
  const segments = scene.segments || [];

  const basePolygonIds = polygons
    .filter((poly) => {
      return poly.pointIds.every((pid) => basePointIds.includes(pid));
    })
    .map((poly) => poly.id);

  // Base markers: equal length markers between main boundary segments
  const baseEqualMarkerIds = equalLengthMarkers
    .filter((m) => m.segmentIds.some((sid) => baseSegmentIds.includes(sid)))
    .map((m) => m.id);

  // Auxiliary IDs: all other points, segments, angle markers, and auxiliary equal length markers
  const auxPointIds = points
    .filter((p) => !mainVertexSet.has(p.name.toUpperCase()))
    .map((p) => p.id);

  const auxSegmentIds = segments
    .filter((s) => !baseSegmentIds.includes(s.id))
    .map((s) => s.id);

  const angleMarkerIds = angleMarkers.map((a) => a.id);

  const auxEqualMarkerIds = equalLengthMarkers
    .filter((m) => !baseEqualMarkerIds.includes(m.id))
    .map((m) => m.id);

  const hasAuxiliary = auxPointIds.length > 0 || auxSegmentIds.length > 0;

  // Step 1: Base figure only
  const step1VisibleIds = [
    ...basePointIds,
    ...baseSegmentIds,
    ...basePolygonIds,
    ...baseEqualMarkerIds,
  ];

  // Step 2: Base figure + Auxiliary figure
  const step2VisibleIds = [
    ...step1VisibleIds,
    ...auxPointIds,
    ...auxSegmentIds,
    ...angleMarkerIds,
    ...auxEqualMarkerIds,
  ];

  // All objects in the scene
  const allSceneObjectIds = [
    ...points.map((p) => p.id),
    ...segments.map((s) => s.id),
    ...polygons.map((p) => p.id),
    ...angleMarkers.map((a) => a.id),
    ...equalLengthMarkers.map((m) => m.id),
  ];

  return steps.map((st, idx) => {
    // 1. Determine Visible Objects
    let visibleObjectIds: string[];
    if (idx === 0) {
      visibleObjectIds = hasAuxiliary ? step1VisibleIds : allSceneObjectIds;
    } else if (idx === 1 && hasAuxiliary) {
      visibleObjectIds = step2VisibleIds;
    } else {
      visibleObjectIds = allSceneObjectIds;
    }

    // 2. Determine Highlighted Objects based on step content
    const stepText = `${st.title || ''} ${st.narration || ''} ${st.boardText || ''} ${st.displayText || ''} ${(st.latexLines || []).join(' ')} ${st.boardMath || ''} ${st.latex || ''}`.toUpperCase();

    const highlightedIds: string[] = [];

    // If step 2 introduced auxiliary items (AH, BK, H, K), highlight auxiliary segments
    if (idx === 1 && hasAuxiliary && (stepText.includes('KẺ') || stepText.includes('ĐƯỜNG CAO') || stepText.includes('VUÔNG GÓC') || stepText.includes('H, K') || stepText.includes('TRUNG ĐIỂM'))) {
      auxSegmentIds.forEach((sid) => highlightedIds.push(sid));
    } else {
      // Highlight segments or points explicitly mentioned in this step
      segments.forEach((s) => {
        const p1 = points.find((p) => p.id === s.fromPointId)?.name;
        const p2 = points.find((p) => p.id === s.toPointId)?.name;
        if (p1 && p2) {
          const segName1 = `${p1}${p2}`.toUpperCase();
          const segName2 = `${p2}${p1}`.toUpperCase();
          if (stepText.includes(segName1) || stepText.includes(segName2)) {
            highlightedIds.push(s.id);
          }
        }
      });

      // Highlight triangles / polygons mentioned (e.g. AHD, BKC)
      polygons.forEach((poly) => {
        const polyName = poly.pointIds
          .map((pid) => points.find((p) => p.id === pid)?.name || '')
          .join('')
          .toUpperCase();
        if (polyName && stepText.includes(polyName)) {
          highlightedIds.push(poly.id);
        }
      });

      // Highlight equal length markers mentioned in conclusion
      if (st.type === 'conclusion' || idx === steps.length - 1 || stepText.includes('KẾT LUẬN')) {
        spec.equalSegments.forEach(([s1, s2]) => {
          if (stepText.includes(s1) && stepText.includes(s2)) {
            equalLengthMarkers.forEach((em) => highlightedIds.push(em.id));
          }
        });
      }
    }

    return {
      ...st,
      visibleObjectIds,
      highlightedObjectIds: highlightedIds.length > 0 ? Array.from(new Set(highlightedIds)) : undefined,
    };
  });
}
