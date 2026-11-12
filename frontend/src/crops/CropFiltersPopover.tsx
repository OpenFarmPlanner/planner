import type { ReactElement } from 'react';
import { Checkbox, ListItemText, MenuItem } from '@mui/material';

import { useTranslation } from '../i18n';
import type { PersistedCropFilters } from './cropDetailFormatters';
import { buildPlantFamilyFilterOptions, usePlantFamilies } from './plantFamilies';
import { FilterNumberField } from '../components/filters/FilterNumberField';
import { FilterPopoverShell } from '../components/filters/FilterPopoverShell';
import { FilterSelectField } from '../components/filters/FilterSelectField';
import { SEED_TYPE_OPTIONS, SEED_TYPE_UNKNOWN_FILTER, SEED_TYPE_UNKNOWN_LABEL_KEY } from './seedType';
import { normalizeCropTags } from './cropTags';

const FULL_WIDTH_ROW = { gridColumn: '1 / -1' } as const;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

interface CropFiltersPopoverProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  filters: PersistedCropFilters;
  onFilterChange: <K extends keyof PersistedCropFilters>(
    key: K,
    value: PersistedCropFilters[K],
  ) => void;
  /** Botanical names of the plant families present in the list. */
  familyOptions: string[];
  /** The project's tags. */
  tagOptions: string[];
  supplierOptions: Array<{ id: string; name: string }>;
  /** Clears all filters and closes the popover — handled by the parent. */
  onReset: () => void;
}

/**
 * Presentational advanced-filters popover for the crop selector
 * (family, tag, cultivation type, nutrient demand, seed type, supplier, growth days,
 * yield, sowing month). All filter state lives in CropDetail.tsx.
 */
export function CropFiltersPopover({
  anchorEl,
  onClose,
  filters,
  onFilterChange,
  familyOptions,
  tagOptions,
  supplierOptions,
  onReset,
}: CropFiltersPopoverProps): ReactElement {
  const { t, i18n } = useTranslation('crops');
  const plantFamilies = usePlantFamilies();
  const selectedTags = normalizeCropTags(filters.selectedTagFilter, tagOptions);

  return (
    <FilterPopoverShell
      id="crop-filters-popover"
      anchorEl={anchorEl}
      onClose={onClose}
      onReset={onReset}
      resetLabel={t('filters.reset')}
    >
      <FilterSelectField
        id="crop-family-filter"
        label={t('filters.cropFamily')}
        value={filters.selectedFamilyFilter}
        onChange={(event) => onFilterChange('selectedFamilyFilter', event.target.value as string)}
        sx={FULL_WIDTH_ROW}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        {buildPlantFamilyFilterOptions(familyOptions, plantFamilies, i18n?.resolvedLanguage).map((family) => (
          <MenuItem key={family.value} value={family.value}>{family.label}</MenuItem>
        ))}
      </FilterSelectField>
      {tagOptions.length > 0 ? (
        <FilterSelectField<string[]>
          id="crop-tag-filter"
          label={t('filters.tag')}
          multiple
          value={selectedTags}
          renderValue={(selected) => t('filters.tagsSelected', { count: selected.length })}
          onChange={(event) => {
            const value = event.target.value;
            const tags = typeof value === 'string' ? [value] : value;
            onFilterChange('selectedTagFilter', tags.includes('') ? [] : normalizeCropTags(tags, tagOptions));
          }}
          sx={FULL_WIDTH_ROW}
        >
          <MenuItem value="">{t('filters.clearSelection')}</MenuItem>
          {tagOptions.map((tag) => (
            <MenuItem key={tag} value={tag}>
              <Checkbox
                checked={selectedTags.includes(tag)}
                tabIndex={-1}
                size="small"
                slotProps={{ input: { 'aria-hidden': true } }}
              />
              <ListItemText
                primary={tag}
                slotProps={{ primary: { sx: { whiteSpace: 'normal', overflowWrap: 'anywhere' } } }}
              />
            </MenuItem>
          ))}
        </FilterSelectField>
      ) : null}
      <FilterSelectField
        id="crop-method-filter"
        label={t('filters.cultivationType')}
        value={filters.selectedCultivationFilter}
        onChange={(event) => onFilterChange('selectedCultivationFilter', event.target.value as PersistedCropFilters['selectedCultivationFilter'])}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        <MenuItem value="direct_sowing">{t('filters.directSowing')}</MenuItem>
        <MenuItem value="pre_cultivation">{t('filters.preCultivation')}</MenuItem>
        <MenuItem value="both">{t('filters.both')}</MenuItem>
      </FilterSelectField>
      <FilterSelectField
        id="crop-sowing-month-filter"
        label={t('filters.sowingMonth')}
        value={filters.sowingMonth}
        onChange={(event) => onFilterChange('sowingMonth', event.target.value as string)}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        {MONTH_KEYS.map((key, index) => (
          <MenuItem key={key} value={String(index + 1)}>{t(`common:months.${key}`)}</MenuItem>
        ))}
      </FilterSelectField>
      <FilterSelectField
        id="crop-nutrient-filter"
        label={t('filters.nutrientDemand')}
        value={filters.selectedNutrientFilter}
        onChange={(event) => onFilterChange('selectedNutrientFilter', event.target.value as PersistedCropFilters['selectedNutrientFilter'])}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        <MenuItem value="low">{t('filters.nutrientLow')}</MenuItem>
        <MenuItem value="medium">{t('filters.nutrientMedium')}</MenuItem>
        <MenuItem value="high">{t('filters.nutrientHigh')}</MenuItem>
      </FilterSelectField>
      <FilterSelectField
        id="crop-seed-type-filter"
        label={t('form.seedType')}
        value={filters.selectedSeedTypeFilter}
        onChange={(event) => onFilterChange('selectedSeedTypeFilter', event.target.value as string)}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        {SEED_TYPE_OPTIONS.map((option) => (
          <MenuItem key={option.value} value={option.value}>{t(option.labelKey)}</MenuItem>
        ))}
        <MenuItem value={SEED_TYPE_UNKNOWN_FILTER}>{t(SEED_TYPE_UNKNOWN_LABEL_KEY)}</MenuItem>
      </FilterSelectField>
      <FilterSelectField
        id="crop-supplier-filter"
        label={t('filters.supplier')}
        value={filters.selectedSupplierFilter}
        onChange={(event) => onFilterChange('selectedSupplierFilter', event.target.value as string)}
        sx={FULL_WIDTH_ROW}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        {supplierOptions.map((supplier) => (
          <MenuItem key={supplier.id} value={supplier.id}>{supplier.name}</MenuItem>
        ))}
      </FilterSelectField>
      <FilterNumberField
        label={t('filters.growthDaysMin')}
        value={filters.growthDaysMin}
        onValueChange={(value) => onFilterChange('growthDaysMin', value)}
        inputMode="numeric"
      />
      <FilterNumberField
        label={t('filters.growthDaysMax')}
        value={filters.growthDaysMax}
        onValueChange={(value) => onFilterChange('growthDaysMax', value)}
        inputMode="numeric"
      />
      <FilterNumberField
        label={t('filters.yieldMin')}
        value={filters.yieldMin}
        onValueChange={(value) => onFilterChange('yieldMin', value)}
        inputMode="decimal"
      />
      <FilterNumberField
        label={t('filters.yieldMax')}
        value={filters.yieldMax}
        onValueChange={(value) => onFilterChange('yieldMax', value)}
        inputMode="decimal"
      />
    </FilterPopoverShell>
  );
}
