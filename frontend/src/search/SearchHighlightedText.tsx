import type { ReactElement, ReactNode } from 'react';
import { Box } from '@mui/material';

import { findMatchRanges } from './searchText';
import { useSearchHighlightTerms } from './SearchHighlightContext';
import { searchMarkSx, visuallyHiddenSx } from './searchStyles';

interface SearchHighlightedTextProps {
  text: string;
  /** Normalized terms; defaults to the active page search. */
  terms?: readonly string[];
}

/**
 * Renders `text` with every search hit wrapped in a yellow `<mark>`, also in
 * the middle of a word. Screen readers get the text in one piece from a
 * visually hidden copy, so the marks never split what is read out.
 */
export function SearchHighlightedText({ text, terms }: SearchHighlightedTextProps): ReactElement {
  const contextTerms = useSearchHighlightTerms();
  const ranges = findMatchRanges(text, terms ?? contextTerms);
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push(text.slice(cursor, range.start));
    }
    segments.push(
      <Box component="mark" key={range.start} sx={searchMarkSx}>
        {text.slice(range.start, range.end)}
      </Box>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }

  return (
    <>
      <span aria-hidden="true">{segments}</span>
      <Box component="span" sx={visuallyHiddenSx}>{text}</Box>
    </>
  );
}
