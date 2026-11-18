// Pure dimension/area logic for the hierarchy grid: derives displayed area
// values and per-cell completeness state (used to highlight missing dimensions).

import type { HierarchyRow } from './types';

export type DimensionCellType = 'length' | 'width' | 'area';

export interface DimensionRowState {
  hasLength: boolean;
  hasWidth: boolean;
  hasAreaValue: boolean;
}

/** Computed area for a row: length × width (rounded to 0.1) when both are set,
 * otherwise the stored area value. A location has no stored area: its gross
 * area exists only when both optional dimensions do (#1190). */
export const calculateAreaValue = (row: HierarchyRow): number | string | undefined => {
  const length = typeof row.length_m === 'number' ? row.length_m : null;
  const width = typeof row.width_m === 'number' ? row.width_m : null;
  if (length !== null && width !== null) {
    return Math.round(length * width * 10) / 10;
  }

  return row.type === 'location' ? undefined : row.area_sqm;
};

const parseNumericValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseFloat(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

/** Which dimensions a field/bed row currently has. Returns null for row types
 * (e.g. locations) that do not carry dimensions. */
export const getDimensionRowState = (row: HierarchyRow): DimensionRowState | null => {
  if (row.type !== 'field' && row.type !== 'bed') {
    return null;
  }
  const lengthValue = parseNumericValue(row.length_m);
  const widthValue = parseNumericValue(row.width_m);
  const areaValue = parseNumericValue(row.area_sqm);
  return {
    hasLength: Number.isFinite(lengthValue ?? NaN),
    hasWidth: Number.isFinite(widthValue ?? NaN),
    hasAreaValue: Number.isFinite(areaValue ?? NaN),
  };
};

/** A dimension cell is incomplete when its own value is missing; the area cell
 * is complete if an area is stored or both length and width are present. */
export const isDimensionCellIncomplete = (type: DimensionCellType, rowState: DimensionRowState): boolean => {
  if (type === 'length') {
    return !rowState.hasLength;
  }
  if (type === 'width') {
    return !rowState.hasWidth;
  }
  return !(rowState.hasAreaValue || (rowState.hasLength && rowState.hasWidth));
};
