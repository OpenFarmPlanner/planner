import type { Bed, Field } from '../api/types';

export interface RectSize {
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface Rect extends Position, RectSize {}

/**
 * Default gap (in world pixels) to keep between graphical objects when
 * searching for a collision-free placement position.
 */
export const DEFAULT_PLACEMENT_SPACING = 20;

interface AreaToRectOptions {
  baseWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  scaleFactor?: number;
}

const DEFAULT_OPTIONS: Required<AreaToRectOptions> = {
  baseWidth: 120,
  minWidth: 90,
  maxWidth: 180,
  minHeight: 36,
  scaleFactor: 2.2,
};
const DIMENSIONAL_RECT_MIN_SIDE = 72;

function enforceMinimumSide(size: RectSize, minSide: number): RectSize {
  const currentMinSide = Math.min(size.width, size.height);
  if (currentMinSide >= minSide) {
    return size;
  }

  const scaleFactor = minSide / Math.max(currentMinSide, 1);
  return {
    width: Math.round(size.width * scaleFactor),
    height: Math.round(size.height * scaleFactor),
  };
}

export function areaToRectSize(areaSqm: number | undefined, options: AreaToRectOptions = {}): RectSize {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const safeArea = Math.max(0.1, areaSqm ?? 1);
  const width = Math.max(config.minWidth, Math.min(config.maxWidth, config.baseWidth + Math.sqrt(safeArea) * 5));
  const height = Math.max(config.minHeight, (safeArea * config.scaleFactor) / width);
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}


export function getFieldRectSize(
  field: Pick<Field, 'area_sqm' | 'length_m' | 'width_m'>,
  pxPerMeter: number,
  options: AreaToRectOptions = {}
): RectSize {
  if (typeof field.length_m === 'number' && typeof field.width_m === 'number') {
    const dimensionalSize = {
      width: Math.max(1, Math.round(field.width_m * pxPerMeter)),
      height: Math.max(1, Math.round(field.length_m * pxPerMeter)),
    };
    return enforceMinimumSide(dimensionalSize, DIMENSIONAL_RECT_MIN_SIDE);
  }

  return areaToRectSize(Number(field.area_sqm ?? 1), options);
}

export function getBedRectSize(bed: Pick<Bed, 'area_sqm' | 'length_m' | 'width_m'>, pxPerMeter: number): RectSize {
  if (
    typeof bed.length_m === 'number' &&
    bed.length_m > 0 &&
    typeof bed.width_m === 'number' &&
    bed.width_m > 0
  ) {
    return {
      width: bed.width_m * pxPerMeter,
      height: bed.length_m * pxPerMeter,
    };
  }

  return areaToRectSize(Number(bed.area_sqm ?? 1));
}


export function getBedRectSizeWithinField(
  bed: Pick<Bed, 'area_sqm' | 'length_m' | 'width_m'>,
  field: Pick<Field, 'length_m' | 'width_m'>,
  fieldInnerSize: RectSize,
): RectSize {
  const bedLengthM = typeof bed.length_m === 'number' && bed.length_m > 0 ? bed.length_m : null;
  const bedWidthM = typeof bed.width_m === 'number' && bed.width_m > 0 ? bed.width_m : null;
  const fieldLengthM = typeof field.length_m === 'number' && field.length_m > 0 ? field.length_m : null;
  const fieldWidthM = typeof field.width_m === 'number' && field.width_m > 0 ? field.width_m : null;

  if (bedLengthM !== null && bedWidthM !== null && fieldLengthM !== null && fieldWidthM !== null) {
    const pxPerMeterX = fieldInnerSize.width / fieldWidthM;
    const pxPerMeterY = fieldInnerSize.height / fieldLengthM;

    return {
      width: bedWidthM * pxPerMeterX,
      height: bedLengthM * pxPerMeterY,
    };
  }

  return getBedRectSize(bed, getBedScaleFromField(field, fieldInnerSize));
}

export function getBedScaleFromField(
  field: Pick<Field, 'length_m' | 'width_m'>,
  fieldInnerSize: RectSize,
): number {
  const lengthM = typeof field.length_m === 'number' && field.length_m > 0 ? field.length_m : null;
  const widthM = typeof field.width_m === 'number' && field.width_m > 0 ? field.width_m : null;

  if (lengthM !== null && widthM !== null) {
    return Math.max(
      4,
      Math.min(
        fieldInnerSize.width / widthM,
        fieldInnerSize.height / lengthM,
      ),
    );
  }

  return Math.max(10, Math.min(36, fieldInnerSize.width / 40));
}

export function clampInsideParent(position: Position, childSize: RectSize, parentSize: RectSize): Position {
  const maxX = Math.max(0, parentSize.width - childSize.width);
  const maxY = Math.max(0, parentSize.height - childSize.height);
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY),
  };
}

/**
 * Returns true when two rectangles intersect, treating `spacing` as an extra
 * margin that must stay clear around each rectangle. With `spacing === 0` this
 * is a plain axis-aligned bounding box intersection test.
 */
export function rectsOverlap(a: Rect, b: Rect, spacing = 0): boolean {
  return (
    a.x < b.x + b.width + spacing &&
    a.x + a.width + spacing > b.x &&
    a.y < b.y + b.height + spacing &&
    a.y + a.height + spacing > b.y
  );
}

export interface FreePlacementOptions {
  /** Minimum gap to keep between the placed rectangle and every occupied one. */
  spacing?: number;
  /** Distance between candidate positions in the expanding grid search. */
  step?: number;
  /** Maximum number of rings to probe before giving up. */
  maxRadius?: number;
  /** Optional parent bounds; candidates are clamped to stay inside. */
  bounds?: RectSize;
}

/**
 * Finds the nearest collision-free position for a rectangle of `size`, starting
 * from `preferred` and probing outwards in an expanding square-ring (grid)
 * pattern. This keeps the preferred position when it is already free and is
 * generic enough to be reused for any graphical object, not just beds.
 *
 * Returns `null` when no free position is found within `maxRadius` rings, so
 * callers can fall back to their previous behavior.
 */
export function findFreePlacementPosition(
  preferred: Position,
  size: RectSize,
  occupied: Rect[],
  options: FreePlacementOptions = {},
): Position | null {
  const spacing = options.spacing ?? DEFAULT_PLACEMENT_SPACING;
  const step =
    options.step ??
    Math.max(1, Math.round(Math.min(size.width, size.height) / 2 + spacing));
  const maxRadius = options.maxRadius ?? 32;
  const { bounds } = options;

  const place = (pos: Position): Position =>
    bounds ? clampInsideParent(pos, size, bounds) : pos;

  const collides = (pos: Position): boolean => {
    const candidate: Rect = {
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
    };
    return occupied.some((rect) => rectsOverlap(candidate, rect, spacing));
  };

  const base = place(preferred);
  if (!collides(base)) {
    return base;
  }

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const candidate = place({
          x: preferred.x + dx * step,
          y: preferred.y + dy * step,
        });
        if (!collides(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

export function initialAutoLayout(
  ids: number[],
  childSizes: Map<number, RectSize>,
  parentSize: RectSize,
  gap = 12,
  occupiedRects: Rect[] = [],
  spacing: number = gap,
): Map<number, Position> {
  const output = new Map<number, Position>();
  const placed: Rect[] = [...occupiedRects];
  let cursorX = gap;
  let cursorY = gap;
  let rowHeight = 0;

  for (const id of ids) {
    const size = childSizes.get(id);
    if (!size) continue;

    if (cursorX + size.width > parentSize.width - gap) {
      cursorX = gap;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }

    const preferred = clampInsideParent({ x: cursorX, y: cursorY }, size, parentSize);
    const free = findFreePlacementPosition(preferred, size, placed, {
      spacing,
      bounds: parentSize,
    });
    const position = free ?? preferred;

    output.set(id, position);
    placed.push({
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    });

    cursorX += size.width + gap;
    rowHeight = Math.max(rowHeight, size.height);
  }

  return output;
}

export interface DefaultFieldRect extends RectSize {
  field: { id?: number };
  defaultX: number;
  defaultY: number;
}

export interface PlacedFieldRect extends Rect {
  id: number;
}

/** Gap kept between a field without a saved position and the placed fields. */
export const FIELD_PLACEMENT_SPACING = 24;

/**
 * Positions a location's fields: saved positions win; a field without one
 * (e.g. just added in the list view) is placed next to the fields that already
 * have a position, at the nearest free spot right of them. Only when no field
 * has a saved position does every field keep its default stacked position.
 *
 * Placing a new field at its default instead would put it in the middle of the
 * large workspace, far from saved positions near the origin, and fitting the
 * view to both would zoom out until fields and beds are no longer visible
 * (#903).
 */
export function placeFieldRects(
  rects: DefaultFieldRect[],
  savedPositions: Record<number, Position | undefined>,
  bounds: RectSize,
): PlacedFieldRect[] {
  const toRect = (rect: DefaultFieldRect, position: Position): PlacedFieldRect => ({
    id: rect.field.id!,
    ...clampInsideParent(position, rect, bounds),
    width: rect.width,
    height: rect.height,
  });
  const placed = rects
    .filter((rect) => savedPositions[rect.field.id!])
    .map((rect) => toRect(rect, savedPositions[rect.field.id!]!));
  const placedById = new Map(placed.map((rect) => [rect.id, rect]));
  const occupied: Rect[] = [...placed];

  return rects.map((rect) => {
    const saved = placedById.get(rect.field.id!);
    if (saved) return saved;
    if (placed.length === 0) return toRect(rect, { x: rect.defaultX, y: rect.defaultY });
    const preferred = {
      x: Math.max(...placed.map((item) => item.x + item.width)) + FIELD_PLACEMENT_SPACING,
      y: Math.min(...placed.map((item) => item.y)),
    };
    const position = findFreePlacementPosition(preferred, rect, occupied, {
      spacing: FIELD_PLACEMENT_SPACING,
      bounds,
    }) ?? preferred;
    const next = toRect(rect, position);
    occupied.push(next);
    return next;
  });
}
