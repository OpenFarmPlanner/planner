import type { BedSuggestion } from '../../../api/types';

/** Beds that can take the plan in its period (the save check's capacity rule). */
export const getBedsWithRoom = (results: readonly BedSuggestion[]): BedSuggestion[] => (
  results.filter((suggestion) => suggestion.has_enough_area)
);
