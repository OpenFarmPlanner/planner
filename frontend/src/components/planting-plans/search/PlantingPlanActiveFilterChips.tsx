import type { SxProps, Theme } from '@mui/material';

import { ActiveFilterChips } from '../../filters/ActiveFilterChips';

import { useTranslation } from '../../../i18n';
import {
  DATE_FILTER_FIELDS,
  OCCUPANCY_FILTER_OPTIONS,
  TIMING_FILTER_OPTIONS,
  ROTATION_FILTER_STATUSES,
  type DateFilterField,
  type FilterOption,
  type PlantingPlanFilterGroup,
} from '../../../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';
import { MONTH_KEYS } from './months';

interface ActiveFilterChip {
  group: PlantingPlanFilterGroup;
  filterLabel: string;
  label: string;
}

const joinLabels = <T extends string | number>(options: readonly FilterOption<T>[], selected: readonly T[]): string =>
  selected
    .map((value) => options.find((option) => option.value === value)?.label)
    .filter((label): label is string => Boolean(label))
    .join(', ');

const isDateFilterField = (group: PlantingPlanFilterGroup): group is DateFilterField =>
  (DATE_FILTER_FIELDS as readonly string[]).includes(group);

function useActiveFilterChips(search: PlantingPlanSearchControls): ActiveFilterChip[] {
  const { t } = useTranslation(['plantingPlans', 'common']);
  const { filters, options } = search;
  const monthLabel = (month: number): string => t(`common:monthsShort.${MONTH_KEYS[month - 1]}`);
  const rotationOptions = ROTATION_FILTER_STATUSES.map((status) => ({
    value: status,
    label: t(`plantingPlans:search.rotationOptions.${status}`),
  }));

  const occupancyOptions = OCCUPANCY_FILTER_OPTIONS.map((option) => ({
    value: option,
    label: t(`plantingPlans:search.occupancyOptions.${option}`),
  }));
  const timingOptions = TIMING_FILTER_OPTIONS.map((option) => ({
    value: option,
    label: t(`plantingPlans:search.timingOptions.${option}`),
  }));

  return search.activeFilterGroups.map((group) => {
    if (isDateFilterField(group)) {
      const { from, to } = filters.monthRanges[group];
      const filterLabel = t(`plantingPlans:search.chipDateLabels.${group}`);
      let label: string;
      if (from !== null && to !== null) {
        label = t('plantingPlans:search.chipMonthRange.range', { filter: filterLabel, from: monthLabel(from), to: monthLabel(to) });
      } else if (from !== null) {
        label = t('plantingPlans:search.chipMonthRange.from', { filter: filterLabel, from: monthLabel(from) });
      } else {
        label = t('plantingPlans:search.chipMonthRange.to', { filter: filterLabel, to: monthLabel(to as number) });
      }
      return { group, filterLabel, label };
    }
    const byGroup = {
      location: { key: 'location', values: joinLabels(options.locations, filters.locationIds) },
      field: { key: 'field', values: joinLabels(options.fields, filters.fieldIds) },
      cultivationType: { key: 'cultivationType', values: joinLabels(options.cultivationTypes, filters.cultivationTypes) },
      crop: { key: 'crop', values: joinLabels(options.crops, filters.cropKeys) },
      rotation: { key: 'rotation', values: joinLabels(rotationOptions, filters.rotationStatuses) },
      occupancy: { key: 'occupancy', values: joinLabels(occupancyOptions, filters.occupancy) },
      timing: { key: 'timing', values: joinLabels(timingOptions, filters.timing) },
    } as const;
    const { key, values } = byGroup[group];
    const filterLabel = t(`plantingPlans:search.fields.${key}`);
    return { group, filterLabel, label: t('plantingPlans:search.chip', { filter: filterLabel, values }) };
  });
}

interface PlantingPlanActiveFilterChipsProps {
  search: PlantingPlanSearchControls;
  /** Mobile keeps the chips on one horizontally scrolling line. */
  scrollable?: boolean;
  sx?: SxProps<Theme>;
}

/** The active filters as removable chips, plus "Alle zurücksetzen". Renders nothing without filters. */
export function PlantingPlanActiveFilterChips({ search, scrollable = false, sx }: PlantingPlanActiveFilterChipsProps) {
  const { t } = useTranslation('plantingPlans');
  const chips = useActiveFilterChips(search);

  return (
    <ActiveFilterChips
      chips={chips.map((chip) => ({ key: chip.group, filterLabel: chip.filterLabel, label: chip.label }))}
      onRemove={(group) => search.clearFilterGroup(group as PlantingPlanFilterGroup)}
      onResetAll={search.resetFilters}
      groupAriaLabel={t('search.activeFiltersAria')}
      resetAllLabel={t('search.resetAll')}
      removeAriaLabel={(filter) => t('search.removeChip', { filter })}
      scrollable={scrollable}
      sx={sx}
    />
  );
}
