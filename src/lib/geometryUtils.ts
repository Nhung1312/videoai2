import {
  GeometricPoint,
  GeometricSegment,
  GeometricAngleMarker,
  GeometricEqualLengthMarker,
} from '../types/lesson';

export type LabelDirection =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

interface Vector2D {
  x: number;
  y: number;
}

const DIRECTION_VECTORS: Record<LabelDirection, Vector2D> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  'top-left': { x: -0.7071, y: -0.7071 },
  'top-right': { x: 0.7071, y: -0.7071 },
  'bottom-left': { x: -0.7071, y: 0.7071 },
  'bottom-right': { x: 0.7071, y: 0.7071 },
};

const ALL_DIRECTIONS: LabelDirection[] = [
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/**
 * Calculates perpendicular distance from a point P to a line segment AB.
 */
function distancePointToSegment(p: Vector2D, a: Vector2D, b: Vector2D): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projection = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  };
  return Math.hypot(p.x - projection.x, p.y - projection.y);
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectOverlap(r1: Rect, r2: Rect): boolean {
  return !(
    r1.right < r2.left ||
    r1.left > r2.right ||
    r1.bottom < r2.top ||
    r1.top > r2.bottom
  );
}

/**
 * Auto Label Placement algorithm with 8-direction test and collision scoring.
 * Works dynamically across animation states.
 */
export function computeAutoLabelPositions(
  points: GeometricPoint[] = [],
  segments: GeometricSegment[] = [],
  angleMarkers: GeometricAngleMarker[] = [],
  equalMarkers: GeometricEqualLengthMarker[] = [],
  viewBox: { width: number; height: number } = { width: 500, height: 400 },
  visibleIds?: Set<string>
): Map<string, { offset: Vector2D; direction: LabelDirection }> {
  const result = new Map<string, { offset: Vector2D; direction: LabelDirection }>();
  const safePoints = points || [];
  const safeSegments = segments || [];
  const safeEqualMarkers = equalMarkers || [];
  const safeViewBox = viewBox || { width: 500, height: 400 };

  const pointMap = new Map<string, GeometricPoint>();
  safePoints.forEach((p) => {
    if (p && p.id) pointMap.set(p.id, p);
  });

  // Filter to currently visible geometry if provided
  const activePoints = safePoints.filter((p) => p && (!visibleIds || visibleIds.has(p.id)));
  const activeSegments = safeSegments.filter((s) => s && (!visibleIds || visibleIds.has(s.id)));

  const placedLabelRects: Rect[] = [];

  // Calculate midpoint centers of all active equal markers to prevent collision with tick marks
  const tickCenters: Vector2D[] = [];
  for (const em of safeEqualMarkers) {
    if (!em) continue;
    if (visibleIds && !visibleIds.has(em.id)) continue;
    const segIds = em.segmentIds || (em as any).segments;
    if (!segIds || !Array.isArray(segIds)) continue;
    for (const segId of segIds) {
      const seg = safeSegments.find((s) => s && s.id === segId);
      if (!seg) continue;
      const p1 = pointMap.get(seg.fromPointId);
      const p2 = pointMap.get(seg.toPointId);
      if (p1 && p2) {
        tickCenters.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
      }
    }
  }

  for (const point of activePoints) {
    if (!point) continue;
    if (point.labelPosition === 'custom' && point.labelOffset) {
      result.set(point.id, {
        offset: point.labelOffset,
        direction: 'right',
      });
      continue;
    }

    // Connected segments to this point
    const connectedSegments = activeSegments.filter(
      (s) => s && (s.fromPointId === point.id || s.toPointId === point.id)
    );

    // Compute incident directions of connected segments
    const incidentVectors: Vector2D[] = connectedSegments.map((s) => {
      const otherId = s.fromPointId === point.id ? s.toPointId : s.fromPointId;
      const other = pointMap.get(otherId);
      if (!other) return { x: 0, y: 0 };
      const dx = other.x - point.x;
      const dy = other.y - point.y;
      const dist = Math.hypot(dx, dy) || 1;
      return { x: dx / dist, y: dy / dist };
    });

    let bestScore = Infinity;
    let bestDirection: LabelDirection = 'top';
    let bestOffset: Vector2D = { x: 0, y: -20 };

    // Points with >= 3 connected segments or intersecting lines (e.g. point I) get higher clearance
    const isIntersectionPoint = (connectedSegments?.length || 0) >= 3;
    const distanceTiers = isIntersectionPoint ? [24, 30, 38] : [18, 26, 34];

    const pointName = point.name || point.id || '';
    const labelWidth = Math.max(18, (pointName ? pointName.length : 1) * 12);
    const labelHeight = 18;

    for (const baseDist of distanceTiers) {
      let foundViableInTier = false;

      for (const dir of ALL_DIRECTIONS) {
        const v = DIRECTION_VECTORS[dir];
        const labelCenter = {
          x: point.x + v.x * baseDist,
          y: point.y + v.y * baseDist,
        };

        const labelRect: Rect = {
          left: labelCenter.x - labelWidth / 2,
          right: labelCenter.x + labelWidth / 2,
          top: labelCenter.y - labelHeight / 2,
          bottom: labelCenter.y + labelHeight / 2,
        };

        let score = 0;

        // 1. Boundary check
        if (
          labelRect.left < 10 ||
          labelRect.right > safeViewBox.width - 10 ||
          labelRect.top < 10 ||
          labelRect.bottom > safeViewBox.height - 10
        ) {
          score += 1500;
        }

        // 2. Overlap with other points
        for (const other of activePoints) {
          if (other.id === point.id) continue;
          const distToOther = Math.hypot(
            labelCenter.x - other.x,
            labelCenter.y - other.y
          );
          if (distToOther < 22) {
            score += 900 / (distToOther + 1);
          }
        }

        // 3. Collision with segments (connected or non-connected)
        for (const seg of activeSegments) {
          const p1 = pointMap.get(seg.fromPointId);
          const p2 = pointMap.get(seg.toPointId);
          if (!p1 || !p2) continue;

          const isConnected =
            seg.fromPointId === point.id || seg.toPointId === point.id;
          const dist = distancePointToSegment(labelCenter, p1, p2);

          if (isConnected) {
            if (dist < 14) {
              score += 450;
            }
          } else {
            if (dist < 16) {
              score += 1200 / (dist + 1);
            }
          }
        }

        // 4. Collision with midpoint ticks
        for (const tc of tickCenters) {
          const distToTick = Math.hypot(labelCenter.x - tc.x, labelCenter.y - tc.y);
          if (distToTick < 16) {
            score += 1000 / (distToTick + 1);
          }
        }

        // 5. Overlap with existing placed labels
        for (const placed of placedLabelRects) {
          if (rectOverlap(labelRect, placed)) {
            score += 1800;
          }
        }

        // 6. Angular penalty: avoid pointing directly along connected edges
        for (const inc of incidentVectors) {
          const dot = v.x * inc.x + v.y * inc.y;
          if (dot > 0.15) {
            score += 350 * dot;
          }
        }

        // 7. Special bonus for point I (between crossing lines):
        // Direction 'left' or 'top' gives wide open clearance
        if (point.name === 'I') {
          if (dir === 'left' || dir === 'top-left') {
            score -= 100;
          }
        }

        // Tier penalty to keep labels compact when possible
        score += (baseDist - 18) * 2;

        if (score < bestScore) {
          bestScore = score;
          bestDirection = dir;
          bestOffset = { x: v.x * baseDist, y: v.y * baseDist };
        }

        if (score < 80) {
          foundViableInTier = true;
        }
      }

      if (foundViableInTier) {
        break;
      }
    }

    result.set(point.id, {
      offset: bestOffset,
      direction: bestDirection,
    });

    // Record chosen label rect
    const finalCenter = {
      x: point.x + bestOffset.x,
      y: point.y + bestOffset.y,
    };
    placedLabelRects.push({
      left: finalCenter.x - 12,
      right: finalCenter.x + 12,
      top: finalCenter.y - 12,
      bottom: finalCenter.y + 12,
    });
  }

  return result;
}

/**
 * Generates an SVG path for a standard right-angle square marker.
 */
export function generateRightAnglePath(
  v: Vector2D,
  p1: Vector2D,
  p2: Vector2D,
  size = 14
): string {
  const d1 = Math.hypot(p1.x - v.x, p1.y - v.y) || 1;
  const d2 = Math.hypot(p2.x - v.x, p2.y - v.y) || 1;

  const u1 = { x: (p1.x - v.x) / d1, y: (p1.y - v.y) / d1 };
  const u2 = { x: (p2.x - v.x) / d2, y: (p2.y - v.y) / d2 };

  const a = { x: v.x + u1.x * size, y: v.y + u1.y * size };
  const b = { x: v.x + u1.x * size + u2.x * size, y: v.y + u1.y * size + u2.y * size };
  const c = { x: v.x + u2.x * size, y: v.y + u2.y * size };

  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)} L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
}

export interface TickLineSegment {
  p1: Vector2D;
  p2: Vector2D;
}

/**
 * Computes generic tick mark line segments for equal-length markers on a segment AB.
 * Strictly derives perpendicular normal from segment vector:
 * - tick is strictly perpendicular to the segment (u . n === 0)
 * - markerCount = 1 -> exactly 1 tick
 * - markerCount = 2 -> exactly 2 ticks
 * - markerCount = 3 -> exactly 3 ticks
 * - uniform spacing and size across the group
 * - avoids endpoints, intermediate points on the segment (e.g. midpoints) and labels
 * - symmetric anchor when segments share a vertex (e.g. vertex A for AB and AC in an isosceles triangle)
 */
export function computeEqualLengthTicks(
  a: Vector2D,
  b: Vector2D,
  ticksCount = 1,
  tickLength = 11,
  avoidPoints: Vector2D[] = [],
  sharedVertexAnchor?: Vector2D
): TickLineSegment[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  const n = { x: -u.y, y: u.x }; // Exact perpendicular unit normal

  // Orient segment from shared vertex anchor if provided so t is symmetric across group
  let origin = a;
  let dir = u;
  if (sharedVertexAnchor) {
    const distToA = Math.hypot(a.x - sharedVertexAnchor.x, a.y - sharedVertexAnchor.y);
    const distToB = Math.hypot(b.x - sharedVertexAnchor.x, b.y - sharedVertexAnchor.y);
    if (distToB < distToA && distToB < 4) {
      origin = b;
      dir = { x: -u.x, y: -u.y };
    }
  }

  // Candidates along segment: maintain safety margin away from endpoints [0.25, 0.75]
  const candidates = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65];
  let bestT = 0.5;
  let maxClearance = -1;

  for (const t of candidates) {
    const cand = { x: origin.x + dir.x * d * t, y: origin.y + dir.y * d * t };
    let clearance = 9999;
    for (const p of avoidPoints) {
      // Don't count the endpoints of this segment itself in distance check
      const distToA = Math.hypot(p.x - a.x, p.y - a.y);
      const distToB = Math.hypot(p.x - b.x, p.y - b.y);
      if (distToA < 2 || distToB < 2) continue;

      const dist = Math.hypot(cand.x - p.x, cand.y - p.y);
      if (dist < clearance) clearance = dist;
    }

    if (clearance > 22) {
      bestT = t;
      break;
    }
    if (clearance > maxClearance) {
      maxClearance = clearance;
      bestT = t;
    }
  }

  const centerPoint = { x: origin.x + dir.x * d * bestT, y: origin.y + dir.y * d * bestT };
  const spacing = 4.5;
  const startOffset = -((ticksCount - 1) * spacing) / 2;
  const halfLen = tickLength / 2;

  const ticks: TickLineSegment[] = [];
  for (let i = 0; i < ticksCount; i++) {
    const offset = startOffset + i * spacing;
    const tickCenter = { x: centerPoint.x + dir.x * offset, y: centerPoint.y + dir.y * offset };
    ticks.push({
      p1: { x: tickCenter.x + n.x * halfLen, y: tickCenter.y + n.y * halfLen },
      p2: { x: tickCenter.x - n.x * halfLen, y: tickCenter.y - n.y * halfLen },
    });
  }

  return ticks;
}

/**
 * Generates SVG path for equal length tick marks on a segment AB.
 */
export function generateMidpointTicks(
  a: Vector2D,
  b: Vector2D,
  ticksCount = 1,
  tickLength = 11,
  avoidPoints: Vector2D[] = [],
  sharedVertexAnchor?: Vector2D
): string {
  const ticks = computeEqualLengthTicks(
    a,
    b,
    ticksCount,
    tickLength,
    avoidPoints,
    sharedVertexAnchor
  );
  return ticks
    .map(
      (t) =>
        `M ${t.p1.x.toFixed(1)} ${t.p1.y.toFixed(1)} L ${t.p2.x.toFixed(1)} ${t.p2.y.toFixed(1)}`
    )
    .join(' ');
}
