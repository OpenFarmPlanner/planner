/**
 * HarvestSection: harvest duration, yield unit and expected yield
 * @remarks Presentational, no internal state
 */
import { Box, Typography, FormControl, InputLabel, MenuItem, TextField } from '@mui/material';
import type { Crop } from '../../api/types';
import type { TFunction } from 'i18next';
import { formGridFieldSx, formGridSx } from './styles.tsx';
import { DropdownAwareTooltip } from '../../components/DropdownAwareTooltip';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import { mergeVarietyFieldSx } from '../varietyValueAccent';
import { libraryPinSelectSx } from '../libraryFieldPin';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';

interface HarvestSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function HarvestSection({ formData, errors, onChange, t, getFieldTooltipProps, getFieldPinProps }: HarvestSectionProps) {
  const harvestDurationVariety = getFieldTooltipProps?.('harvest_duration_days', t('form.harvestDurationDaysHelp'));
  const harvestDurationPin = getFieldPinProps?.('harvest_duration_days');
  const harvestMethodVariety = getFieldTooltipProps?.('harvest_method');
  const expectedYieldVariety = getFieldTooltipProps?.('expected_yield');
  const harvestMethodPin = getFieldPinProps?.('harvest_method');
  const expectedYieldPin = getFieldPinProps?.('expected_yield');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('form.sectionHarvest')}</Typography>
      <Box sx={formGridSx}>
        <DropdownAwareTooltip title={harvestDurationVariety?.tooltipTitle ?? t('form.harvestDurationDaysHelp')} arrow>
          <TextField
            sx={mergeVarietyFieldSx(formGridFieldSx, harvestDurationVariety?.sx, harvestDurationPin?.fieldSx)}
            type="number"
            label={t('form.harvestDurationDays')}
            placeholder={t('form.harvestDurationDaysPlaceholder')}
            value={formData.harvest_duration_days ?? ''}
            onChange={e => onChange('harvest_duration_days', e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
            error={Boolean(errors.harvest_duration_days)}
            helperText={errors.harvest_duration_days}
            slotProps={{
              htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
              input: { endAdornment: harvestDurationPin?.endAdornment },
            }}
          />
        </DropdownAwareTooltip>
        <VarietyFieldTooltip tooltipTitle={harvestMethodVariety?.tooltipTitle}>
          <FormControl sx={mergeVarietyFieldSx(formGridFieldSx, harvestMethodVariety?.sx, harvestMethodPin?.fieldSx)} error={Boolean(errors.harvest_method)}>
            <InputLabel>{t('form.yieldUnit')}</InputLabel>
            <Select
              fullWidth
              value={formData.harvest_method || ''}
              onChange={e => onChange('harvest_method', e.target.value)}
              label={t('form.yieldUnit')}
              endAdornment={harvestMethodPin?.endAdornment}
              sx={harvestMethodPin ? libraryPinSelectSx : undefined}
            >
              <MenuItem value="">{t('noData')}</MenuItem>
              <MenuItem value="per_plant">{t('form.yieldUnitPerPlant')}</MenuItem>
              <MenuItem value="per_sqm">{t('form.yieldUnitPerSqm')}</MenuItem>
            </Select>
            {errors.harvest_method && (
              <Typography variant="caption" color="error">{t('form.yieldUnitRequired')}</Typography>
            )}
          </FormControl>
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={expectedYieldVariety?.tooltipTitle}>
          <LocalizedDecimalField
            sx={mergeVarietyFieldSx(formGridFieldSx, expectedYieldVariety?.sx, expectedYieldPin?.fieldSx)}
            label={t('form.expectedYieldWithUnit', { defaultValue: `${t('form.expectedYield')} (${t('form.expectedYieldUnit')})` })}
            placeholder={t('form.expectedYieldPlaceholder')}
            value={formData.expected_yield}
            onValueChange={(value) => onChange('expected_yield', value ?? undefined)}
            error={Boolean(errors.expected_yield)}
            helperText={errors.expected_yield}
            slotProps={{ input: { endAdornment: expectedYieldPin?.endAdornment } }}
          />
        </VarietyFieldTooltip>
      </Box>
    </>
  );
}
