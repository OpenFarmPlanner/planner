import type { BedSuggestion } from '../../../api/types';

/** Beds that can take the plan in its period (the save check's capacity rule). */
export const getBedsWithRoom = (results: readonly BedSuggestion[]): BedSuggestion[] => (
  results.filter((suggestion) => suggestion.has_enough_area)
);

/**
 * The beds "Anbaufläche ändern" suggests: enough free area in the period and
 * no rotation conflict, best fit first (the backend's order).
 */
export const getMatchingBeds = (results: readonly BedSuggestion[]): BedSuggestion[] => (
  getBedsWithRoom(results).filter((suggestion) => suggestion.status !== 'conflict')
);
