import { createContext, useContext } from 'react';

const NO_TERMS: readonly string[] = [];

/**
 * The normalized terms of the active page search. Cells and cards read them
 * from here instead of receiving them as props, so a new query re-renders
 * only the highlighted texts and never rebuilds grid column definitions.
 */
export const SearchHighlightContext = createContext<readonly string[]>(NO_TERMS);

export function useSearchHighlightTerms(): readonly string[] {
  return useContext(SearchHighlightContext);
}
