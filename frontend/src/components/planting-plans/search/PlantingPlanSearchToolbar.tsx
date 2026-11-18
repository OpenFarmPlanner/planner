import type { Ref, RefObject } from 'react';

import { useTranslation } from '../../../i18n';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';
import { DataGridSearchToolbar } from '../../data-grid/DataGridSearchToolbar';
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
 * Desktop search and filter bar of the planting plans, built on the shared
 * `DataGridSearchToolbar`.
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
  const activeGroupCount = search.activeFilterGroups.length;

  return (
    <DataGridSearchToolbar
      testId="planting-plan-search-toolbar"
      query={search.query}
      onQueryChange={search.setQuery}
      onClearQuery={search.clearSearch}
      searchInputRef={searchInputRef}
      filterButtonRef={filterButtonRef}
      isFilterPanelOpen={isFilterPanelOpen}
      onFilterPanelOpenChange={onFilterPanelOpenChange}
      activeFilterCount={activeGroupCount}
      hasFilters={search.hasFilters}
      onResetFilters={search.resetFilters}
      filterFields={<PlantingPlanFilterFields search={search} />}
      labels={{
        searchPlaceholder: t('search.placeholderDesktop'),
        searchAriaLabel: t('search.ariaLabel'),
        searchClear: t('search.clear'),
        filterButton: t('search.filterButton'),
        filterButtonActiveAria: t('search.filterButtonActiveAria', { count: activeGroupCount }),
        filterPanelTitle: t('search.panelTitle'),
        resetFilters: t('search.reset'),
        matches: t('search.matches', { count: search.shownCount }),
        columnsButton: t('search.columnsButton'),
      }}
      count={<PlantingPlanSearchCount search={search} variant="desktop" />}
      activeFilterChips={<PlantingPlanActiveFilterChips search={search} />}
      columnsPanelOpen={columnsPanelOpen}
      onColumnsPanelOpenChange={onColumnsPanelOpenChange}
      columnsButtonRef={columnsButtonRef}
    />
  );
}
