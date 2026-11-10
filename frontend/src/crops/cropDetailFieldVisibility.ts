/**
 * The crop detail read view hides unset values by default so the populated
 * ones are easy to scan; a per-browser "show all details" preference brings
 * the missing values and their placeholders back. Edit mode is not affected.
 */
import { useCallback, useState } from 'react';

const SHOW_ALL_FIELDS_STORAGE_KEY = 'ofp.crops.detail.showAllFields';

/**
 * Whether a value counts as filled in: null, undefined, blank strings and
 * empty arrays/objects are missing; `0` and `false` are meaningful values.
 */
export function hasDetailValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function readShowAllCropDetailFields(): boolean {
  try {
    return window.localStorage.getItem(SHOW_ALL_FIELDS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function storeShowAllCropDetailFields(showAll: boolean): void {
  try {
    window.localStorage.setItem(SHOW_ALL_FIELDS_STORAGE_KEY, String(showAll));
  } catch {
    // Storage may be unavailable (private mode); the choice then only lives for this visit.
  }
}

export function useShowAllCropDetailFields(): [boolean, (showAll: boolean) => void] {
  const [showAll, setShowAllState] = useState(readShowAllCropDetailFields);
  const setShowAll = useCallback((next: boolean) => {
    setShowAllState(next);
    storeShowAllCropDetailFields(next);
  }, []);
  return [showAll, setShowAll];
}

export const CROP_DETAIL_SHOW_ALL_FIELDS_STORAGE_KEY = SHOW_ALL_FIELDS_STORAGE_KEY;
