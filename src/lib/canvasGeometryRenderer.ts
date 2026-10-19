/**
 * Canvas Geometry Renderer
 * Accurately draws the geometry diagram (polygons, segments, animations,
 * angle markers, equal ticks, points, auto-placed labels) onto Canvas 2D.
 */

import {
  GeometryScene,
  GeometricPoint,
  LessonStep,
} from '../types/lesson';
import {
  computeAutoLabelPositions,
  computeEqualLengthTicks,
} from './geometryUtils';

export interface GeometryRenderBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function drawGeometryOnCanvas(
  ctx: CanvasRenderingContext2D,
  scene: GeometryScene,
  currentStep: LessonStep | undefined,
  stepProgress: number,
  stepEffectiveDuration: number,
  box: GeometryRenderBox
) {
  if (!scene || !scene.points || scene.points.length === 0) return;

  const points = scene.points || [];
  const segments = scene.segments || [];
  const polygons = scene.polygons || [];
  const angleMarkers = scene.angleMarkers || [];
  const equalLengthMarkers = scene.equalLengthMarkers || [];
  const vbWidth = scene.viewBox?.width || 500;
  const vbHeight = scene.viewBox?.height || 360;

  // Compute uniform scaling to fit inside box with padding
  const padding = 20;
  const availW = box.width - padding * 2;
  const availH = box.height - padding * 2;
  const scale = Math.min(availW / vbWidth, availH / vbHeight);

  const offsetX = box.x + padding + (availW - vbWidth * scale) / 2;
  const offsetY = box.y + padding + (availH - vbHeight * scale) / 2;

  const toCanvas = (vx: number, vy: number) => ({
    x: offsetX + vx * scale,
    y: offsetY + vy * scale,
  });

  // Determine visible and highlighted IDs
  const visibleIds = new Set<string>(
    currentStep?.visibleObjectIds ||
      points
        .filter(Boolean)
        .map((p) => p.id)
         .concat(segments.filter(Boolean).map((s) => s.id))
        .concat(polygons.filter(Boolean).map((p) => p.id))
        .concat(angleMarkers.filter(Boolean).map((a) => a.id))
        .concat(equalLengthMarkers.filter(Boolean).map((m) => m.id))
  );
  const highlightedIds = new Set<string>(currentStep?.highlightedObjectIds || []);

  const pointMap = new Map<string, GeometricPoint>();
  points.forEach((p) => pointMap.set(p.id, p));

  // Auto labels
  const autoLabels = computeAutoLabelPositions(
    points,
    segments,
    angleMarkers,
    equalLengthMarkers,
    { width: vbWidth, height: vbHeight },
    visibleIds
  );

  // Helper to determine draw progress for animated objects
  const getActionProgress = (targetId: string): { isVisible: boolean; progress: number } => {
    if (!visibleIds.has(targetId)) return { isVisible: false, progress: 0 };
    if (!currentStep || !currentStep.actions) return { isVisible: true, progress: 1 };

    const action = currentStep.actions.find((a) => a.targetId === targetId);
    if (!action) return { isVisible: true, progress: 1 };

    const stepDuration = Math.max(0.5, stepEffectiveDuration || currentStep.duration || 4);
    const cue = currentStep.cuePoints?.find(
      (c) => c.payload?.targetId === targetId || (c.event === 'drawGeometry' && c.payload?.targetId === targetId)
    );
    const startDelay = cue ? cue.time : action.delay || 0;
    const startRatio = startDelay / stepDuration;
    const durRatio = Math.max(0.12, (action.duration || 1) / stepDuration);
    const endRatio = startRatio + durRatio;

    if (stepProgress < startRatio) return { isVisible: false, progress: 0 };
    if (stepProgress >= endRatio) return { isVisible: true, progress: 1 };

    return {
      isVisible: true,
      progress: Math.min(1, Math.max(0, (stepProgress - startRatio) / durRatio)),
    };
  };

  ctx.save();

  // 1. Polygons (e.g. AHBK)
  if (polygons) {
    polygons.forEach((poly) => {
      if (!poly) return;
      const polyAction = getActionProgress(poly.id);
      if (!polyAction.isVisible || polyAction.progress <= 0) return;

      const pointIds: string[] = Array.isArray(poly.pointIds)
        ? poly.pointIds
        : Array.isArray((poly as any).points)
        ? (poly as any).points
        : [];
      if (pointIds.length === 0) return;

      const allPtsVisible = pointIds.every((pid) => visibleIds.has(pid));
      if (!allPtsVisible) return;

      const polyPts = pointIds.map((pid) => pointMap.get(pid)).filter(Boolean) as GeometricPoint[];
      if (polyPts.length < 3) return;

      const isHigh = highlightedIds.has(poly.id);
      const fillColor = isHigh ? 'rgba(219, 234, 254, 0.55)' : 'rgba(239, 246, 255, 0.22)';
      const strokeColor = isHigh ? '#2563eb' : '#64748b';

      ctx.save();
      ctx.globalAlpha = polyAction.progress;
      ctx.beginPath();
      const first = toCanvas(polyPts[0].x, polyPts[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < polyPts.length; i++) {
        const pt = toCanvas(polyPts[i].x, polyPts[i].y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();

      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = Math.max(1, (poly.strokeWidth || 1.5) * scale);
      ctx.stroke();
      ctx.restore();
    });
  }

  // 2. Angle Markers (Right angles, etc.)
  if (angleMarkers) {
    angleMarkers.forEach((marker) => {
      const markerAction = getActionProgress(marker.id);
      if (!markerAction.isVisible || markerAction.progress <= 0) return;
      const v = pointMap.get(marker.vertexPointId);
      const p1 = pointMap.get(marker.point1Id);
      const p2 = pointMap.get(marker.point2Id);
      if (!v || !p1 || !p2) return;

      const vc = toCanvas(v.x, v.y);
      const c1 = toCanvas(p1.x, p1.y);
      const c2 = toCanvas(p2.x, p2.y);

      if (marker.isRightAngle) {
        ctx.save();
        ctx.globalAlpha = markerAction.progress;
        const size = 14 * scale;
        const d1 = Math.hypot(c1.x - vc.x, c1.y - vc.y) || 1;
        const d2 = Math.hypot(c2.x - vc.x, c2.y - vc.y) || 1;

        const u1 = { x: (c1.x - vc.x) / d1, y: (c1.y - vc.y) / d1 };
        const u2 = { x: (c2.x - vc.x) / d2, y: (c2.y - vc.y) / d2 };

        const a = { x: vc.x + u1.x * size, y: vc.y + u1.y * size };
        const b = { x: vc.x + u1.x * size + u2.x * size, y: vc.y + u1.y * size + u2.y * size };
        const c = { x: vc.x + u2.x * size, y: vc.y + u2.y * size };

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = Math.max(1.5, 1.8 * scale);
        ctx.stroke();

        // Right angle center dot
        ctx.beginPath();
        ctx.arc(vc.x + (u1.x + u2.x) * (size * 0.45), vc.y + (u1.y + u2.y) * (size * 0.45), 2 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#059669';
        ctx.fill();
        ctx.restore();
      }
    });
  }

  // 3. Segments (with progressive draw animation)
  segments.forEach((seg) => {
    const act = getActionProgress(seg.id);
    if (!act.isVisible || act.progress <= 0) return;

    const fromP = pointMap.get(seg.fromPointId);
    const toP = pointMap.get(seg.toPointId);
    if (!fromP || !toP) return;

    const cFrom = toCanvas(fromP.x, fromP.y);
    const cToFull = toCanvas(toP.x, toP.y);

    // Interpolate for progressive draw animation
    const cTo = {
      x: cFrom.x + (cToFull.x - cFrom.x) * act.progress,
      y: cFrom.y + (cToFull.y - cFrom.y) * act.progress,
    };

    const isHigh = highlightedIds.has(seg.id);
    const strokeWidth = (seg.strokeWidth || (isHigh ? 3 : 2)) * scale;
    const color = isHigh
      ? '#d97706'
      : (seg.isAuxiliary ? '#64748b' : '#334155');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cFrom.x, cFrom.y);
    ctx.lineTo(cTo.x, cTo.y);

    if (seg.style === 'dashed' || seg.isAuxiliary) {
      ctx.setLineDash([6 * scale, 4 * scale]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  });

  // 4. Equal Length Markers (Tick marks across midpoints)
  if (equalLengthMarkers) {
    equalLengthMarkers.forEach((eq) => {
      if (!eq) return;
      const segmentIds: string[] = Array.isArray(eq.segmentIds)
        ? eq.segmentIds
        : Array.isArray((eq as any).segments)
        ? (eq as any).segments
        : [];
      if (segmentIds.length === 0) return;

      let markerAction = getActionProgress(eq.id);
      const hasTimedActions = Boolean(currentStep?.actions?.length);
      if (
        !hasTimedActions &&
        !markerAction.isVisible &&
        segmentIds.every((id) => visibleIds.has(id))
      ) {
        markerAction = { isVisible: true, progress: 1 };
      }
      if (!markerAction.isVisible || markerAction.progress <= 0) return;

      // Find common vertex anchor across segments in marker group if any
      let sharedAnchor: GeometricPoint | undefined;
      if (segmentIds.length >= 2) {
        const firstSeg = segments.find((s) => s?.id === segmentIds[0]);
        if (firstSeg) {
          const candIds = [firstSeg.fromPointId, firstSeg.toPointId];
          for (const candId of candIds) {
            const allShare = segmentIds.every((sId) => {
              const s = segments.find((x) => x?.id === sId);
              return s && (s.fromPointId === candId || s.toPointId === candId);
            });
            if (allShare) {
              sharedAnchor = pointMap.get(candId);
              break;
            }
          }
        }
      }

      const markerColor = eq.color || '#7c3aed';

      segmentIds.forEach((segId) => {
        const seg = segments.find((s) => s?.id === segId);
        if (!seg) return;
        const p1 = pointMap.get(seg.fromPointId);
        const p2 = pointMap.get(seg.toPointId);
        if (!p1 || !p2) return;

        const ticks = computeEqualLengthTicks(
          p1,
          p2,
          eq.ticksCount || 1,
          11,
          points,
          sharedAnchor
        );

        ctx.save();
        ctx.strokeStyle = markerColor;
        ctx.lineWidth = Math.max(1.5, 2 * scale);
        ctx.globalAlpha = markerAction.progress;
        ctx.lineCap = 'round';

        for (const tick of ticks) {
          const c1 = toCanvas(tick.p1.x, tick.p1.y);
          const c2 = toCanvas(tick.p2.x, tick.p2.y);
          ctx.beginPath();
          ctx.moveTo(c1.x, c1.y);
          ctx.lineTo(c2.x, c2.y);
          ctx.stroke();
        }
        ctx.restore();
      });
    });
  }

  // 5. Points & Auto-placed Labels
  points.forEach((p) => {
    const pointAction = getActionProgress(p.id);
    if (!pointAction.isVisible || pointAction.progress <= 0) return;
    const pt = toCanvas(p.x, p.y);
    const isHigh = highlightedIds.has(p.id);

    ctx.save();
    ctx.globalAlpha = pointAction.progress;

    // Draw Point Circle
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, (isHigh ? 6 : 4.5) * scale, 0, Math.PI * 2);
    ctx.fillStyle = isHigh ? '#d97706' : '#2563eb';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8 * scale;
    ctx.stroke();

    // Draw Point Label (e.g. A, B, C, H, K, I)
    const auto = autoLabels.get(p.id);
    const labelOffset = p.labelOffset || auto?.offset || { x: 0, y: -16 };
    const labelX = pt.x + labelOffset.x * scale;
    const labelY = pt.y + labelOffset.y * scale;

    const labelFontSize = Math.round(16 * scale);
    ctx.font = `bold ${labelFontSize}px "KaTeX_Math", "Cambria Math", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // White outline for high contrast against lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3.5 * scale;
    ctx.strokeText(p.name, labelX, labelY);

    ctx.fillStyle = isHigh ? '#b45309' : '#0f172a';
    ctx.fillText(p.name, labelX, labelY);
    ctx.restore();
  });

  ctx.restore();
}
