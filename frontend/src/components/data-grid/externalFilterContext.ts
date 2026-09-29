import { createContext } from 'react';
import type { GridRowId } from '@mui/x-data-grid';

export interface ExternalFilterContextValue {
  onOpenFilterPanel: () => void;
  highlightedNoteRowIds?: ReadonlySet<GridRowId>;
}

/**
 * Carries the page-owned filter's callbacks to the column menu and the notes
 * cells. A context instead of column props, so a new search never rebuilds
 * the grid's column definitions or its `slots`.
 */
export const ExternalFilterContext = createContext<ExternalFilterContextValue | null>(null);

