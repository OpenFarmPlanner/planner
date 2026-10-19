import type { HierarchyRow } from './types';

const isEmptyHierarchyDraftValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  return false;
};

export const isCompletelyEmptyNewHierarchyRow = (row: HierarchyRow): boolean => {
  if (!row.isNew) {
    return false;
  }

  return (
    isEmptyHierarchyDraftValue(row.name) &&
    isEmptyHierarchyDraftValue(row.area_sqm) &&
    isEmptyHierarchyDraftValue(row.length_m) &&
    isEmptyHierarchyDraftValue(row.width_m) &&
    isEmptyHierarchyDraftValue(row.notes)
  );
};

const normalizeDraftValue = (value: unknown): string => (
  value === null || value === undefined ? '' : String(value).trim().replace(',', '.')
);

const sameDraftNumber = (value: unknown, expected: number | null | undefined): boolean => {
  const normalized = normalizeDraftValue(value);
  const expectedNormalized = normalizeDraftValue(expected);
  if (normalized === '' || expectedNormalized === '') {
    return normalized === expectedNormalized;
  }
  return Number(normalized) === Number(expectedNormalized);
};

/**
 * True while a new row still holds exactly the values it was prefilled with
 * ("Beet hinzufügen" after an existing bed) — the user has entered nothing.
 */
export const matchesHierarchyRowPrefill = (
  row: HierarchyRow,
  prefill: { name: string; length_m?: number | null; width_m?: number | null },
): boolean => (
  Boolean(row.isNew)
  && normalizeDraftValue(row.name) === prefill.name.trim()
  && sameDraftNumber(row.length_m, prefill.length_m)
  && sameDraftNumber(row.width_m, prefill.width_m)
  && isEmptyHierarchyDraftValue(row.notes)
);

export const isPartiallyFilledNamelessNewHierarchyRow = (row: HierarchyRow): boolean => (
  Boolean(row.isNew) &&
  isEmptyHierarchyDraftValue(row.name) &&
  !isCompletelyEmptyNewHierarchyRow(row)
);
