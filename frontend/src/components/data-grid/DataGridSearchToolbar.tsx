import { useId, type ReactNode, type Ref, type RefObject } from 'react';
import { Badge, Box, Button, Divider, Popover, Stack, Typography } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

import { PageSearchField } from '../../search/PageSearchField';
import { ColumnsPanelButton } from './ColumnsPanelButton';

export interface DataGridSearchToolbarLabels {
  searchPlaceholder: string;
  searchAriaLabel: string;
  searchClear: string;
  filterButton: string;
  /** Accessible name of the Filter button while filters are active. */
  filterButtonActiveAria?: string;
  filterPanelTitle: string;
  resetFilters: string;
  /** "12 matches" under the filter fields. */
  matches: string;
  columnsButton?: string;
}

export interface DataGridSearchToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClearQuery: () => void;
  searchInputRef?: Ref<HTMLInputElement>;
  filterButtonRef: RefObject<HTMLButtonElement | null>;
  isFilterPanelOpen: boolean;
  onFilterPanelOpenChange: (open: boolean) => void;
  activeFilterCount: number;
  hasFilters: boolean;
  onResetFilters: () => void;
  /** The domain's filter fields, rendered inside the filter popover. */
  filterFields: ReactNode;
  labels: DataGridSearchToolbarLabels;
  /** Hit count shown at the far end of the row. */
  count?: ReactNode;
  /** Active-filter chips shown below the row. */
  activeFilterChips?: ReactNode;
  /** Opt-in: only tables that pass both props get a "Columns" button next to Filter. */
  columnsPanelOpen?: boolean;
  onColumnsPanelOpenChange?: (open: boolean) => void;
  /** Anchors the columns panel to this button. */
  columnsButtonRef?: Ref<HTMLButtonElement>;
  testId?: string;
  viewControls?: ReactNode;
}

/**
 * The Search / Filter / Columns bar placed directly above a grid inside its
 * card (never in the topbar, which is kept for the app-wide search). Domain
 * pages supply the filter fields, chips and count; the interaction pattern
 * stays the same everywhere (see docs/search.md).
 */
export function DataGridSearchToolbar({
  query,
  onQueryChange,
  onClearQuery,
  searchInputRef,
  filterButtonRef,
  isFilterPanelOpen,
  onFilterPanelOpenChange,
  activeFilterCount,
  hasFilters,
  onResetFilters,
  filterFields,
  labels,
  count,
  activeFilterChips,
  columnsPanelOpen,
  onColumnsPanelOpenChange,
  columnsButtonRef,
  testId,
  viewControls,
}: DataGridSearchToolbarProps) {
  const panelId = useId();
  const panelTitleId = useId();

  return (
    <Box sx={{ mb: 1 }} data-testid={testId}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <PageSearchField
          value={query}
          onChange={onQueryChange}
          onClear={onClearQuery}
          placeholder={labels.searchPlaceholder}
          ariaLabel={labels.searchAriaLabel}
          clearLabel={labels.searchClear}
          inputRef={searchInputRef}
          shortcutHint="/"
          sx={{ width: viewControls ? { xs: 272, lg: 340 } : 340, maxWidth: '100%' }}
        />
        <Badge
          color="primary"
          badgeContent={activeFilterCount}
          invisible={activeFilterCount === 0}
          overlap="rectangular"
        >
          <Button
            ref={filterButtonRef}
            variant="outlined"
            color={activeFilterCount > 0 ? 'primary' : 'inherit'}
            startIcon={<FilterListIcon fontSize="small" />}
            aria-haspopup="dialog"
            aria-expanded={isFilterPanelOpen}
            aria-controls={isFilterPanelOpen ? panelId : undefined}
            aria-label={activeFilterCount > 0 ? labels.filterButtonActiveAria : undefined}
            onClick={() => onFilterPanelOpenChange(!isFilterPanelOpen)}
            sx={{ minHeight: 40 }}
          >
            {labels.filterButton}
          </Button>
        </Badge>
        {columnsPanelOpen !== undefined && onColumnsPanelOpenChange && labels.columnsButton ? (
          <ColumnsPanelButton
            ref={columnsButtonRef}
            open={columnsPanelOpen}
            onOpenChange={onColumnsPanelOpenChange}
            label={labels.columnsButton}
          />
        ) : null}
        {viewControls}
        {count ? <Box sx={{ ml: 'auto', pl: 1 }}>{count}</Box> : null}
      </Box>
      {hasFilters && activeFilterChips ? <Box sx={{ mt: 1 }}>{activeFilterChips}</Box> : null}

      <Popover
        open={isFilterPanelOpen}
        anchorEl={() => filterButtonRef.current as HTMLButtonElement}
        onClose={() => onFilterPanelOpenChange(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            id: panelId,
            role: 'dialog',
            'aria-labelledby': panelTitleId,
            sx: { mt: 0.5, width: 420, maxWidth: 'calc(100vw - 32px)', display: 'flex', flexDirection: 'column' },
          },
        }}
      >
        <Typography id={panelTitleId} variant="subtitle1" component="h2" sx={{ px: 2, pt: 1.5, pb: 1 }}>
          {labels.filterPanelTitle}
        </Typography>
        <Box sx={{ px: 2, pb: 2, overflowY: 'auto' }}>
          {filterFields}
        </Box>
        <Divider />
        <Stack direction="row" sx={{ px: 1, py: 1, alignItems: 'center', justifyContent: 'space-between' }}>
          <Button onClick={onResetFilters} disabled={!hasFilters}>
            {labels.resetFilters}
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ pr: 1 }}>
            {labels.matches}
          </Typography>
        </Stack>
      </Popover>
    </Box>
  );
}
