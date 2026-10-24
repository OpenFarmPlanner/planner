import { useState } from 'react';
import { Box, Typography, FormControl, InputLabel, MenuItem } from '@mui/material';
import type { Crop, SeedRateUnit, SeedRateUnitConstraints } from '../../api/types';
import type { TFunction } from 'i18next';
import { compactFieldSx, fieldRowSx, mediumFieldSx, smallFieldSx } from './styles.tsx';
import { DropdownAwareTooltip } from '../../components/DropdownAwareTooltip';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import { mergeVarietyFieldSx } from '../varietyValueAccent';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { getSeedRateValueInputProps } from '../seedRateConstraints';

interface SeedingSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
  getFieldPinProps?: GetLibraryFieldPinProps;
  seedRateUnitConstraints?: Partial<SeedRateUnitConstraints> | null;
  /**
   * The seed safety margin is a farm-specific planning decision, so the public
   * crop library form hides it (mirrors `CropSeedDetails.showSeedSafetyMargin`).
   */
  showSeedSafetyMargin?: boolean;
}

const seedRateUnitOptions: Array<{ value: SeedRateUnit; labelKey: string }> = [
  { value: 'g_per_m2', labelKey: 'detail.seedUnits.gPerSqm' },
  { value: 'g_per_lfm', labelKey: 'detail.seedUnits.gPerRunningMeter' },
  { value: 'seeds_per_m2', labelKey: 'detail.seedUnits.seedsPerSqm' },
  { value: 'seeds_per_lfm', labelKey: 'detail.seedUnits.seedsPerRunningMeter' },
  { value: 'seeds_per_plant', labelKey: 'detail.seedUnits.seedsPerPlant' },
];

const toSeedRateUnitSelectValue = (value: unknown): SeedRateUnit | '' => {
  if (value === '-' || value === null || value === undefined || value === '') {
    return '';
  }
  return value as SeedRateUnit;
};

function SeedRateBlock({
  title,
  valueField,
  unitField,
  safetyField,
  showSeedSafetyMargin,
  formData,
  errors,
  onChange,
  t,
  getFieldTooltipProps,
  seedRateUnitConstraints,
}: {
  title: string;
  valueField: 'seed_rate_direct_value' | 'seed_rate_pre_cultivation_value';
  unitField: 'seed_rate_direct_unit' | 'seed_rate_pre_cultivation_unit';
  safetyField: 'sowing_calculation_safety_percent_direct' | 'sowing_calculation_safety_percent_pre_cultivation';
  showSeedSafetyMargin: boolean;
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
  seedRateUnitConstraints?: Partial<SeedRateUnitConstraints> | null;
}) {
  const [unitSelectOpen, setUnitSelectOpen] = useState(false);
  const rateVariety = getFieldTooltipProps?.([valueField, unitField], t('form.seedRateHelp'));
  const safetyVariety = getFieldTooltipProps?.(safetyField, t('form.sowingCalculationSafetyPercentHelp'));
  const selectedUnit = toSeedRateUnitSelectValue(formData[unitField]);
  const valueInputProps = getSeedRateValueInputProps(selectedUnit || null, seedRateUnitConstraints);

  return (
    <>
      <Typography variant="subtitle1" sx={{ mt: 2 }}>{title}</Typography>
      <Box sx={fieldRowSx}>
        <DropdownAwareTooltip title={rateVariety?.tooltipTitle ?? t('form.seedRateHelp')} arrow>
          <LocalizedDecimalField
            sx={mergeVarietyFieldSx(compactFieldSx, rateVariety?.sx)}
            label={t('form.seedAmountLabel')}
            value={formData[valueField]}
            onValueChange={(value) => onChange(valueField, value)}
            error={Boolean(errors[valueField])}
            helperText={errors[valueField]}
            slotProps={{ htmlInput: valueInputProps }}
          />
        </DropdownAwareTooltip>

        <DropdownAwareTooltip title={unitSelectOpen ? '' : (rateVariety?.tooltipTitle ?? t('form.seedRateHelp'))} arrow>
          <FormControl sx={mergeVarietyFieldSx(smallFieldSx, rateVariety?.sx)} error={Boolean(errors[unitField])}>
            <InputLabel shrink>{t('form.seedUnitLabel')}</InputLabel>
            <Select
              fullWidth
              value={toSeedRateUnitSelectValue(formData[unitField])}
              label={t('form.seedUnitLabel')}
              onChange={(e) => onChange(unitField, (e.target.value || null) as Crop[typeof unitField])}
              onOpen={() => setUnitSelectOpen(true)}
              onClose={() => setUnitSelectOpen(false)}
              renderValue={(selected) => {
                if (!selected) {
                  return (
                    <Typography component="span" color="text.secondary">
                      {t('form.seedUnitPlaceholder')}
                    </Typography>
                  );
                }
                const selectedOption = seedRateUnitOptions.find((option) => option.value === selected);
                return selectedOption ? t(selectedOption.labelKey) : '';
              }}
              displayEmpty
            >
              {seedRateUnitOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{t(option.labelKey)}</MenuItem>
              ))}
            </Select>
            {errors[unitField] && (
              <Typography variant="caption" color="error">{errors[unitField]}</Typography>
            )}
          </FormControl>
        </DropdownAwareTooltip>

        {showSeedSafetyMargin && (
          <DropdownAwareTooltip title={safetyVariety?.tooltipTitle ?? t('form.sowingCalculationSafetyPercentHelp')} arrow>
            <LocalizedDecimalField
              sx={mergeVarietyFieldSx(mediumFieldSx, safetyVariety?.sx)}
              label={t('form.sowingCalculationSafetyPercentLabel')}
              value={formData[safetyField]}
              onValueChange={(value) => onChange(safetyField, value)}
              error={Boolean(errors[safetyField])}
              helperText={errors[safetyField]}
            />
          </DropdownAwareTooltip>
        )}
      </Box>
    </>
  );
}

export function SeedingSection({
  formData,
  errors,
  onChange,
  t,
  getFieldTooltipProps,
  getFieldPinProps,
  seedRateUnitConstraints,
  showSeedSafetyMargin = true,
}: SeedingSectionProps) {
  const cultivationTypes = formData.cultivation_types ?? (formData.cultivation_type ? [formData.cultivation_type] : []);
  const showsDirect = cultivationTypes.includes('direct_sowing');
  const showsPreCultivation = cultivationTypes.includes('pre_cultivation');
  const thousandKernelWeightVariety = getFieldTooltipProps?.('thousand_kernel_weight_g', t('form.thousandKernelWeightHelp'));
  const thousandKernelWeightPin = getFieldPinProps?.('thousand_kernel_weight_g');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 2 }}>{t('form.seedRateSectionTitle')}</Typography>

      {showsDirect && (
        <SeedRateBlock
          title={t('form.seedRateDirectSectionTitle')}
          valueField="seed_rate_direct_value"
          unitField="seed_rate_direct_unit"
          safetyField="sowing_calculation_safety_percent_direct"
          showSeedSafetyMargin={showSeedSafetyMargin}
          formData={formData}
          errors={errors}
          onChange={onChange}
          t={t}
          getFieldTooltipProps={getFieldTooltipProps}
          seedRateUnitConstraints={seedRateUnitConstraints}
        />
      )}

      {showsPreCultivation && (
        <SeedRateBlock
          title={t('form.seedRatePreCultivationSectionTitle')}
          valueField="seed_rate_pre_cultivation_value"
          unitField="seed_rate_pre_cultivation_unit"
          safetyField="sowing_calculation_safety_percent_pre_cultivation"
          showSeedSafetyMargin={showSeedSafetyMargin}
          formData={formData}
          errors={errors}
          onChange={onChange}
          t={t}
          getFieldTooltipProps={getFieldTooltipProps}
          seedRateUnitConstraints={seedRateUnitConstraints}
        />
      )}

      <Box sx={fieldRowSx}>
        <DropdownAwareTooltip title={thousandKernelWeightVariety?.tooltipTitle ?? t('form.thousandKernelWeightHelp')} arrow>
          <LocalizedDecimalField
            sx={mergeVarietyFieldSx(smallFieldSx, thousandKernelWeightVariety?.sx, thousandKernelWeightPin?.fieldSx)}
            label={t('form.thousandKernelWeightLabel')}
            value={formData.thousand_kernel_weight_g}
            onValueChange={(value) => onChange('thousand_kernel_weight_g', value ?? undefined)}
            error={Boolean(errors.thousand_kernel_weight_g)}
            helperText={errors.thousand_kernel_weight_g || thousandKernelWeightPin?.helperText}
            slotProps={{ input: { endAdornment: thousandKernelWeightPin?.endAdornment } }}
          />
        </DropdownAwareTooltip>
      </Box>

    </>
  );
}
