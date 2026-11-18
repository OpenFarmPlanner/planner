import { describe, expect, it } from 'vitest';
import type { HierarchyRow } from '../components/hierarchy/utils/types';
import {
  calculateAreaValue,
  getDimensionRowState,
  isDimensionCellIncomplete,
} from '../components/hierarchy/utils/dimensionCellState';

const row = (overrides: Partial<HierarchyRow>): HierarchyRow =>
  (({
    id: 1,
    level: 0,
    type: 'bed',
    ...overrides
  }) as HierarchyRow);

describe('calculateAreaValue', () => {
  it('gives a location its gross area only from both dimensions', () => {
    expect(calculateAreaValue(row({ type: 'location', area_sqm: 5 }))).toBeUndefined();
    expect(calculateAreaValue(row({ type: 'location', length_m: 40 }))).toBeUndefined();
    expect(calculateAreaValue(row({ type: 'location', length_m: 42.5, width_m: 18.4 }))).toBe(782);
  });

  it('multiplies length and width, rounded to one decimal', () => {
    expect(calculateAreaValue(row({ length_m: 2.5, width_m: 1.33 }))).toBe(3.3);
  });

  it('falls back to the stored area when a dimension is missing', () => {
    expect(calculateAreaValue(row({ length_m: 2, area_sqm: 9 }))).toBe(9);
  });
});

describe('getDimensionRowState', () => {
  it('returns null for location rows', () => {
    expect(getDimensionRowState(row({ type: 'location' }))).toBeNull();
  });

  it('reports which dimensions are present, parsing string values', () => {
    expect(getDimensionRowState(row({ length_m: 2, width_m: null, area_sqm: '3,5' }))).toEqual({
      hasLength: true,
      hasWidth: false,
      hasAreaValue: true,
    });
  });
});

describe('isDimensionCellIncomplete', () => {
  const state = (over: Partial<ReturnType<typeof getDimensionRowState>>) => ({
    hasLength: false,
    hasWidth: false,
    hasAreaValue: false,
    ...over,
  });

  it('flags an empty length cell', () => {
    expect(isDimensionCellIncomplete('length', state({ hasLength: false }))).toBe(true);
    expect(isDimensionCellIncomplete('length', state({ hasLength: true }))).toBe(false);
  });

  it('treats the area cell as complete when a stored area exists', () => {
    expect(isDimensionCellIncomplete('area', state({ hasAreaValue: true }))).toBe(false);
  });

  it('treats the area cell as complete when both length and width exist', () => {
    expect(isDimensionCellIncomplete('area', state({ hasLength: true, hasWidth: true }))).toBe(false);
  });

  it('flags the area cell when neither an area nor a full length/width pair exists', () => {
    expect(isDimensionCellIncomplete('area', state({ hasLength: true }))).toBe(true);
  });
});
