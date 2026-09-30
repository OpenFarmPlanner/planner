import { useId } from 'react';
import { Box, Chip, MenuItem, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

import { useTranslation } from '../../../i18n';
import {
  DATE_FILTER_FIELDS,
  PLANTING_PLAN_SORT_KEYS,
  withMonthRange,
  type FilterOption,
  type MonthRange,
  type PlantingPlanSortKey,
} from '../../../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';
import { TypeaheadSelect } from '../../inputs/TypeaheadSelect';
import { MONTH_KEYS } from './months';

interface PlantingPlanFilterFieldsProps {
  search: PlantingPlanSearchControls;
  /** The mobile sheet shows the sort order first; the desktop grid sorts by column. */
  showSort?: boolean;
}

const fieldLabelSx: SxProps<Theme> = { mb: 0.75, fontWeight: 600 };

interface ChipGroupProps<T extends string | number> {
  label: string;
  options: readonly FilterOption<T>[];
  selected: readonly T[];
  onChange: (selected: T[]) => void;
  hint?: string;
}

/** A multi-select as toggle chips; selected values combine with OR. */
function ChipGroup<T extends string | number>({ label, options, selected, onChange, hint }: ChipGroupProps<T>) {
  const labelId = useId();
  const toggle = (value: T): void => {
    onChange(selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value]);
  };

  return (
    <Box role="group" aria-labelledby={labelId}>
      <Typography id={labelId} variant="body2" component="div" sx={fieldLabelSx}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <Chip
              key={String(option.value)}
              label={option.label}
              size="small"
              clickable
              color={isSelected ? 'primary' : 'default'}
              variant={isSelected ? 'filled' : 'outlined'}
              icon={isSelected ? <CheckIcon fontSize="small" /> : undefined}
              aria-pressed={isSelected}
              onClick={() => toggle(option.value)}
              sx={{ maxWidth: '100%' }}
            />
          );
        })}
        {options.length === 0 ? (
          <Typography variant="body2" color="text.disabled" aria-hidden="true">—</Typography>
        ) : null}
      </Box>
      {hint ? (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

interface MonthRangeFieldProps {
  label: string;
  range: MonthRange;
  onChange: (range: MonthRange) => void;
}

/** A month-from / month-to pair for one plan date (planting, harvest start, harvest end). */
function MonthRangeField({ label, range, onChange }: MonthRangeFieldProps) {
  const { t } = useTranslation(['plantingPlans', 'common']);
  const labelId = useId();
  const toMonth = (value: unknown): number | null => (typeof value === 'number' ? value : null);
  const renderMonth = (placeholder: string) => (value: number | '') => (value === '' ? (
    <Box component="span" sx={{ color: 'text.secondary' }}>{placeholder}</Box>
  ) : t(`common:months.${MONTH_KEYS[value - 1]}`));
  const monthItems = MONTH_KEYS.map((key, index) => (
    <MenuItem key={key} value={index + 1}>{t(`common:months.${key}`)}</MenuItem>
  ));
  const fromPlaceholder = t('plantingPlans:search.monthFrom');
  const toPlaceholder = t('plantingPlans:search.monthTo');

  return (
    <Box role="group" aria-labelledby={labelId}>
      <Typography id={labelId} variant="body2" component="div" sx={fieldLabelSx}>
        {label}
      </Typography>
      <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center' }}>
        <TypeaheadSelect<number | ''>
          size="small"
          displayEmpty
          value={range.from ?? ''}
          onChange={(event) => onChange({ ...range, from: toMonth(event.target.value) })}
          renderValue={renderMonth(fromPlaceholder)}
          labelId={labelId}
          sx={{ flex: '1 1 0', minWidth: 0 }}
        >
          <MenuItem value="">{fromPlaceholder}</MenuItem>
          {monthItems}
        </TypeaheadSelect>
        <Typography variant="body2" color="text.secondary">
          {t('plantingPlans:search.monthRangeSeparator')}
        </Typography>
        <TypeaheadSelect<number | ''>
          size="small"
          displayEmpty
          value={range.to ?? ''}
          onChange={(event) => onChange({ ...range, to: toMonth(event.target.value) })}
          renderValue={renderMonth(toPlaceholder)}
          labelId={labelId}
          sx={{ flex: '1 1 0', minWidth: 0 }}
        >
          <MenuItem value="">{toPlaceholder}</MenuItem>
          {monthItems}
        </TypeaheadSelect>
      </Stack>
    </Box>
  );
}

/**
 * Every filter field of the planting-plan search, shared by the desktop
 * filter popover and the mobile bottom sheet. Filters apply immediately.
 */
export function PlantingPlanFilterFields({ search, showSort = false }: PlantingPlanFilterFieldsProps) {
  const { t } = useTranslation(['plantingPlans', 'common']);
  const sortLabelId = useId();
  const { filters, options, setFilters, setLocationIds } = search;

  return (
    <Stack spacing={2.5}>
      {showSort ? (
        <Box>
          <Typography id={sortLabelId} variant="body2" component="div" sx={fieldLabelSx}>
            {t('plantingPlans:search.fields.sort')}
          </Typography>
          <TypeaheadSelect<PlantingPlanSortKey>
            size="small"
            fullWidth
            value={search.sortKey}
            onChange={(event) => search.setSortKey(event.target.value as PlantingPlanSortKey)}
            labelId={sortLabelId}
          >
            {PLANTING_PLAN_SORT_KEYS.map((sortKey) => (
              <MenuItem key={sortKey} value={sortKey}>{t(`plantingPlans:search.sortOptions.${sortKey}`)}</MenuItem>
            ))}
          </TypeaheadSelect>
        </Box>
      ) : null}
      <ChipGroup
        label={t('plantingPlans:search.fields.location')}
        options={options.locations}
        selected={filters.locationIds}
        onChange={setLocationIds}
      />
      <ChipGroup
        label={t('plantingPlans:search.fields.field')}
        options={options.fields}
        selected={filters.fieldIds}
        onChange={(fieldIds) => setFilters({ ...filters, fieldIds })}
        hint={filters.locationIds.length === 0 ? t('plantingPlans:search.fieldHint') : undefined}
      />
      <ChipGroup
        label={t('plantingPlans:search.fields.cultivationType')}
        options={options.cultivationTypes}
        selected={filters.cultivationTypes}
        onChange={(cultivationTypes) => setFilters({ ...filters, cultivationTypes })}
      />
      <ChipGroup
        label={t('plantingPlans:search.fields.crop')}
        options={options.crops}
        selected={filters.cropKeys}
        onChange={(cropKeys) => setFilters({ ...filters, cropKeys })}
      />
      {DATE_FILTER_FIELDS.map((field) => (
        <MonthRangeField
          key={field}
          label={t(`plantingPlans:search.fields.${field}`)}
          range={filters.monthRanges[field]}
          onChange={(range) => setFilters(withMonthRange(filters, field, range))}
        />
      ))}
    </Stack>
  );
}
