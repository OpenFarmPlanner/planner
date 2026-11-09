/**
 * Pure geometry, layout constants and snapping helpers for the graphical
 * fields canvas. Extracted verbatim from pages/GraphicalFields.tsx.
 */

import type { HierarchyDataState } from "../components/hierarchy/hooks/useHierarchyData";
import type { ViewportPadding } from "./graphicalViewport";

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
}

export interface BedViewModel extends RectViewModel {
  id: number;
  name: string;
  area: number;
}

export interface GuideLine {
  orientation: "vertical" | "horizontal";
  value: number;
  start: number;
  end: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: GuideLine[];
}

export interface SelectedElement {
  type: "field" | "bed";
  name: string;
  area: number | null;
  locationName: string;
  parentName?: string;
}

export interface GraphicalFieldsProps {
  showTitle?: boolean;
  interactionMode?: InteractionMode;
  onInteractionModeChange?: (mode: InteractionMode) => void;
  showModeToggle?: boolean;
  hierarchyData?: HierarchyDataState;
}

export type InteractionMode = "view" | "edit";

export const VIEWPORT_PADDING = 24;
export const VIEWPORT_CONTROL_SAFE_AREA_RIGHT = 120;
export const MOBILE_VIEWPORT_PADDING = 12;
export const MOBILE_VIEWPORT_CONTROL_SAFE_AREA_RIGHT = 8;
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

export const getFitViewportPadding = (stageWidth: number): ViewportPadding => ({
  top: stageWidth < 600 ? MOBILE_VIEWPORT_PADDING : VIEWPORT_PADDING,
  right:
    (stageWidth < 600 ? MOBILE_VIEWPORT_PADDING : VIEWPORT_PADDING) +
    (stageWidth < 600
      ? MOBILE_VIEWPORT_CONTROL_SAFE_AREA_RIGHT
      : VIEWPORT_CONTROL_SAFE_AREA_RIGHT),
  bottom: stageWidth < 600 ? MOBILE_VIEWPORT_PADDING : VIEWPORT_PADDING,
  left: stageWidth < 600 ? MOBILE_VIEWPORT_PADDING : VIEWPORT_PADDING,
});
export const snapToNeighbors = (
  currentId: number,
  position: Point,
  size: SnapSize,
  neighbors: RectViewModel[],
  threshold: number = SNAP_THRESHOLD,
): SnapResult => {
  let snappedX = position.x;
  let snappedY = position.y;
  let bestXDelta = threshold + 1;
  let bestYDelta = threshold + 1;
  const guides: GuideLine[] = [];

  const currentXPoints = [
    { value: position.x },
    { value: position.x + size.width / 2 },
    { value: position.x + size.width },
  ];
  const currentYPoints = [
    { value: position.y },
    { value: position.y + size.height / 2 },
    { value: position.y + size.height },
  ];

  neighbors
    .filter((neighbor) => neighbor.id !== currentId)
    .forEach((neighbor) => {
      const neighborXPoints = [
        { value: neighbor.x },
        { value: neighbor.x + neighbor.width / 2 },
        { value: neighbor.x + neighbor.width },
      ];
      const neighborYPoints = [
        { value: neighbor.y },
        { value: neighbor.y + neighbor.height / 2 },
        { value: neighbor.y + neighbor.height },
      ];

      currentXPoints.forEach((currentPoint) => {
        neighborXPoints.forEach((neighborPoint) => {
          const delta = neighborPoint.value - currentPoint.value;
          const absDelta = Math.abs(delta);
          if (absDelta <= threshold && absDelta < bestXDelta) {
            bestXDelta = absDelta;
            snappedX = position.x + delta;
            guides.push({
              orientation: "vertical",
              value: neighborPoint.value,
              start: Math.min(position.y, neighbor.y),
              end: Math.max(
                position.y + size.height,
                neighbor.y + neighbor.height,
              ),
            });
          }
        });
      });

      currentYPoints.forEach((currentPoint) => {
        neighborYPoints.forEach((neighborPoint) => {
          const delta = neighborPoint.value - currentPoint.value;
          const absDelta = Math.abs(delta);
          if (absDelta <= threshold && absDelta < bestYDelta) {
            bestYDelta = absDelta;
            snappedY = position.y + delta;
            guides.push({
              orientation: "horizontal",
              value: neighborPoint.value,
              start: Math.min(position.x, neighbor.x),
              end: Math.max(
                position.x + size.width,
                neighbor.x + neighbor.width,
              ),
            });
          }
        });
      });
    });

  const latestVerticalGuide = [...guides]
    .reverse()
    .find((guide) => guide.orientation === "vertical");
  const latestHorizontalGuide = [...guides]
    .reverse()
    .find((guide) => guide.orientation === "horizontal");

  return {
    x: snappedX,
    y: snappedY,
    guides: [
      ...(latestVerticalGuide ? [latestVerticalGuide] : []),
      ...(latestHorizontalGuide ? [latestHorizontalGuide] : []),
    ],
  };
};
