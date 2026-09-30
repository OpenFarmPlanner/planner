import { Box, Chip, IconButton, Link } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import { useTranslation } from '../../../i18n';
import {
  DATE_FILTER_FIELDS,
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
  if (chips.length === 0) {
    return null;
  }

  return (
    <Box
      role="group"
      aria-label={t('search.activeFiltersAria')}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexWrap: scrollable ? 'nowrap' : 'wrap',
          overflowX: scrollable ? 'auto' : 'visible',
          scrollbarWidth: scrollable ? 'none' : undefined,
          py: 0.25,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {chips.map((chip) => (
        <Chip
          key={chip.group}
          size={scrollable ? 'medium' : 'small'}
          color="primary"
          variant="outlined"
          sx={{ flexShrink: 0, maxWidth: scrollable ? 'none' : '100%', pr: 0.25 }}
          label={(
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chip.label}</Box>
              <IconButton
                size="small"
                aria-label={t('search.removeChip', { filter: chip.filterLabel })}
                onClick={() => search.clearFilterGroup(chip.group)}
                sx={{ p: scrollable ? 0.5 : 0.25, mr: -0.5, color: 'inherit' }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          )}
        />
      ))}
      <Link
        component="button"
        type="button"
        variant="body2"
        onClick={search.resetFilters}
        sx={{ flexShrink: 0, whiteSpace: 'nowrap', ml: 0.5, minHeight: scrollable ? 32 : undefined }}
      >
        {t('search.resetAll')}
      </Link>
    </Box>
  );
}
