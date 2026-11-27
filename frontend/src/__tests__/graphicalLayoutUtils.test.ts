import { describe, expect, it } from 'vitest';
import { rotateRect, rotateRectBetweenSizes, turnRotation, type GraphicalRotation } from '../pages/graphicalLayoutUtils';
import { arrangeFieldRects, areaToRectSize, clampInsideBoundary, clampInsideParent, findFreePlacementPosition, getBedRectSize, getBedRectSizeWithinField, getBedScaleFromField, getFieldRectSize, getLocationBoundaryRect, initialAutoLayout, isRectOutsideBoundary, placeFieldRects, rectsOverlap, FIELD_PLACEMENT_SPACING, type Rect } from '../pages/graphicalLayoutUtils';

describe('graphicalLayoutUtils', () => {
  it('retains the minimum side in the legacy storage frame', () => {
    const enlarged = { length_m: 10, width_m: 1, area_sqm: 10 };
    expect(getFieldRectSize(enlarged, 18)).toEqual({ width: 72, height: 720 });
  });

  it('rotates positions and dimensions clockwise through all four orientations', () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    const parent = { width: 200, height: 100 };
    expect(rotateRect(rect, parent, 0)).toEqual(rect);
    expect(rotateRect(rect, parent, 90)).toEqual({ x: 40, y: 10, width: 40, height: 30 });
    expect(rotateRect(rect, parent, 180)).toEqual({ x: 160, y: 40, width: 30, height: 40 });
    expect(rotateRect(rect, parent, 270)).toEqual({ x: 20, y: 160, width: 40, height: 30 });
    expect(turnRotation(270, 1)).toBe(0);
    expect(turnRotation(0, -1)).toBe(270);
  });

  it.each<GraphicalRotation>([0, 90, 180, 270])('preserves stored positions after displaying and dragging at %s degrees', rotation => {
    const source = { width: 340, height: 676 };
    const target = rotation % 180 ? { width: 700, height: 316 } : source;
    const rect = { id: 100, x: 20, y: 36, width: 68, height: 169 };
    const displayed = rotateRectBetweenSizes(rect, source, target, rotation);
    expect(displayed.id).toBe(100);
    expect(displayed.x).toBeGreaterThanOrEqual(0);
    expect(displayed.y).toBeGreaterThanOrEqual(0);
    expect(displayed.x + displayed.width).toBeLessThanOrEqual(target.width);
    expect(displayed.y + displayed.height).toBeLessThanOrEqual(target.height);
    const stored = rotateRectBetweenSizes(displayed, target, source, ((360 - rotation) % 360) as GraphicalRotation);
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(stored[key]).toBeCloseTo(rect[key]);
  });

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


describe('compact schematic field arrangement', () => {
  const sizes = [{ width: 180, height: 360 }, { width: 432, height: 180 }, { width: 144, height: 144 }];
  it.each([0.6, 1, 2.5])('packs mixed proportions without overlaps at aspect %s', aspect => {
    const original = structuredClone(sizes);
    const result = arrangeFieldRects(sizes, aspect);
    expect(result).toEqual(arrangeFieldRects(sizes, aspect));
    expect(sizes).toEqual(original);
    const rects = sizes.map((size, index) => ({ ...size, ...result.positions[index] }));
    for (const [index, rect] of rects.entries()) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(result.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(result.height);
      for (const other of rects.slice(index + 1)) {
        expect(rectsOverlap(rect, other, FIELD_PLACEMENT_SPACING)).toBe(false);
      }
    }
  });
  it('uses more of a wide viewport than the old vertical stack', () => {
    const result = arrangeFieldRects(sizes, 2.5);
    const oldHeight = sizes.reduce((sum, size) => sum + size.height, 0) + 2 * FIELD_PLACEMENT_SPACING;
    expect(Math.max(result.width / 2.5, result.height)).toBeLessThan(oldHeight);
  });
  it('handles empty locations, single fields and invalid aspect', () => {
    expect(arrangeFieldRects([], 2)).toEqual({ positions: [], width: 0, height: 0 });
    expect(arrangeFieldRects([sizes[0]], 2)).toEqual({ positions: [{ x: 0, y: 0 }], ...sizes[0] });
    expect(arrangeFieldRects(sizes, NaN)).toEqual(arrangeFieldRects(sizes, 1));
  });

  it('sizes a location boundary only when both dimensions are set (#1190)', () => {
    const origin = { x: 20, y: 30 };
    expect(getLocationBoundaryRect({ length_m: 50, width_m: 20 }, 18, origin)).toEqual({ x: 20, y: 30, width: 360, height: 900 });
    expect(getLocationBoundaryRect({ length_m: 50, width_m: null }, 18, origin)).toBeNull();
    expect(getLocationBoundaryRect({ length_m: undefined, width_m: 20 }, 18, origin)).toBeNull();
    expect(getLocationBoundaryRect({ length_m: 0, width_m: 20 }, 18, origin)).toBeNull();
  });

  it('flags a rect that crosses any side of the location boundary', () => {
    const boundary = { x: 0, y: 0, width: 100, height: 50 };
    expect(isRectOutsideBoundary({ x: 0, y: 0, width: 100, height: 50 }, boundary)).toBe(false);
    expect(isRectOutsideBoundary({ x: 90, y: 0, width: 11, height: 10 }, boundary)).toBe(true);
    expect(isRectOutsideBoundary({ x: 0, y: 45, width: 10, height: 6 }, boundary)).toBe(true);
    expect(isRectOutsideBoundary({ x: -1, y: 0, width: 10, height: 10 }, boundary)).toBe(true);
    expect(isRectOutsideBoundary({ x: 0, y: -1, width: 10, height: 10 }, boundary)).toBe(true);
  });

  describe('clampInsideBoundary', () => {
    const boundary = { x: 100, y: 200, width: 300, height: 400 };
    const size = { width: 100, height: 50 };

    it('keeps a position that already fits', () => {
      expect(clampInsideBoundary({ x: 150, y: 250 }, size, boundary)).toEqual({ x: 150, y: 250 });
    });

    it('moves a rect past any side to the nearest position inside', () => {
      expect(clampInsideBoundary({ x: 50, y: 250 }, size, boundary)).toEqual({ x: 100, y: 250 });
      expect(clampInsideBoundary({ x: 350, y: 250 }, size, boundary)).toEqual({ x: 300, y: 250 });
      expect(clampInsideBoundary({ x: 150, y: 0 }, size, boundary)).toEqual({ x: 150, y: 200 });
      expect(clampInsideBoundary({ x: 150, y: 590 }, size, boundary)).toEqual({ x: 150, y: 550 });
      expect(clampInsideBoundary({ x: -1e6, y: 1e6 }, size, boundary)).toEqual({ x: 100, y: 550 });
    });

    it('allows a rect exactly as large as the boundary only at its origin', () => {
      expect(clampInsideBoundary({ x: 120, y: 180 }, { width: 300, height: 400 }, boundary)).toEqual({ x: 100, y: 200 });
    });

    it('lets a rect larger than the boundary slide only while it still covers it', () => {
      const wide = { width: 500, height: 50 };
      // Allowed x range: [100 + 300 - 500, 100] = [-100, 100].
      expect(clampInsideBoundary({ x: 0, y: 250 }, wide, boundary)).toEqual({ x: 0, y: 250 });
      expect(clampInsideBoundary({ x: 150, y: 250 }, wide, boundary)).toEqual({ x: 100, y: 250 });
      expect(clampInsideBoundary({ x: -400, y: 250 }, wide, boundary)).toEqual({ x: -100, y: 250 });
      // The other axis still fits and is clamped normally.
      expect(clampInsideBoundary({ x: 0, y: 900 }, wide, boundary)).toEqual({ x: 0, y: 550 });
    });
  });
});
