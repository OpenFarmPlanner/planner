import { useContext, type ComponentProps } from 'react';
import {
  GridColumnMenu,
  useGridRootProps,
  type GridColumnMenuItemProps,
  type GridColumnMenuProps,
  type GridRowId,
} from '@mui/x-data-grid';

import { ExternalFilterContext } from './externalFilterContext';
import { NotesCell } from './NotesCell';

/** The column menu's "Filter" entry, opening the page's filter panel instead of MUI's. */
function ExternalFilterColumnMenuItem({ colDef, onClick }: GridColumnMenuItemProps) {
  const context = useContext(ExternalFilterContext);
  const rootProps = useGridRootProps();
  if (!context || colDef.filterable === false) {
    return null;
  }
  const MenuItem = rootProps.slots.baseMenuItem;
  const FilterIcon = rootProps.slots.columnMenuFilterIcon;
  return (
    <MenuItem
      onClick={(event) => {
        onClick(event);
        context.onOpenFilterPanel();
      }}
      iconStart={<FilterIcon fontSize="small" />}
    >
      {rootProps.localeText.columnMenuFilter}
    </MenuItem>
  );
}

const EXTERNAL_FILTER_COLUMN_MENU_SLOTS = { columnMenuFilterItem: ExternalFilterColumnMenuItem };

export function ExternalFilterColumnMenu(props: GridColumnMenuProps) {
  return <GridColumnMenu {...props} slots={EXTERNAL_FILTER_COLUMN_MENU_SLOTS} />;
}

type HighlightableNotesCellProps = Omit<ComponentProps<typeof NotesCell>, 'highlighted'> & { rowId: GridRowId };

/** A notes cell that marks itself when its row matched the page search in the notes. */
export function HighlightableNotesCell({ rowId, ...props }: HighlightableNotesCellProps) {
  const context = useContext(ExternalFilterContext);
  return <NotesCell {...props} highlighted={Boolean(context?.highlightedNoteRowIds?.has(rowId))} />;
}
