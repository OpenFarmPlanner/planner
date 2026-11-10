import { Box, Typography, FormControl, InputLabel, MenuItem } from '@mui/material';
import type { Crop, SeedRateUnit, SeedRateUnitConstraints } from '../../api/types';
import type { TFunction } from 'i18next';
import { formGridFieldSx, formGridSx } from './styles.tsx';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { getSeedRateValueInputProps } from '../seedRateConstraints';
import { FieldInfoButton } from '../FieldInfoButton';
import { buildFieldEndAdornment } from '../fieldEndAdornment';

interface SeedingSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
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
  getFieldHighlightSx,
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
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  seedRateUnitConstraints?: Partial<SeedRateUnitConstraints> | null;
}) {
  const rateHighlightSx = getFieldHighlightSx?.([valueField, unitField]);
  const selectedUnit = toSeedRateUnitSelectValue(formData[unitField]);
  const valueInputProps = getSeedRateValueInputProps(selectedUnit || null, seedRateUnitConstraints);

  return (
    <>
      <Typography variant="subtitle1">{title}</Typography>
      <Box sx={formGridSx}>
        <LocalizedDecimalField
          sx={mergeVarietyFieldSx(formGridFieldSx, rateHighlightSx)}
          label={t('form.seedAmountLabel')}
          value={formData[valueField]}
          onValueChange={(value) => onChange(valueField, value)}
          error={Boolean(errors[valueField])}
          helperText={errors[valueField]}
          slotProps={{ htmlInput: valueInputProps }}
        />

        <FormControl sx={mergeVarietyFieldSx(formGridFieldSx, rateHighlightSx)} error={Boolean(errors[unitField])}>
          <InputLabel shrink>{t('form.seedUnitLabel')}</InputLabel>
          <Select
            fullWidth
            value={toSeedRateUnitSelectValue(formData[unitField])}
            label={t('form.seedUnitLabel')}
            onChange={(e) => onChange(unitField, (e.target.value || null) as Crop[typeof unitField])}
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

        {showSeedSafetyMargin && (
          <LocalizedDecimalField
            sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.(safetyField))}
            label={t('form.sowingCalculationSafetyPercentLabel')}
            value={formData[safetyField]}
            onValueChange={(value) => onChange(safetyField, value)}
            error={Boolean(errors[safetyField])}
            helperText={errors[safetyField]}
          />
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
  getFieldHighlightSx,
  getFieldPinProps,
  seedRateUnitConstraints,
  showSeedSafetyMargin = true,
}: SeedingSectionProps) {
  const cultivationTypes = formData.cultivation_types ?? (formData.cultivation_type ? [formData.cultivation_type] : []);
  const showsDirect = cultivationTypes.includes('direct_sowing');
  const showsPreCultivation = cultivationTypes.includes('pre_cultivation');
  const thousandKernelWeightPin = getFieldPinProps?.('thousand_kernel_weight_g');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('form.seedRateSectionTitle')}</Typography>

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
          getFieldHighlightSx={getFieldHighlightSx}
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
          getFieldHighlightSx={getFieldHighlightSx}
          seedRateUnitConstraints={seedRateUnitConstraints}
        />
      )}

      <Box sx={formGridSx}>
        <LocalizedDecimalField
          sx={mergeVarietyFieldSx(
            formGridFieldSx,
            getFieldHighlightSx?.('thousand_kernel_weight_g'),
            thousandKernelWeightPin?.fieldSx,
          )}
          label={t('form.thousandKernelWeightLabel')}
          value={formData.thousand_kernel_weight_g}
          onValueChange={(value) => onChange('thousand_kernel_weight_g', value ?? undefined)}
          error={Boolean(errors.thousand_kernel_weight_g)}
          helperText={errors.thousand_kernel_weight_g}
          slotProps={{
            input: {
              endAdornment: buildFieldEndAdornment(
                <FieldInfoButton
                  title={t('form.thousandKernelWeightHelp')}
                  ariaLabel={t('form.fieldInfoAriaLabel', { field: t('form.thousandKernelWeightLabel') })}
                />,
                thousandKernelWeightPin,
              ),
            },
          }}
        />
      </Box>

    </>
  );
}
