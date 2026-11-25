import { useMemo, type ReactNode, type Ref, type RefObject } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { TFunction } from 'i18next';

import { useTranslation } from '../../../i18n';
import type { Field, Location } from '../../../api/types';
import { DataGridSearchToolbar } from '../../data-grid/DataGridSearchToolbar';
import { FilterChipGroup, type FilterChipOption } from '../../filters/FilterChipGroup';
import { ActiveFilterChips, type ActiveFilterChip } from '../../filters/ActiveFilterChips';
import type { GrowingAreaSearchControls } from '../hooks/useGrowingAreaSearch';
import { NOT_SPECIFIED_FILTER_VALUE, type GrowingAreaFilterGroup } from '../utils/growingAreaSearch';
import { INLINE_SITE_CONDITION_FIELDS, SITE_CONDITION_OPTIONS, type InlineSiteConditionField } from '../utils/siteConditions';
import {
  getSiteConditionFieldHelp,
  getSiteConditionFieldLabel,
  getSiteConditionValueLabel,
} from '../siteConditionLabels';

interface FilterOptions {
  locations: FilterChipOption<number>[];
  fields: FilterChipOption<number>[];
  conditions: Record<InlineSiteConditionField, FilterChipOption<string>[]>;
}

function useFilterOptions(
  search: GrowingAreaSearchControls,
  locations: readonly Location[],
  fields: readonly Field[],
): FilterOptions {
  const { t } = useTranslation(['hierarchy', 'locations']);
  const selectedLocations = search.filters.locationIds;
  return useMemo(() => {
    const persistedLocations = locations.filter((location) => typeof location.id === 'number' && location.id > 0);
    const locationNames = new Map(persistedLocations.map((location) => [location.id, location.name]));
    const offeredFields = fields.filter((field) => typeof field.id === 'number' && field.id > 0
      && (selectedLocations.length === 0 || selectedLocations.includes(field.location)));
    const nameCounts = new Map<string, number>();
    offeredFields.forEach((field) => nameCounts.set(field.name, (nameCounts.get(field.name) ?? 0) + 1));
    const conditions = {} as FilterOptions['conditions'];
    INLINE_SITE_CONDITION_FIELDS.forEach((field) => {
      conditions[field] = [
        ...SITE_CONDITION_OPTIONS[field].map((value) => ({ value, label: getSiteConditionValueLabel(t, field, value) })),
        { value: NOT_SPECIFIED_FILTER_VALUE, label: t('hierarchy:siteConditions.notSpecified') },
      ];
    });
    return {
      locations: persistedLocations.map((location) => ({ value: location.id!, label: location.name })),
      fields: offeredFields.map((field) => ({
        value: field.id!,
        label: (nameCounts.get(field.name) ?? 0) > 1
          ? `${field.name} (${locationNames.get(field.location) ?? ''})`
          : field.name,
      })),
      conditions,
    };
  }, [fields, locations, selectedLocations, t]);
}

function GrowingAreaFilterFields({ search, options }: { search: GrowingAreaSearchControls; options: FilterOptions }) {
  const { t } = useTranslation(['hierarchy']);
  const { filters, setFilters, setLocationIds } = search;
  return (
    <Stack spacing={2.5}>
      <FilterChipGroup
        label={t('hierarchy:search.fields.location')}
        options={options.locations}
        selected={filters.locationIds}
        onChange={setLocationIds}
      />
      <FilterChipGroup
        label={t('hierarchy:search.fields.field')}
        options={options.fields}
        selected={filters.fieldIds}
        onChange={(fieldIds) => setFilters({ ...filters, fieldIds })}
        hint={filters.locationIds.length === 0 && options.locations.length > 1 ? t('hierarchy:search.fieldHint') : undefined}
      />
      {INLINE_SITE_CONDITION_FIELDS.map((field) => (
        <FilterChipGroup
          key={field}
          label={getSiteConditionFieldLabel(t, field)}
          info={getSiteConditionFieldHelp(t, field)}
          options={options.conditions[field]}
          selected={filters[field]}
          onChange={(selected) => setFilters({ ...filters, [field]: selected })}
        />
      ))}
    </Stack>
  );
}

function groupLabel(t: TFunction, group: GrowingAreaFilterGroup): string {
  if (group === 'locationIds') return t('hierarchy:search.fields.location');
  if (group === 'fieldIds') return t('hierarchy:search.fields.field');
  return getSiteConditionFieldLabel(t, group);
}

function buildChips(t: TFunction, search: GrowingAreaSearchControls, options: FilterOptions): ActiveFilterChip[] {
  return search.activeFilterGroups.map((group) => {
    const groupOptions: FilterChipOption<string | number>[] = group === 'locationIds'
      ? options.locations
      : group === 'fieldIds' ? options.fields : options.conditions[group];
    const selected = search.filters[group] as (string | number)[];
    const values = selected
      .map((value) => groupOptions.find((option) => option.value === value)?.label)
      .filter((label): label is string => Boolean(label))
      .join(', ');
    const filterLabel = groupLabel(t, group);
    return { key: group, filterLabel, label: t('hierarchy:search.chip', { filter: filterLabel, values }) };
  });
}

interface GrowingAreaSearchToolbarProps {
  search: GrowingAreaSearchControls;
  locations: readonly Location[];
  fields: readonly Field[];
  filterButtonRef: RefObject<HTMLButtonElement | null>;
  isFilterPanelOpen: boolean;
  onFilterPanelOpenChange: (open: boolean) => void;
  searchInputRef?: Ref<HTMLInputElement>;
  columnsPanelOpen?: boolean;
  onColumnsPanelOpenChange?: (open: boolean) => void;
  columnsButtonRef?: Ref<HTMLButtonElement>;
  /** Extra page-level controls after Filter/Columns, e.g. rotation-group management. */
  viewControls?: ReactNode;
}

/** Search / Filter / Columns above the Growing Areas list. */
export function GrowingAreaSearchToolbar({
  search,
  locations,
  fields,
  filterButtonRef,
  isFilterPanelOpen,
  onFilterPanelOpenChange,
  searchInputRef,
  columnsPanelOpen,
  onColumnsPanelOpenChange,
  columnsButtonRef,
  viewControls,
}: GrowingAreaSearchToolbarProps) {
  const { t } = useTranslation(['hierarchy']);
  const options = useFilterOptions(search, locations, fields);
  const activeCount = search.activeFilterGroups.length;
  const countText = search.isActive
    ? t('hierarchy:search.filteredCount', { shown: search.matchCount, total: search.totalCount })
    : t('hierarchy:search.count', { count: search.totalCount });

  return (
    <DataGridSearchToolbar
      testId="growing-area-search-toolbar"
      query={search.query}
      onQueryChange={search.setQuery}
      onClearQuery={search.clearSearch}
      searchInputRef={searchInputRef}
      filterButtonRef={filterButtonRef}
      isFilterPanelOpen={isFilterPanelOpen}
      onFilterPanelOpenChange={onFilterPanelOpenChange}
      activeFilterCount={activeCount}
      hasFilters={search.hasFilters}
      onResetFilters={search.resetFilters}
      filterFields={<GrowingAreaFilterFields search={search} options={options} />}
      labels={{
        searchPlaceholder: t('hierarchy:search.placeholder'),
        searchAriaLabel: t('hierarchy:search.ariaLabel'),
        searchClear: t('hierarchy:search.clear'),
        filterButton: t('hierarchy:search.filterButton'),
        filterButtonActiveAria: t('hierarchy:search.filterButtonActiveAria', { count: activeCount }),
        filterPanelTitle: t('hierarchy:search.panelTitle'),
        resetFilters: t('hierarchy:search.reset'),
        matches: t('hierarchy:search.matches', { count: search.matchCount }),
        columnsButton: t('hierarchy:search.columnsButton'),
      }}
      count={(
        <Typography
          variant="body2"
          color="text.secondary"
          role="status"
          aria-live="polite"
          data-testid="growing-area-search-count"
          sx={{ whiteSpace: 'nowrap' }}
        >
          {countText}
        </Typography>
      )}
      activeFilterChips={(
        <ActiveFilterChips
          chips={buildChips(t, search, options)}
          onRemove={(key) => search.clearFilterGroup(key as GrowingAreaFilterGroup)}
          onResetAll={search.resetFilters}
          groupAriaLabel={t('hierarchy:search.activeFiltersAria')}
          resetAllLabel={t('hierarchy:search.resetAll')}
          removeAriaLabel={(filter) => t('hierarchy:search.removeChip', { filter })}
        />
      )}
      columnsPanelOpen={columnsPanelOpen}
      onColumnsPanelOpenChange={onColumnsPanelOpenChange}
      columnsButtonRef={columnsButtonRef}
      viewControls={viewControls}
    />
  );
}

/** Shown in place of the list when search and filters match nothing. */
export function GrowingAreaSearchEmptyState({ search }: { search: GrowingAreaSearchControls }) {
  const { t } = useTranslation(['hierarchy']);
  const trimmedQuery = search.query.trim();
  return (
    <Box data-testid="growing-area-search-empty" sx={{ py: { xs: 4, md: 6 }, px: 2, textAlign: 'center' }}>
      <Typography variant="h6" component="h2" sx={{ mb: 1, overflowWrap: 'anywhere' }}>
        {trimmedQuery
          ? t('hierarchy:search.empty.titleWithQuery', { query: trimmedQuery })
          : t('hierarchy:search.empty.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('hierarchy:search.empty.hint')}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing={1} sx={{ justifyContent: 'center' }}>
        {search.query ? (
          <Button variant="outlined" onClick={search.clearSearch}>{t('hierarchy:search.empty.clearSearch')}</Button>
        ) : null}
        {search.hasFilters ? (
          <Button variant="contained" onClick={search.resetFilters}>{t('hierarchy:search.empty.resetFilters')}</Button>
        ) : null}
      </Stack>
    </Box>
  );
}
