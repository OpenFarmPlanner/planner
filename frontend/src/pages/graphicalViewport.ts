import type { RectSize } from './graphicalLayoutUtils';

export const GRAPHICAL_MANUAL_MIN_SCALE = 0.35;
export const GRAPHICAL_FIT_MIN_SCALE = 0.01;
export const GRAPHICAL_MAX_SCALE = 3;
export const ZOOM_LEVEL_OVERVIEW = 0.9;
export const ZOOM_LEVEL_MEDIUM = 1.25;
export const ZOOM_LEVEL_DETAIL = 1.8;
export const LABEL_VISIBILITY_SCALE = 0.55;
// A field label is drawn at a constant screen size (the text is scaled by
// 1 / zoom), so whether it fits depends on the field's on-screen size only,
// never on the zoom level itself (#904).
export const FIELD_LABEL_MIN_SCREEN_WIDTH = 36;
export const FIELD_LABEL_MIN_SCREEN_HEIGHT = 24;
/** Screen-pixel inset of a field label from the field's top-left corner. */
export const FIELD_LABEL_SCREEN_PADDING = 6;
export const BED_LABEL_MIN_WIDTH = 88;
export const BED_LABEL_MIN_HEIGHT = 36;
export const BED_LABEL_MIN_SCALE = Math.min(1, GRAPHICAL_MAX_SCALE);
export const BED_LABEL_MIN_SCREEN_WIDTH = 76;
export const BED_LABEL_MIN_SCREEN_HEIGHT = 26;
export const BED_LABEL_ABSOLUTE_MIN_SCREEN_WIDTH = 22;
export const BED_LABEL_ABSOLUTE_MIN_SCREEN_HEIGHT = 14;

export interface ViewportState {
  scale: number;
  x: number;
  y: number;
}

export interface PanSession {
  startPointerX: number;
  startPointerY: number;
  startTranslateX: number;
  startTranslateY: number;
}

export interface VisibilityState {
  showBeds: boolean;
  showBedLabels: boolean;
  showDetailedBedLabels: boolean;
}

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function normalizePadding(padding: number | ViewportPadding): ViewportPadding {
  if (typeof padding === 'number') {
    return {
      top: padding,
      right: padding,
      bottom: padding,
      left: padding,
    };
  }
  return padding;
}

export function toContentBounds(contentSize: RectSize): ContentBounds {
  return {
    minX: 0,
    minY: 0,
    maxX: Math.max(contentSize.width, 1),
    maxY: Math.max(contentSize.height, 1),
  };
}

export function getBoundsSize(bounds: ContentBounds): RectSize {
  return {
    width: Math.max(bounds.maxX - bounds.minX, 1),
    height: Math.max(bounds.maxY - bounds.minY, 1),
  };
}

export function getContentBoundsFromRects(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): ContentBounds | null {
  if (rects.length === 0) return null;

  const validRects = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (validRects.length === 0) return null;

  return validRects.reduce<ContentBounds>(
    (acc, rect) => ({
      minX: Math.min(acc.minX, rect.x),
      minY: Math.min(acc.minY, rect.y),
      maxX: Math.max(acc.maxX, rect.x + rect.width),
      maxY: Math.max(acc.maxY, rect.y + rect.height),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

export function clampScale(
  scale: number,
  minScale = GRAPHICAL_MANUAL_MIN_SCALE,
): number {
  return Math.min(GRAPHICAL_MAX_SCALE, Math.max(minScale, scale));
}

export function getVisibleElements(scale: number): VisibilityState {
  if (scale < ZOOM_LEVEL_OVERVIEW) {
    return {
      showBeds: false,
      showBedLabels: false,
      showDetailedBedLabels: false,
    };
  }

  if (scale < ZOOM_LEVEL_DETAIL) {
    return {
      showBeds: true,
      showBedLabels: true,
      showDetailedBedLabels: false,
    };
  }

  return {
    showBeds: true,
    showBedLabels: true,
    showDetailedBedLabels: true,
  };
}

export function shouldShowFieldLabel(size: RectSize, scale: number): boolean {
  return size.width * scale >= FIELD_LABEL_MIN_SCREEN_WIDTH
    && size.height * scale >= FIELD_LABEL_MIN_SCREEN_HEIGHT;
}

/** On-screen width available to a field label, so long names end in an ellipsis inside the field. */
export function getFieldLabelScreenWidth(size: RectSize, scale: number): number {
  return Math.max(0, size.width * scale - FIELD_LABEL_SCREEN_PADDING * 2);
}

export function shouldShowBedLabel(size: RectSize, scale: number): boolean {
  const screenWidth = size.width * scale;
  const screenHeight = size.height * scale;
  return (
    screenWidth >= BED_LABEL_ABSOLUTE_MIN_SCREEN_WIDTH &&
    screenHeight >= BED_LABEL_ABSOLUTE_MIN_SCREEN_HEIGHT
  );
}

export function fitBoundsToStage(
  contentBounds: ContentBounds,
  stageSize: RectSize,
  padding: number | ViewportPadding = 24,
): ViewportState {
  const normalizedPadding = normalizePadding(padding);
  const safeWidth = Math.max(contentBounds.maxX - contentBounds.minX, 1);
  const safeHeight = Math.max(contentBounds.maxY - contentBounds.minY, 1);
  const availableWidth = Math.max(1, stageSize.width - normalizedPadding.left - normalizedPadding.right);
  const availableHeight = Math.max(1, stageSize.height - normalizedPadding.top - normalizedPadding.bottom);
  const scaleX = Math.max(0.01, availableWidth / safeWidth);
  const scaleY = Math.max(0.01, availableHeight / safeHeight);
  const scale = clampScale(Math.min(scaleX, scaleY), GRAPHICAL_FIT_MIN_SCALE);
  const contentCenterX = (contentBounds.minX + contentBounds.maxX) / 2;
  const contentCenterY = (contentBounds.minY + contentBounds.maxY) / 2;
  const viewportCenterX = normalizedPadding.left + availableWidth / 2;
  const viewportCenterY = normalizedPadding.top + availableHeight / 2;

  return {
    scale,
    x: viewportCenterX - contentCenterX * scale,
    y: viewportCenterY - contentCenterY * scale,
  };
}

export function fitContentToStage(
  contentSize: RectSize,
  stageSize: RectSize,
  padding: number | ViewportPadding = 24,
): ViewportState {
  return fitBoundsToStage(toContentBounds(contentSize), stageSize, padding);
}

export function zoomAroundPoint(viewport: ViewportState, nextScale: number, anchor: { x: number; y: number }): ViewportState {
  const clampedScale = clampScale(nextScale);
  const stagePoint = {
    x: (anchor.x - viewport.x) / viewport.scale,
    y: (anchor.y - viewport.y) / viewport.scale,
  };

  return {
    scale: clampedScale,
    x: anchor.x - stagePoint.x * clampedScale,
    y: anchor.y - stagePoint.y * clampedScale,
  };
}

export function clampViewportToStage(
  viewport: ViewportState,
  contentSizeOrBounds: RectSize | ContentBounds,
  stageSize: RectSize,
): ViewportState {
  const contentBounds =
    'minX' in contentSizeOrBounds
      ? contentSizeOrBounds
      : toContentBounds(contentSizeOrBounds);
  const safeContentWidth = Math.max(contentBounds.maxX - contentBounds.minX, 1);
  const safeContentHeight = Math.max(contentBounds.maxY - contentBounds.minY, 1);
  const scaledWidth = safeContentWidth * viewport.scale;
  const scaledHeight = safeContentHeight * viewport.scale;

  if (scaledWidth <= stageSize.width) {
    const centeredX =
      (stageSize.width - scaledWidth) / 2 - contentBounds.minX * viewport.scale;
    return {
      ...viewport,
      x: centeredX,
      y:
        scaledHeight <= stageSize.height
          ? (stageSize.height - scaledHeight) / 2 -
            contentBounds.minY * viewport.scale
          : Math.min(
              -contentBounds.minY * viewport.scale,
              Math.max(
                stageSize.height - contentBounds.maxY * viewport.scale,
                viewport.y,
              ),
            ),
    };
  }

  if (scaledHeight <= stageSize.height) {
    const centeredY =
      (stageSize.height - scaledHeight) / 2 - contentBounds.minY * viewport.scale;
    return {
      ...viewport,
      x: Math.min(
        -contentBounds.minX * viewport.scale,
        Math.max(stageSize.width - contentBounds.maxX * viewport.scale, viewport.x),
      ),
      y: centeredY,
    };
  }

  return {
    ...viewport,
    x: Math.min(
      -contentBounds.minX * viewport.scale,
      Math.max(stageSize.width - contentBounds.maxX * viewport.scale, viewport.x),
    ),
    y: Math.min(
      -contentBounds.minY * viewport.scale,
      Math.max(stageSize.height - contentBounds.maxY * viewport.scale, viewport.y),
    ),
  };
}

export function startPanSession(viewport: ViewportState, pointer: { x: number; y: number }): PanSession {
  return {
    startPointerX: pointer.x,
    startPointerY: pointer.y,
    startTranslateX: viewport.x,
    startTranslateY: viewport.y,
  };
}

export function panViewport(session: PanSession, pointer: { x: number; y: number }, scale: number): ViewportState {
  const safeScale = clampScale(scale);
  const deltaX = pointer.x - session.startPointerX;
  const deltaY = pointer.y - session.startPointerY;

  return {
    scale: safeScale,
    x: session.startTranslateX + deltaX,
    y: session.startTranslateY + deltaY,
  };
}
