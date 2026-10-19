import React, { useMemo, useState, useRef } from 'react';
import {
  GeometryScene,
  GeometricPoint,
  GeometricSegment,
  GeometricPolygon,
  GeometricAngleMarker,
  GeometricEqualLengthMarker,
  LessonStep,
} from '../types/lesson';
import {
  computeAutoLabelPositions,
  generateRightAnglePath,
  generateMidpointTicks,
} from '../lib/geometryUtils';

interface GeometryRendererProps {
  scene?: GeometryScene;
  currentStep?: LessonStep;
  stepProgress?: number; // 0 to 1 inside current step
  stepEffectiveDuration?: number; // dynamically adapted step duration
  isEditable?: boolean;
  onPointMoved?: (pointId: string, newOffset: { x: number; y: number }) => void;
  className?: string;
}

export const GeometryRenderer: React.FC<GeometryRendererProps> = ({
  scene,
  currentStep,
  stepProgress = 1,
  stepEffectiveDuration,
  isEditable = false,
  onPointMoved,
  className = '',
}) => {
  const [draggedPointId, setDraggedPointId] = useState<string | null>(null);
  const [customOffsets, setCustomOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const svgRef = useRef<SVGSVGElement | null>(null);

  const points = (scene?.points || []).filter((p): p is GeometricPoint => Boolean(p && p.id));
  const segments = (scene?.segments || []).filter((s): s is GeometricSegment => Boolean(s && s.id));
  const polygons = (scene?.polygons || []).filter((p): p is GeometricPolygon => Boolean(p && p.id));
  const angleMarkers = (scene?.angleMarkers || []).filter((a): a is GeometricAngleMarker => Boolean(a && a.id));
  const equalLengthMarkers = (scene?.equalLengthMarkers || []).filter((m): m is GeometricEqualLengthMarker => Boolean(m && m.id));
  const vbWidth = scene?.viewBox?.width || 500;
  const vbHeight = scene?.viewBox?.height || 360;

  // Set of visible object IDs for the current step (unconditional hook)
  const visibleIds = useMemo(() => {
    if (!currentStep || !currentStep.visibleObjectIds) {
      // No per-step visibility list means the whole scene is visible.
      // Include markers/polygons too; previously only points + segments were included,
      // which made right-angle, midpoint ticks and AHBK polygon silently disappear.
      return new Set(
        points
          .map((p) => p.id)
          .concat(segments.map((s) => s.id))
          .concat(polygons.map((p) => p.id))
          .concat(angleMarkers.map((a) => a.id))
          .concat(equalLengthMarkers.map((m) => m.id))
      );
    }
    return new Set(currentStep.visibleObjectIds);
  }, [currentStep, points, segments, polygons, angleMarkers, equalLengthMarkers]);

  // Set of highlighted object IDs for the current step (unconditional hook)
  const highlightedIds = useMemo(() => {
    if (!currentStep || !currentStep.highlightedObjectIds) return new Set<string>();
    return new Set(currentStep.highlightedObjectIds);
  }, [currentStep]);

  // Point lookup map (unconditional hook)
  const pointMap = useMemo(() => {
    const map = new Map<string, GeometricPoint>();
    points.forEach((p) => map.set(p.id, p));
    return map;
  }, [points]);

  // Dynamic Auto Label Placement based on currently visible geometry (unconditional hook)
  const autoLabels = useMemo(() => {
    if (points.length === 0) return new Map();
    return computeAutoLabelPositions(
      points,
      segments,
      angleMarkers,
      equalLengthMarkers,
      { width: vbWidth, height: vbHeight },
      visibleIds
    );
  }, [points, segments, angleMarkers, equalLengthMarkers, vbWidth, vbHeight, visibleIds]);

  // Early return after all hooks are evaluated
  if (!scene || points.length === 0) {
    return null;
  }

  // Helper to determine timing & progress of a specific target action within the current step
  const getActionProgress = (targetId: string): { isVisible: boolean; progress: number } => {
    if (!visibleIds.has(targetId)) {
      return { isVisible: false, progress: 0 };
    }

    if (!currentStep || !currentStep.actions) {
      return { isVisible: true, progress: 1 };
    }

    const action = currentStep.actions.find((a) => a.targetId === targetId);
    if (!action) {
      // Objects visible from previous steps are already 100% drawn
      return { isVisible: true, progress: 1 };
    }

    const stepDuration = Math.max(0.5, stepEffectiveDuration || currentStep.duration || 4);

    // Look for matching cue point if present for exact narration sync
    const cue = currentStep.cuePoints?.find(
      (c) => c.payload?.targetId === targetId || (c.event === 'drawGeometry' && c.payload?.targetId === targetId)
    );
    const startDelay = cue ? cue.time : action.delay || 0;
    const startRatio = startDelay / stepDuration;
    const durRatio = Math.max(0.12, (action.duration || 1) / stepDuration);
    const endRatio = startRatio + durRatio;

    if (stepProgress < startRatio) {
      return { isVisible: false, progress: 0 };
    }

    if (stepProgress >= endRatio) {
      return { isVisible: true, progress: 1 };
    }

    const localProgress = (stepProgress - startRatio) / durRatio;
    return { isVisible: true, progress: Math.min(1, Math.max(0, localProgress)) };
  };

  // Interactive label dragging (for Edit Before Export)
  const handlePointerDown = (pointId: string, e: React.PointerEvent) => {
    if (!isEditable) return;
    e.preventDefault();
    setDraggedPointId(pointId);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggedPointId || !svgRef.current) return;
    const pt = pointMap.get(draggedPointId);
    if (!pt) return;

    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = vbWidth / rect.width;
    const scaleY = vbHeight / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const newOffset = {
      x: mouseX - pt.x,
      y: mouseY - pt.y,
    };

    setCustomOffsets((prev) => ({ ...prev, [draggedPointId]: newOffset }));
    if (onPointMoved) {
      onPointMoved(draggedPointId, newOffset);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggedPointId) {
      setDraggedPointId(null);
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  return (
    <div
      className={`relative w-full h-full flex items-center justify-center select-none ${className}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full max-h-full drop-shadow-sm transition-all duration-300"
      >
        <defs>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.15" />
          </filter>
        </defs>

        {/* 1. RENDER POLYGONS (Background fills for highlighted quadrilaterals/triangles) */}
        {polygons?.map((poly) => {
          if (!poly) return null;
          const actionState = getActionProgress(poly.id);
          if (!actionState.isVisible) return null;

          const pointIds: string[] = Array.isArray(poly.pointIds)
            ? poly.pointIds
            : Array.isArray((poly as any).points)
            ? (poly as any).points
            : [];
          if (pointIds.length === 0) return null;

          const polyPoints = pointIds
            .map((pid) => pointMap.get(pid))
            .filter((p): p is GeometricPoint => Boolean(p));

          if (polyPoints.length < 3) return null;
          const pointsString = polyPoints.map((p) => `${p.x},${p.y}`).join(' ');
          const isHighlighted = highlightedIds.has(poly.id);

          return (
            <g
              key={poly.id}
              id={poly.id}
              style={{ opacity: actionState.progress }}
              className="transition-opacity duration-300"
            >
              <polygon
                points={pointsString}
                fill={isHighlighted ? '#dbeafe' : '#eff6ff'}
                fillOpacity={isHighlighted ? 0.55 : 0.22}
                stroke={isHighlighted ? '#2563eb' : '#64748b'}
                strokeWidth={isHighlighted ? 3 : poly.strokeWidth || 2}
                strokeDasharray={isHighlighted ? '6 4' : undefined}
                className={isHighlighted ? 'animate-pulse' : ''}
              />
            </g>
          );
        })}

        {/* 2. RENDER SEGMENTS */}
        {segments.map((seg) => {
          // Helper subsegments (e.g. segment-AI, segment-IB) are not drawn as separate lines
          if (seg.isHelper) return null;

          const actionState = getActionProgress(seg.id);
          if (!actionState.isVisible) return null;

          const p1 = pointMap.get(seg.fromPointId);
          const p2 = pointMap.get(seg.toPointId);
          if (!p1 || !p2) return null;

          const isHighlighted = highlightedIds.has(seg.id);
          const segLength = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
          const strokeProgress = actionState.progress;
          const dashOffset = (1 - strokeProgress) * segLength;

          return (
            <g key={seg.id} id={seg.id}>
              {/* Highlight halo under segment */}
              {isHighlighted && (
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#f59e0b"
                  strokeWidth={(seg.strokeWidth || 2) + 5}
                  strokeOpacity="0.18"
                  strokeLinecap="round"
                />
              )}
              {/* Main Line with draw-on effect */}
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={isHighlighted ? '#d97706' : '#334155'}
                strokeWidth={isHighlighted ? (seg.strokeWidth || 2) + 1.2 : seg.strokeWidth || 2}
                strokeDasharray={
                  strokeProgress < 1
                    ? `${segLength} ${segLength}`
                    : seg.style === 'dashed'
                    ? '6 4'
                    : seg.style === 'dotted'
                    ? '3 3'
                    : undefined
                }
                strokeDashoffset={strokeProgress < 1 ? dashOffset : undefined}
                strokeLinecap="round"
                className="transition-colors duration-300"
              />
            </g>
          );
        })}

        {/* 3. RENDER ANGLE MARKERS (Right angles & equal angles) */}
        {angleMarkers?.map((angle) => {
          const actionState = getActionProgress(angle.id);
          if (!actionState.isVisible) return null;

          const v = pointMap.get(angle.vertexPointId);
          const p1 = pointMap.get(angle.point1Id);
          const p2 = pointMap.get(angle.point2Id);
          if (!v || !p1 || !p2) return null;

          if (angle.isRightAngle) {
            const path = generateRightAnglePath(v, p1, p2, 14);
            return (
              <path
                key={angle.id}
                id={angle.id}
                d={path}
                fill="none"
                stroke="#059669"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ opacity: actionState.progress }}
                className="transition-opacity duration-300"
              />
            );
          }
          return null;
        })}

        {/* 4. RENDER EQUAL LENGTH MARKERS (Midpoint ticks on individual subsegments) */}
        {equalLengthMarkers?.map((marker) => {
          if (!marker) return null;
          const segmentIds: string[] = Array.isArray(marker.segmentIds)
            ? marker.segmentIds
            : Array.isArray((marker as any).segments)
            ? (marker as any).segments
            : [];
          if (segmentIds.length === 0) return null;

          let actionState = getActionProgress(marker.id);
          // Never bypass an explicit timeline. During animated construction, equality
          // marks must wait for their own action/cue instead of appearing at frame 0.
          const hasTimedActions = Boolean(currentStep?.actions?.length);
          if (
            !hasTimedActions &&
            !actionState.isVisible &&
            segmentIds.every((id) => visibleIds.has(id))
          ) {
            actionState = { isVisible: true, progress: 1 };
          }
          if (!actionState.isVisible || actionState.progress <= 0) return null;

          // Find common vertex anchor across segments in marker group if any (e.g. vertex A for AB and AC)
          let sharedAnchor: GeometricPoint | undefined;
          if (segmentIds.length >= 2) {
            const firstSeg = segments.find((s) => s.id === segmentIds[0]);
            if (firstSeg) {
              const candIds = [firstSeg.fromPointId, firstSeg.toPointId];
              for (const candId of candIds) {
                const allShare = segmentIds.every((sId) => {
                  const s = segments.find((x) => x.id === sId);
                  return s && (s.fromPointId === candId || s.toPointId === candId);
                });
                if (allShare) {
                  sharedAnchor = pointMap.get(candId);
                  break;
                }
              }
            }
          }

          const markerColor = marker.color || '#7c3aed';

          return segmentIds.map((segId) => {
            const seg = segments.find((s) => s.id === segId);
            if (!seg) return null;
            const p1 = pointMap.get(seg.fromPointId);
            const p2 = pointMap.get(seg.toPointId);
            if (!p1 || !p2) return null;

            const ticksPath = generateMidpointTicks(
              p1,
              p2,
              marker.ticksCount || 1,
              11,
              points,
              sharedAnchor
            );
            return (
              <path
                key={`${marker.id}-${segId}`}
                d={ticksPath}
                stroke={markerColor}
                strokeWidth="2"
                strokeLinecap="round"
                style={{ opacity: actionState.progress }}
                className="transition-opacity duration-300"
              />
            );
          });
        })}

        {/* 5. RENDER POINTS AND LABELS (with Auto Placement + Interactive Drag) */}
        {points.map((pt) => {
          const actionState = getActionProgress(pt.id);
          if (!actionState.isVisible) return null;

          const isHighlighted = highlightedIds.has(pt.id);

          // Get calculated auto offset or user custom offset
          const auto = autoLabels.get(pt.id);
          const custom = customOffsets[pt.id] || pt.labelOffset;
          const labelOffset = custom || auto?.offset || { x: 12, y: -12 };

          const labelX = pt.x + labelOffset.x;
          const labelY = pt.y + labelOffset.y;

          return (
            <g
              key={pt.id}
              id={pt.id}
              style={{ opacity: actionState.progress }}
              className="transition-opacity duration-300"
            >
              {/* Point Dot Aura if highlighted */}
              {isHighlighted && (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="10"
                  fill="#f59e0b"
                  fillOpacity="0.18"
                  className="animate-ping"
                />
              )}

              {/* Point Dot */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isHighlighted ? 6 : 4.8}
                fill={isHighlighted ? '#d97706' : '#2563eb'}
                stroke="#ffffff"
                strokeWidth="1.5"
                filter="url(#softShadow)"
              />

              {/* Point Label with Auto Placement */}
              <g
                transform={`translate(${labelX}, ${labelY})`}
                className={isEditable ? 'cursor-grab active:cursor-grabbing' : ''}
                onPointerDown={(e) => handlePointerDown(pt.id, e)}
              >
                {/* Background pill to guarantee text readability against lines & markers */}
                <rect
                  x="-15"
                  y="-14"
                  width="30"
                  height="27"
                  rx="6"
                  fill="#ffffff"
                  fillOpacity="0.94"
                  stroke="#e2e8f0"
                  strokeWidth="1"
                  className="pointer-events-none"
                />
                <text
                  x="0"
                  y="2"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`font-serif font-bold select-none ${
                    isHighlighted ? 'fill-amber-600' : 'fill-slate-900'
                  }`}
                  style={{ fontStyle: 'italic', fontSize: 18 }}
                >
                  {pt.name}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {/* Edit Hint Tag if in editable mode */}
      {isEditable && (
        <div className="absolute top-2 right-2 bg-slate-800/80 backdrop-blur-xs text-xs text-slate-300 px-2.5 py-1 rounded-md border border-slate-700 pointer-events-none">
          Kéo nhãn để vi chỉnh vị trí
        </div>
      )}
    </div>
  );
};
