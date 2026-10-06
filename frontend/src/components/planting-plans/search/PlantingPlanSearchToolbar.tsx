import { useId, type Ref, type RefObject } from 'react';
import { Badge, Box, Button, Divider, Popover, Stack, Typography } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

import { useTranslation } from '../../../i18n';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';
import { PageSearchField } from '../../../search/PageSearchField';
import { ColumnsPanelButton } from '../../data-grid/ColumnsPanelButton';
import { PlantingPlanActiveFilterChips } from './PlantingPlanActiveFilterChips';
import { PlantingPlanFilterFields } from './PlantingPlanFilterFields';
import { PlantingPlanSearchCount } from './PlantingPlanSearchCount';

interface PlantingPlanSearchToolbarProps {
  search: PlantingPlanSearchControls;
  searchInputRef: Ref<HTMLInputElement>;
  filterButtonRef: RefObject<HTMLButtonElement | null>;
  isFilterPanelOpen: boolean;
  onFilterPanelOpenChange: (open: boolean) => void;
  /** Opt-in: only tables that pass both props get a "Columns" button next to Filter. */
  columnsPanelOpen?: boolean;
  onColumnsPanelOpenChange?: (open: boolean) => void;
  /** Anchors the columns panel to this button; see `columnsPanelAnchorEl` on `EditableDataGrid`. */
  columnsButtonRef?: Ref<HTMLButtonElement>;
}

/**
 * Desktop search and filter bar, placed directly above the grid inside its
 * card (never in the topbar, which is kept for the app-wide search).
 */
export function PlantingPlanSearchToolbar({
  search,
  searchInputRef,
  filterButtonRef,
  isFilterPanelOpen,
  onFilterPanelOpenChange,
  columnsPanelOpen,
  onColumnsPanelOpenChange,
  columnsButtonRef,
}: PlantingPlanSearchToolbarProps) {
  const { t } = useTranslation('plantingPlans');
  const panelId = useId();
  const panelTitleId = useId();
  const activeGroupCount = search.activeFilterGroups.length;

  return (
    <Box sx={{ mb: 1 }} data-testid="planting-plan-search-toolbar">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <PageSearchField
          value={search.query}
          onChange={search.setQuery}
          onClear={search.clearSearch}
          placeholder={t('search.placeholderDesktop')}
          ariaLabel={t('search.ariaLabel')}
          clearLabel={t('search.clear')}
          inputRef={searchInputRef}
          shortcutHint="/"
          sx={{ width: 340, maxWidth: '100%' }}
        />
        <Badge
          color="primary"
          badgeContent={activeGroupCount}
          invisible={activeGroupCount === 0}
          overlap="rectangular"
        >
          <Button
            ref={filterButtonRef}
            variant="outlined"
            color={activeGroupCount > 0 ? 'primary' : 'inherit'}
            startIcon={<FilterListIcon fontSize="small" />}
            aria-haspopup="dialog"
            aria-expanded={isFilterPanelOpen}
            aria-controls={isFilterPanelOpen ? panelId : undefined}
            aria-label={activeGroupCount > 0
              ? t('search.filterButtonActiveAria', { count: activeGroupCount })
              : undefined}
            onClick={() => onFilterPanelOpenChange(!isFilterPanelOpen)}
            sx={{ minHeight: 40 }}
          >
            {t('search.filterButton')}
          </Button>
        </Badge>
        {columnsPanelOpen !== undefined && onColumnsPanelOpenChange ? (
          <ColumnsPanelButton
            ref={columnsButtonRef}
            open={columnsPanelOpen}
            onOpenChange={onColumnsPanelOpenChange}
            label={t('search.columnsButton')}
          />
        ) : null}
        <PlantingPlanSearchCount search={search} variant="desktop" sx={{ ml: 'auto', pl: 1 }} />
      </Box>
      {search.hasFilters ? <PlantingPlanActiveFilterChips search={search} sx={{ mt: 1 }} /> : null}

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
          {t('search.panelTitle')}
        </Typography>
        <Box sx={{ px: 2, pb: 2, overflowY: 'auto' }}>
          <PlantingPlanFilterFields search={search} />
        </Box>
        <Divider />
        <Stack direction="row" sx={{ px: 1, py: 1, alignItems: 'center', justifyContent: 'space-between' }}>
          <Button onClick={search.resetFilters} disabled={!search.hasFilters}>
            {t('search.reset')}
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ pr: 1 }}>
            {t('search.matches', { count: search.shownCount })}
          </Typography>
        </Stack>
      </Popover>
    </Box>
  );
}
