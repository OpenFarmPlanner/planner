import type { Crop } from '../api/types';

export const SEED_TYPE_OPTIONS = [
  { value: 'open_pollinated', labelKey: 'form.seedTypeOpenPollinated' },
  { value: 'f1_hybrid', labelKey: 'form.seedTypeF1Hybrid' },
] as const;

export const SEED_TYPE_UNKNOWN_LABEL_KEY = 'form.seedTypeUnknown';

/** Filter value for Sorten without a seed type; a blank filter means "all". */
export const SEED_TYPE_UNKNOWN_FILTER = 'unknown';

/** Localized label of a stored seed type; blank is "unknown", not a third type. */
export function getSeedTypeLabel(value: unknown, t: (key: string) => string): string {
  const option = SEED_TYPE_OPTIONS.find((candidate) => candidate.value === value);
  return t(option?.labelKey ?? SEED_TYPE_UNKNOWN_LABEL_KEY);
}

/**
 * Seed type is a trait of a Sorte, so a row without a variety never matches an
 * active filter; the Kultur row of a matching Sorte is restored by the group
 * handling in `filterCropGroupsForSearch`.
 */
export function matchesSeedTypeFilter(
  crop: Pick<Crop, 'variety' | 'seed_type'>,
  filter: string,
): boolean {
  if (!filter) {
    return true;
  }
  if (!(crop.variety ?? '').trim()) {
    return false;
  }
  return filter === SEED_TYPE_UNKNOWN_FILTER ? !crop.seed_type : crop.seed_type === filter;
}
