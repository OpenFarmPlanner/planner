/**
 * Pure geometry, layout constants and snapping helpers for the graphical
 * fields canvas. Extracted verbatim from pages/GraphicalFields.tsx.
 */

import type { HierarchyDataState } from "../components/hierarchy/hooks/useHierarchyData";
import type { ViewportPadding, ViewportState } from "./graphicalViewport";
import type { Dispatch, SetStateAction } from "react";
import type { GraphicalRotation } from "./graphicalLayoutUtils";
import type { Season } from "../api/types";
import type { HierarchyEntityType } from "../components/hierarchy/details/hierarchyDetailRoutes";

export interface Point {
  x: number;
  y: number;
}

export interface SnapSize {
  width: number;
  height: number;
}

export interface RectViewModel {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  supportsMetricSpacing?: boolean;
}

export interface BedViewModel extends RectViewModel {
  id: number;
  name: string;
  area: number;
}

export interface GuideLine {
  target: string;
  orientation: "vertical" | "horizontal";
  value: number;
  start: number;
  end: number;
  gapCm?: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: GuideLine[];
}

export interface GraphicalFieldsProps {
  showTitle?: boolean;
  interactionMode?: InteractionMode;
  onInteractionModeChange?: (mode: InteractionMode) => void;
  showModeToggle?: boolean;
  activeSeasonId?: number;
  individualSeason?: Season;
  canEditIndividualPlants?: boolean;
  requestedIndividualPlan?: number;
  onOpenBed?: (id: number) => void;
  onOpenDetails?: (type: HierarchyEntityType, id: number) => void;
  canCompleteTasks?: boolean;
  hierarchyData?: HierarchyDataState;
  selectedLocationId?: number | null;
  cameraState?: GraphicalCameraState;
  onCameraStateChange?: Dispatch<SetStateAction<GraphicalCameraState>>;
}

export interface GraphicalCameraState {
  viewports: Record<number, ViewportState>;
  rotations: Record<number, GraphicalRotation>;
}

export type InteractionMode = "view" | "edit";

export const VIEWPORT_PADDING = 24;
export const VIEWPORT_CONTROL_SAFE_AREA_RIGHT = 120;
export const MOBILE_VIEWPORT_PADDING = 12;
export const MOBILE_VIEWPORT_CONTROL_SAFE_AREA_RIGHT = 56;
export const FIELD_INNER_OFFSET_X = 10;
export const FIELD_LABEL_HEIGHT = 24;
export const FIELD_INNER_OFFSET_Y = FIELD_INNER_OFFSET_X + FIELD_LABEL_HEIGHT;
export const FIELD_INNER_BOTTOM_PADDING = FIELD_INNER_OFFSET_X;

/**
 * The part of a field (Parzelle) beds can be placed in, in the field's own
 * coordinates: the border and the label strip at the top are kept free. The
 * single source for both the placement clamp and the drawn usable area, so
 * what the user sees and where a bed can go never disagree.
 */
export const getFieldUsableArea = (fieldSize: { width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} => ({
  x: FIELD_INNER_OFFSET_X,
  y: FIELD_INNER_OFFSET_Y,
  width: Math.max(0, fieldSize.width - FIELD_INNER_OFFSET_X * 2),
  height: Math.max(0, fieldSize.height - FIELD_INNER_OFFSET_Y - FIELD_INNER_BOTTOM_PADDING),
});
export const SNAP_THRESHOLD = 8;
export const FIELD_SNAP_THRESHOLD = 14;
export const DEFAULT_STAGE_HEIGHT = 420;
export const MIN_STAGE_HEIGHT = 320;
export const MAX_STAGE_HEIGHT = 560;
export const ZOOM_STEP = 1.2;
export const PAN_STEP = 80;
export const PAN_FAST_STEP = 180;
export const WORKSPACE_MIN_WIDTH = 20000;
export const WORKSPACE_MIN_HEIGHT = 20000;
export const LOCATION_LAYOUT_PADDING = 20;
export const LOCATION_FIELD_GAP = 24;
export const FIELD_WORLD_PX_PER_METER = 18;
export const FIELD_WORLD_BASE_WIDTH = 560;
export const FIELD_WORLD_MIN_WIDTH = 560;
export const FIELD_WORLD_MAX_WIDTH = 920;
export const FIELD_WORLD_MIN_HEIGHT = 220;
export const FIELD_WORLD_SCALE_FACTOR = 12;

export const getFitViewportPadding = (stageWidth: number, stageHeight = Number.POSITIVE_INFINITY): ViewportPadding => ({
  // Keep the location label above the boundary clear of the zoom readout.
  top: stageHeight < 200 ? 48 : 62,
  right:
    (stageWidth < 600 ? MOBILE_VIEWPORT_PADDING : VIEWPORT_PADDING) +
    (stageWidth < 600
      ? MOBILE_VIEWPORT_CONTROL_SAFE_AREA_RIGHT
      : VIEWPORT_CONTROL_SAFE_AREA_RIGHT),
  bottom: Math.min(48, stageHeight * 0.08),
  left: stageWidth < 600 ? MOBILE_VIEWPORT_PADDING : VIEWPORT_PADDING,
});
type SnapAxis = "x" | "y";

interface NeighborSnapOptions {
  thresholdPx?: number;
  zoom?: number;
  spacing?: { centimeters: number; pixelsPerMeter: Point };
  previousTargets?: readonly string[];
  constrain?: (point: Point) => Point;
}

interface SnapCandidate {
  target: string;
  neighbor: RectViewModel;
  position: number;
  edge: number;
  gapSide?: "before" | "after";
}

const AXIS_SIZE = { x: "width", y: "height" } as const;
const OTHER_AXIS = { x: "y", y: "x" } as const;
const COORDINATE_EPSILON = 1e-7;
const TARGET_HYSTERESIS_PX = 2;

function overlapAlong(axis: SnapAxis, position: Point, size: SnapSize, neighbor: RectViewModel) {
  const extent = AXIS_SIZE[axis];
  return {
    start: Math.max(position[axis], neighbor[axis]),
    end: Math.min(position[axis] + size[extent], neighbor[axis] + neighbor[extent]),
  };
}

function findSnapTarget(
  axis: SnapAxis,
  currentId: number,
  position: Point,
  size: SnapSize,
  neighbors: readonly RectViewModel[],
  options: NeighborSnapOptions,
): SnapCandidate | undefined {
  const zoom = options.zoom ?? 1;
  const threshold = (options.thresholdPx ?? SNAP_THRESHOLD) / zoom;
  const extent = AXIS_SIZE[axis];
  const candidates: SnapCandidate[] = [];
  const add = (candidate: SnapCandidate): void => {
    if (Math.abs(candidate.position - position[axis]) > threshold) return;
    const constrained = options.constrain?.({ ...position, [axis]: candidate.position });
    if (!constrained || Math.abs(constrained[axis] - candidate.position) <= COORDINATE_EPSILON) {
      candidates.push(candidate);
    }
  };

  for (const neighbor of neighbors) {
    if (neighbor.id === currentId) continue;
    const farEdge = neighbor[axis] + neighbor[extent];
    const prefix = `${axis}:${neighbor.id}`;
    const { spacing } = options;
    const pixelsPerMeter = spacing?.pixelsPerMeter[axis] ?? 0;
    const overlap = overlapAlong(OTHER_AXIS[axis], position, size, neighbor);
    if (spacing && neighbor.supportsMetricSpacing && pixelsPerMeter > 0 && overlap.end > overlap.start) {
      const gap = (spacing.centimeters / 100) * pixelsPerMeter;
      add({ target: `${prefix}:before`, neighbor, position: neighbor[axis] - size[extent] - gap,
        edge: neighbor[axis], gapSide: "before" });
      add({ target: `${prefix}:after`, neighbor, position: farEdge + gap, edge: farEdge, gapSide: "after" });
    }
    const referenceEdges = [neighbor[axis], neighbor[axis] + neighbor[extent] / 2, farEdge];
    for (const [movingIndex, offset] of [0, size[extent] / 2, size[extent]].entries()) {
      for (const [referenceIndex, edge] of referenceEdges.entries()) {
        add({ target: `${prefix}:${movingIndex}:${referenceIndex}`, neighbor, position: edge - offset, edge });
      }
    }
  }

  const distance = (candidate: SnapCandidate): number => Math.abs(candidate.position - position[axis]);
  candidates.sort((a, b) => distance(a) - distance(b)
    || Number(Boolean(b.gapSide)) - Number(Boolean(a.gapSide))
    || a.neighbor.id - b.neighbor.id
    || a.target.localeCompare(b.target));
  const nearest = candidates[0];
  const previous = candidates.find(candidate => options.previousTargets?.includes(candidate.target));
  if (nearest && previous && distance(previous) - distance(nearest) <= TARGET_HYSTERESIS_PX / zoom) {
    return previous;
  }
  return nearest;
}

function guideForTarget(
  axis: SnapAxis,
  candidate: SnapCandidate,
  position: Point,
  size: SnapSize,
  spacing: NeighborSnapOptions["spacing"],
): GuideLine {
  const { neighbor, edge, gapSide, target } = candidate;
  const orthogonal = OTHER_AXIS[axis];
  if (gapSide && spacing) {
    const { start, end } = overlapAlong(orthogonal, position, size, neighbor);
    const movingEdge = position[axis] + (gapSide === "before" ? size[AXIS_SIZE[axis]] : 0);
    return {
      target,
      orientation: axis === "x" ? "horizontal" : "vertical",
      value: (start + end) / 2,
      start: Math.min(edge, movingEdge),
      end: Math.max(edge, movingEdge),
      gapCm: (Math.abs(edge - movingEdge) / spacing.pixelsPerMeter[axis]) * 100,
    };
  }
  return {
    target,
    orientation: axis === "x" ? "vertical" : "horizontal",
    value: edge,
    start: Math.min(position[orthogonal], neighbor[orthogonal]),
    end: Math.max(position[orthogonal] + size[AXIS_SIZE[orthogonal]], neighbor[orthogonal] + neighbor[AXIS_SIZE[orthogonal]]),
  };
}

export function snapToNeighbors(
  currentId: number,
  position: Point,
  size: SnapSize,
  neighbors: readonly RectViewModel[],
  options: NeighborSnapOptions = {},
): SnapResult {
  const axes = ["x", "y"] as const;
  const candidates = {
    x: findSnapTarget("x", currentId, position, size, neighbors, options),
    y: findSnapTarget("y", currentId, position, size, neighbors, options),
  };
  const result = { x: candidates.x?.position ?? position.x, y: candidates.y?.position ?? position.y };
  for (const axis of axes) {
    const candidate = candidates[axis];
    if (!candidate?.gapSide) continue;
    const overlap = overlapAlong(OTHER_AXIS[axis], result, size, candidate.neighbor);
    if (overlap.end <= overlap.start) {
      candidates[axis] = undefined;
      result[axis] = position[axis];
    }
  }
  return {
    ...result,
    guides: axes.flatMap(axis => {
      const candidate = candidates[axis];
      return candidate ? [guideForTarget(axis, candidate, result, size, options.spacing)] : [];
    }),
  };
}
