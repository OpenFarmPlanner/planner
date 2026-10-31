import type { ReactElement } from 'react';
import { MenuItem } from '@mui/material';

import { useTranslation } from '../i18n';
import type { PersistedCropFilters } from './cropDetailFormatters';
import { buildPlantFamilyFilterOptions, usePlantFamilies } from './plantFamilies';
import { FilterNumberField } from '../components/filters/FilterNumberField';
import { FilterPopoverShell } from '../components/filters/FilterPopoverShell';
import { FilterSelectField } from '../components/filters/FilterSelectField';

const FULL_WIDTH_ROW = { gridColumn: '1 / -1' } as const;

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
  /** The project's groups ("Gruppen"). */
  tagOptions: string[];
  supplierOptions: Array<{ id: string; name: string }>;
  /** Clears all filters and closes the popover — handled by the parent. */
  onReset: () => void;
}

/**
 * Presentational advanced-filters popover for the crop selector
 * (family, group, cultivation type, nutrient demand, supplier, growth days,
 * yield). All filter state lives in CropDetail.tsx.
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
        <FilterSelectField
          id="crop-tag-filter"
          label={t('filters.tag')}
          value={filters.selectedTagFilter}
          onChange={(event) => onFilterChange('selectedTagFilter', event.target.value as string)}
          sx={FULL_WIDTH_ROW}
        >
          <MenuItem value="">{t('filters.all')}</MenuItem>
          {tagOptions.map((tag) => (
            <MenuItem key={tag} value={tag}>{tag}</MenuItem>
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
