import type { ReactElement } from 'react';
import { MenuItem } from '@mui/material';
import { useTranslation } from '../../i18n';
import { FilterNumberField } from '../../components/filters/FilterNumberField';
import { FilterPopoverShell } from '../../components/filters/FilterPopoverShell';
import { FilterSelectField } from '../../components/filters/FilterSelectField';
import type { PublicCropFilterOptions, PublicCropFilterState } from '../publicCropFilters';
import { buildPlantFamilyFilterOptions, usePlantFamilies } from '../../crops/plantFamilies';

interface PublicCropFiltersPopoverProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  filters: PublicCropFilterState;
  onFilterChange: <K extends keyof PublicCropFilterState>(key: K, value: PublicCropFilterState[K]) => void;
  options: PublicCropFilterOptions;
  onReset: () => void;
}

const FULL_WIDTH_ROW = { gridColumn: '1 / -1' } as const;

/**
 * Advanced-filters popover for public crop data (crop family, variety,
 * cultivation type, nutrient demand, growth duration, expected yield).
 * Shares its chrome with CropFiltersPopover (the private crop
 * selector's filter popover) via FilterPopoverShell, and is itself shared
 * between the full public crop library page and the "import from library"
 * dialog so both filter the same way.
 */
export function PublicCropFiltersPopover({
  anchorEl,
  onClose,
  filters,
  onFilterChange,
  options,
  onReset,
}: PublicCropFiltersPopoverProps): ReactElement {
  const { t, i18n } = useTranslation('crops');
  const plantFamilies = usePlantFamilies();

  const nutrientLabel = (value: string): string => {
    if (value === 'low') return t('filters.nutrientLow');
    if (value === 'medium') return t('filters.nutrientMedium');
    if (value === 'high') return t('filters.nutrientHigh');
    return value;
  };

  return (
    <FilterPopoverShell
      id="public-crop-filters-popover"
      anchorEl={anchorEl}
      onClose={onClose}
      onReset={onReset}
      resetLabel={t('filters.reset')}
    >
      <FilterSelectField
        id="public-crop-family-filter"
        label={t('filters.cropFamily')}
        value={filters.cropFamily}
        onChange={(event) => onFilterChange('cropFamily', event.target.value as string)}
        sx={FULL_WIDTH_ROW}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        {buildPlantFamilyFilterOptions(options.cropFamilyOptions, plantFamilies, i18n?.resolvedLanguage).map((family) => (
          <MenuItem key={family.value} value={family.value}>{family.label}</MenuItem>
        ))}
      </FilterSelectField>
      <FilterSelectField
        id="public-crop-variety-filter"
        label={t('library.filters.variety')}
        value={filters.variety}
        onChange={(event) => onFilterChange('variety', event.target.value as string)}
        sx={FULL_WIDTH_ROW}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        {options.varietyOptions.map((variety) => (
          <MenuItem key={variety} value={variety}>{variety}</MenuItem>
        ))}
      </FilterSelectField>
      <FilterSelectField
        id="public-crop-cultivation-filter"
        label={t('filters.cultivationType')}
        value={filters.cultivationType}
        onChange={(event) => onFilterChange('cultivationType', event.target.value as PublicCropFilterState['cultivationType'])}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        <MenuItem value="direct_sowing">{t('filters.directSowing')}</MenuItem>
        <MenuItem value="pre_cultivation">{t('filters.preCultivation')}</MenuItem>
        <MenuItem value="both">{t('filters.both')}</MenuItem>
      </FilterSelectField>
      <FilterSelectField
        id="public-crop-nutrient-filter"
        label={t('filters.nutrientDemand')}
        value={filters.nutrientDemand}
        onChange={(event) => onFilterChange('nutrientDemand', event.target.value as string)}
      >
        <MenuItem value="">{t('filters.all')}</MenuItem>
        {options.nutrientOptions.map((option) => (
          <MenuItem key={option} value={option}>{nutrientLabel(option)}</MenuItem>
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
