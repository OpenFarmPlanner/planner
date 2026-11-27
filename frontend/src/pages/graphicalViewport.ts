import { FIELD_WORLD_PX_PER_METER, rotateRect, type GraphicalRotation, type Position, type Rect, type RectSize } from './graphicalLayoutUtils';

export const GRAPHICAL_MANUAL_MIN_SCALE = 0.35;
export const GRAPHICAL_FIT_MIN_SCALE = 0.000001;
export const GRAPHICAL_MAX_CSS_PIXELS_PER_METER = 500;
export const GRAPHICAL_MAX_SCALE = GRAPHICAL_MAX_CSS_PIXELS_PER_METER / FIELD_WORLD_PX_PER_METER;
export const GRAPHICAL_APPROXIMATE_MAX_SCALE = 3;
export const ZOOM_LEVEL_OVERVIEW = 0.9;
export const ZOOM_LEVEL_MEDIUM = 1.25;
export const ZOOM_LEVEL_DETAIL = 1.8;
export const LABEL_VISIBILITY_SCALE = 0.55;
export const BED_LABEL_MIN_WIDTH = 88;
export const BED_LABEL_MIN_HEIGHT = 36;
export const BED_LABEL_MIN_SCALE = Math.min(1, GRAPHICAL_MAX_SCALE);
export const BED_LABEL_MIN_SCREEN_WIDTH = 76;
export const BED_LABEL_MIN_SCREEN_HEIGHT = 26;
export const BED_LABEL_ABSOLUTE_MIN_SCREEN_WIDTH = 22;
export const BED_LABEL_ABSOLUTE_MIN_SCREEN_HEIGHT = 13;

export interface ViewportState {
  scale: number;
  x: number;
  y: number;
}

export interface ZoomLimits {
  min: number;
  max: number;
}

export function projectViewportRect(rect: Rect, viewport: ViewportState): Rect {
  return { x: viewport.x + rect.x * viewport.scale, y: viewport.y + rect.y * viewport.scale,
    width: rect.width * viewport.scale, height: rect.height * viewport.scale };
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

function getViewportFrame(stageSize: RectSize, padding: number | ViewportPadding): Rect {
  const insets = typeof padding === 'number'
    ? { top: padding, right: padding, bottom: padding, left: padding } : padding;
  return { x: insets.left, y: insets.top,
    width: Math.max(1, stageSize.width - insets.left - insets.right),
    height: Math.max(1, stageSize.height - insets.top - insets.bottom) };
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

  const validRects = rects.filter(({ x, y, width, height }) => width > 0 && height > 0
    && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(x + width) && Number.isFinite(y + height));
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

export function getZoomLimits(overviewScale: number, max: number, retainedScale = overviewScale): ZoomLimits {
  return { min: Math.min(GRAPHICAL_MANUAL_MIN_SCALE, overviewScale, retainedScale), max };
}

export function clampScale(scale: number, limits: ZoomLimits): number {
  // Reciprocal button steps can land a few floating-point digits above the limit.
  const tolerance = 8 * Number.EPSILON;
  if (Number.isNaN(scale) || scale <= limits.min * (1 + tolerance)) return limits.min;
  if (scale >= limits.max * (1 - tolerance)) return limits.max;
  return scale;
}

export function isValidViewport(viewport: ViewportState | undefined): viewport is ViewportState {
  return Boolean(viewport && viewport.scale >= GRAPHICAL_FIT_MIN_SCALE
    && Number.isFinite(viewport.scale) && Number.isFinite(viewport.x) && Number.isFinite(viewport.y));
}

export function getVisibleElements(scale: number): VisibilityState {
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

export function shouldShowBedLabel(size: RectSize, scale: number): boolean {
  const screenWidth = size.width * scale;
  const screenHeight = size.height * scale;
  return (
    screenWidth >= BED_LABEL_ABSOLUTE_MIN_SCREEN_WIDTH &&
    screenHeight >= BED_LABEL_ABSOLUTE_MIN_SCREEN_HEIGHT
  );
}

/** A horizontal, screen-sized line inside the bed at every orientation. */
export function getBedLabelLayout(size: RectSize, scale: number) {
  if (!Number.isFinite(scale) || scale <= 0 || !shouldShowBedLabel(size, scale)) return null;
  const width = size.width * scale;
  const height = size.height * scale;
  const compact = width < 80 || height < 30;
  const fontSize = compact ? 11 : 12;
  return {
    x: 4 / scale,
    y: (height - fontSize) / 2 / scale,
    width: width - 8,
    height: fontSize,
    fontSize,
    rotation: 0,
    compact,
  };
}

export function fitBoundsToStage(
  contentBounds: ContentBounds,
  stageSize: RectSize,
  padding: number | ViewportPadding = 24,
  maxScale = GRAPHICAL_MAX_SCALE,
): ViewportState {
  const frame = getViewportFrame(stageSize, padding);
  const size = getBoundsSize(contentBounds);
  const scale = clampScale(Math.min(frame.width / size.width, frame.height / size.height),
    { min: GRAPHICAL_FIT_MIN_SCALE, max: maxScale });

  return {
    scale,
    x: frame.x + frame.width / 2 - (contentBounds.minX + size.width / 2) * scale,
    y: frame.y + frame.height / 2 - (contentBounds.minY + size.height / 2) * scale,
  };
}

export function fitContentToStage(
  contentSize: RectSize,
  stageSize: RectSize,
  padding: number | ViewportPadding = 24,
): ViewportState {
  return fitBoundsToStage(toContentBounds(contentSize), stageSize, padding);
}

export function zoomAroundPoint(
  viewport: ViewportState, nextScale: number, anchor: Position,
  limits: ZoomLimits = { min: GRAPHICAL_MANUAL_MIN_SCALE, max: GRAPHICAL_MAX_SCALE },
  destination = anchor,
): ViewportState {
  const clampedScale = clampScale(nextScale, limits);
  if (clampedScale === viewport.scale && anchor.x === destination.x && anchor.y === destination.y) return viewport;
  const ratio = clampedScale / viewport.scale;

  return {
    scale: clampedScale,
    x: destination.x - (anchor.x - viewport.x) * ratio,
    y: destination.y - (anchor.y - viewport.y) * ratio,
  };
}

export function rotateViewport(
  viewport: ViewportState, contentSize: RectSize, stageSize: RectSize,
  turn: GraphicalRotation, padding: ViewportPadding,
): ViewportState {
  const frame = getViewportFrame(stageSize, padding);
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const point = rotateRect({ x: (center.x - viewport.x) / viewport.scale,
    y: (center.y - viewport.y) / viewport.scale, width: 0, height: 0 }, contentSize, turn);
  return { scale: viewport.scale, x: center.x - point.x * viewport.scale, y: center.y - point.y * viewport.scale };
}

function clampViewportAxis(offset: number, start: number, end: number, frameStart: number, frameSize: number): number {
  const minOffset = frameStart + frameSize - end;
  const maxOffset = frameStart - start;
  return minOffset >= maxOffset ? (minOffset + maxOffset) / 2 : Math.min(maxOffset, Math.max(minOffset, offset));
}

export function clampViewportToStage(
  viewport: ViewportState,
  contentSizeOrBounds: RectSize | ContentBounds,
  stageSize: RectSize,
  padding: number | ViewportPadding = 0,
): ViewportState {
  const contentBounds =
    'minX' in contentSizeOrBounds
      ? contentSizeOrBounds
      : toContentBounds(contentSizeOrBounds);
  const frame = getViewportFrame(stageSize, padding);
  const size = getBoundsSize(contentBounds);
  const { scale } = viewport;
  return {
    scale,
    x: clampViewportAxis(viewport.x, contentBounds.minX * scale,
      (contentBounds.minX + size.width) * scale, frame.x, frame.width),
    y: clampViewportAxis(viewport.y, contentBounds.minY * scale,
      (contentBounds.minY + size.height) * scale, frame.y, frame.height),
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
  const deltaX = pointer.x - session.startPointerX;
  const deltaY = pointer.y - session.startPointerY;

  return {
    scale,
    x: session.startTranslateX + deltaX,
    y: session.startTranslateY + deltaY,
  };
}

export function getMetricScaleBar(scale: number, maxWidth: number): { meters: number; width: number } | null {
  const pixelsPerMeter = scale * FIELD_WORLD_PX_PER_METER;
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0 || !Number.isFinite(maxWidth) || maxWidth <= 0) return null;
  const maxMeters = maxWidth / pixelsPerMeter;
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  const steps = maxMeters / power;
  const meters = (steps >= 5 ? 5 : steps >= 2 ? 2 : 1) * power;
  return { meters, width: meters * pixelsPerMeter };
}
