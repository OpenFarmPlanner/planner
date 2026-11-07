import { describe, expect, it } from 'vitest';
import { areaToRectSize, clampInsideParent, findFreePlacementPosition, getBedRectSize, getBedRectSizeWithinField, getBedScaleFromField, getFieldRectSize, initialAutoLayout, placeFieldRects, rectsOverlap, FIELD_PLACEMENT_SPACING, type Rect } from '../pages/graphicalLayoutUtils';

describe('graphicalLayoutUtils', () => {
  it('returns deterministic area size', () => {
    const first = areaToRectSize(12.5, { baseWidth: 120 });
    const second = areaToRectSize(12.5, { baseWidth: 120 });
    expect(first).toEqual(second);
    expect(first.width).toBeGreaterThan(0);
    expect(first.height).toBeGreaterThan(0);
  });

  it('uses dimensions first and falls back to area for bed rect sizes', () => {
    const dimensionsSize = getBedRectSize({ length_m: 5, width_m: 2, area_sqm: 7 }, 12);
    expect(dimensionsSize).toEqual({ width: 24, height: 60 });

    const fallbackSize = getBedRectSize({ area_sqm: 20, length_m: null, width_m: null }, 12);
    expect(fallbackSize.width).toBeGreaterThan(0);
    expect(fallbackSize.height).toBeGreaterThan(0);
  });

  it('preserves proportional dimensions for very small bed rect sizes', () => {
    const smallBed = getBedRectSize({ length_m: 1, width_m: 1, area_sqm: 100 }, 8);
    const doubleBed = getBedRectSize({ length_m: 2, width_m: 2, area_sqm: 1 }, 8);

    expect(smallBed).toEqual({ width: 8, height: 8 });
    expect(doubleBed.width / smallBed.width).toBe(2);
    expect(doubleBed.height / smallBed.height).toBe(2);
    expect((doubleBed.width * doubleBed.height) / (smallBed.width * smallBed.height)).toBe(4);
  });

  it('keeps fractional dimensional bed sizes to avoid rounding drift', () => {
    const smallBed = getBedRectSize({ length_m: 1, width_m: 1, area_sqm: 1 }, 7.5);
    const doubleBed = getBedRectSize({ length_m: 2, width_m: 2, area_sqm: 4 }, 7.5);

    expect(smallBed).toEqual({ width: 7.5, height: 7.5 });
    expect(doubleBed).toEqual({ width: 15, height: 15 });
  });

  it('uses dimensions first and falls back to area for field rect sizes', () => {
    const dimensionsSize = getFieldRectSize({ length_m: 15, width_m: 10, area_sqm: 42 }, 20);
    expect(dimensionsSize).toEqual({ width: 200, height: 300 });

    const fallbackSize = getFieldRectSize({ area_sqm: 100, length_m: null, width_m: null }, 20);
    expect(fallbackSize.width).toBeGreaterThan(0);
    expect(fallbackSize.height).toBeGreaterThan(0);
  });

  it('preserves dimensional aspect ratio for narrow fields while applying minimum size', () => {
    const narrowField = getFieldRectSize({ length_m: 10, width_m: 3, area_sqm: 30 }, 12);
    expect(narrowField).toEqual({ width: 72, height: 240 });
  });

  it('derives bed scale from field dimensions when available', () => {
    const scale = getBedScaleFromField({ length_m: 20, width_m: 10 }, { width: 400, height: 150 });
    expect(scale).toBe(7.5);
  });

  it('falls back to width-based bed scale when field dimensions are unavailable', () => {
    const scale = getBedScaleFromField({ length_m: null, width_m: null }, { width: 600, height: 150 });
    expect(scale).toBe(15);
  });



  it('preserves proportional dimensions for very small beds inside a field', () => {
    const fieldInnerSize = { width: 333, height: 221 };
    const field = { length_m: 10, width_m: 10 };
    const smallBed = getBedRectSizeWithinField(
      { length_m: 1, width_m: 1, area_sqm: 100 },
      field,
      fieldInnerSize,
    );
    const doubleBed = getBedRectSizeWithinField(
      { length_m: 2, width_m: 2, area_sqm: 1 },
      field,
      fieldInnerSize,
    );

    expect(smallBed).toEqual({ width: 33.3, height: 22.1 });
    expect(doubleBed.width / smallBed.width).toBe(2);
    expect(doubleBed.height / smallBed.height).toBe(2);
    expect((doubleBed.width * doubleBed.height) / (smallBed.width * smallBed.height)).toBe(4);
  });

  it('fills full placeable width when bed width equals field width', () => {
    const fieldInnerSize = { width: 360, height: 240 };
    const bedSize = getBedRectSizeWithinField(
      { length_m: 4, width_m: 10, area_sqm: 40 },
      { length_m: 20, width_m: 10 },
      fieldInnerSize,
    );

    expect(bedSize.width).toBe(fieldInnerSize.width);
  });

  it('fills full placeable height when bed length equals field length', () => {
    const fieldInnerSize = { width: 360, height: 240 };
    const bedSize = getBedRectSizeWithinField(
      { length_m: 20, width_m: 2, area_sqm: 40 },
      { length_m: 20, width_m: 10 },
      fieldInnerSize,
    );

    expect(bedSize.height).toBe(fieldInnerSize.height);
  });

  it('clamps child position inside parent bounds', () => {
    const position = clampInsideParent({ x: 200, y: -12 }, { width: 80, height: 60 }, { width: 220, height: 140 });
    expect(position).toEqual({ x: 140, y: 0 });
  });

  it('creates non-overflowing initial auto layout', () => {
    const sizes = new Map<number, { width: number; height: number }>([
      [1, { width: 100, height: 50 }],
      [2, { width: 100, height: 50 }],
      [3, { width: 100, height: 50 }],
    ]);

    const output = initialAutoLayout([1, 2, 3], sizes, { width: 230, height: 200 }, 10);
    expect(output.get(1)?.x).toBe(10);
    expect(output.get(2)?.y).toBe(10);
    expect(output.get(3)?.y).toBe(70);
  });

  it('detects rectangle intersection with and without spacing', () => {
    const a: Rect = { x: 0, y: 0, width: 50, height: 50 };
    const b: Rect = { x: 60, y: 0, width: 50, height: 50 };

    expect(rectsOverlap(a, b)).toBe(false);
    // 10px gap between them: still clear at spacing 10, blocked at spacing 20.
    expect(rectsOverlap(a, b, 10)).toBe(false);
    expect(rectsOverlap(a, b, 20)).toBe(true);
    expect(rectsOverlap(a, { ...a }, 0)).toBe(true);
  });

  it('keeps the preferred position when it is already free', () => {
    const occupied: Rect[] = [{ x: 200, y: 200, width: 50, height: 50 }];
    const result = findFreePlacementPosition(
      { x: 10, y: 10 },
      { width: 50, height: 50 },
      occupied,
      { spacing: 20 },
    );
    expect(result).toEqual({ x: 10, y: 10 });
  });

  it('searches outward for a collision-free position when the preferred one overlaps', () => {
    const size = { width: 50, height: 50 };
    const occupied: Rect[] = [{ x: 10, y: 10, width: 50, height: 50 }];
    const result = findFreePlacementPosition({ x: 10, y: 10 }, size, occupied, {
      spacing: 20,
    });

    expect(result).not.toBeNull();
    const placed: Rect = { ...size, x: result!.x, y: result!.y };
    expect(occupied.some((rect) => rectsOverlap(placed, rect, 20))).toBe(false);
  });

  it('clamps candidate positions to the provided bounds', () => {
    const size = { width: 50, height: 50 };
    const bounds = { width: 200, height: 200 };
    const occupied: Rect[] = [{ x: 0, y: 0, width: 50, height: 50 }];
    const result = findFreePlacementPosition({ x: 0, y: 0 }, size, occupied, {
      spacing: 20,
      bounds,
    });

    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(0);
    expect(result!.y).toBeGreaterThanOrEqual(0);
    expect(result!.x).toBeLessThanOrEqual(bounds.width - size.width);
    expect(result!.y).toBeLessThanOrEqual(bounds.height - size.height);
  });

  it('returns null when no free position fits within the search radius', () => {
    const size = { width: 50, height: 50 };
    const bounds = { width: 50, height: 50 };
    const occupied: Rect[] = [{ x: 0, y: 0, width: 50, height: 50 }];
    const result = findFreePlacementPosition({ x: 0, y: 0 }, size, occupied, {
      spacing: 20,
      bounds,
    });

    expect(result).toBeNull();
  });

  it('places new beds without overlapping existing occupied beds', () => {
    const sizes = new Map<number, { width: number; height: number }>([
      [1, { width: 100, height: 50 }],
    ]);
    const occupied: Rect[] = [{ x: 12, y: 12, width: 100, height: 50 }];

    const output = initialAutoLayout([1], sizes, { width: 400, height: 400 }, 12, occupied, 20);
    const placed: Rect = { x: output.get(1)!.x, y: output.get(1)!.y, width: 100, height: 50 };

    expect(rectsOverlap(placed, occupied[0], 20)).toBe(false);
  });

  describe('placeFieldRects', () => {
    const bounds = { width: 20000, height: 20000 };
    const field = (id: number, defaultX = 9700, defaultY = 9700) => ({
      field: { id }, width: 560, height: 220, defaultX, defaultY,
    });

    it('keeps saved positions and default positions when nothing is placed yet', () => {
      expect(placeFieldRects([field(1), field(2, 9700, 9944)], {}, bounds)).toEqual([
        { id: 1, x: 9700, y: 9700, width: 560, height: 220 },
        { id: 2, x: 9700, y: 9944, width: 560, height: 220 },
      ]);
      expect(placeFieldRects([field(1)], { 1: { x: 40, y: 40 } }, bounds)[0]).toMatchObject({ x: 40, y: 40 });
    });

    it('places a field without a position next to the placed fields instead of the workspace centre (#903)', () => {
      const [placed, added, second] = placeFieldRects(
        [field(1), field(2), field(3)],
        { 1: { x: 40, y: 40 } },
        bounds,
      );
      expect(added).toMatchObject({ x: 40 + 560 + FIELD_PLACEMENT_SPACING, y: 40 });
      const rects: Rect[] = [placed, added, second];
      rects.forEach((rect, index) => rects.slice(index + 1).forEach((other) => {
        expect(rectsOverlap(rect, other)).toBe(false);
      }));
      expect(Math.max(...rects.map((rect) => rect.x + rect.width))).toBeLessThan(3000);
      expect(Math.max(...rects.map((rect) => rect.y + rect.height))).toBeLessThan(3000);
    });
  });
});
