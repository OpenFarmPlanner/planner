/**
 * HarvestSection: yield unit and expected yield
 * @remarks Presentational, no internal state
 */
import { Box, Typography, FormControl, InputLabel, MenuItem } from '@mui/material';
import type { Crop } from '../../api/types';
import type { TFunction } from 'i18next';
import { fieldRowSx, smallFieldSx } from './styles.tsx';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import { mergeVarietyFieldSx } from '../varietyValueAccent';

interface HarvestSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
}

export function HarvestSection({ formData, errors, onChange, t, getFieldTooltipProps }: HarvestSectionProps) {
  const harvestMethodVariety = getFieldTooltipProps?.('harvest_method');
  const expectedYieldVariety = getFieldTooltipProps?.('expected_yield');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 2 }}>{t('form.sectionHarvest')}</Typography>
      <Box sx={fieldRowSx}>
        <VarietyFieldTooltip tooltipTitle={harvestMethodVariety?.tooltipTitle}>
          <FormControl sx={mergeVarietyFieldSx(smallFieldSx, harvestMethodVariety?.sx)} error={Boolean(errors.harvest_method)}>
            <InputLabel>{t('form.yieldUnit')}</InputLabel>
            <Select
              fullWidth
              value={formData.harvest_method || ''}
              onChange={e => onChange('harvest_method', e.target.value)}
              label={t('form.yieldUnit')}
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
            sx={mergeVarietyFieldSx(smallFieldSx, expectedYieldVariety?.sx)}
            label={t('form.expectedYieldWithUnit', { defaultValue: `${t('form.expectedYield')} (${t('form.expectedYieldUnit')})` })}
            placeholder={t('form.expectedYieldPlaceholder')}
            value={formData.expected_yield}
            onValueChange={(value) => onChange('expected_yield', value ?? undefined)}
            error={Boolean(errors.expected_yield)}
            helperText={errors.expected_yield}
          />
        </VarietyFieldTooltip>
      </Box>
    </>
  );
}
