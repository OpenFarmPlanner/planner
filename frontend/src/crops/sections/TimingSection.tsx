/**
 * TimingSection: Cultivation type, growth/harvest/propagation durations
 * @remarks Presentational, no internal state
 */
import { Box, Typography, FormControl, InputLabel, MenuItem, TextField, Checkbox, ListItemText } from '@mui/material';
import { fieldRowSx, smallFieldSx } from './styles.tsx';
import type { Crop, CultivationType } from '../../api/types';
import type { TFunction } from 'i18next';
import { DropdownAwareTooltip } from '../../components/DropdownAwareTooltip';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import { mergeVarietyFieldSx } from '../varietyValueAccent';
import { libraryPinSelectSx } from '../libraryFieldPin';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';

interface TimingSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function TimingSection({ formData, errors, onChange, t, getFieldTooltipProps, getFieldPinProps }: TimingSectionProps) {
  const selectedCultivationTypes = formData.cultivation_types?.length
    ? formData.cultivation_types
    : (formData.cultivation_type ? [formData.cultivation_type as CultivationType] : []);
  const isDirectSowingOnly = selectedCultivationTypes.length === 1 && selectedCultivationTypes[0] === 'direct_sowing';
  const cultivationTypeVariety = getFieldTooltipProps?.(['cultivation_types', 'cultivation_type']);
  const growthDurationVariety = getFieldTooltipProps?.('growth_duration_days', t('form.growthDurationDaysHelp'));
  const harvestDurationVariety = getFieldTooltipProps?.('harvest_duration_days', t('form.harvestDurationDaysHelp'));
  const propagationDurationVariety = getFieldTooltipProps?.(
    'propagation_duration_days',
    isDirectSowingOnly ? t('form.directSowingPropagationDisabledHelp') : t('form.propagationDurationDaysHelp'),
  );
  const cultivationTypePin = getFieldPinProps?.('cultivation_types');
  const growthDurationPin = getFieldPinProps?.('growth_duration_days');
  const harvestDurationPin = getFieldPinProps?.('harvest_duration_days');
  const propagationDurationPin = getFieldPinProps?.('propagation_duration_days');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 2 }}>{t('form.sectionTiming')}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ ...fieldRowSx, mb: 1 }}>
          <VarietyFieldTooltip tooltipTitle={cultivationTypeVariety?.tooltipTitle}>
            <FormControl sx={mergeVarietyFieldSx(smallFieldSx, cultivationTypeVariety?.sx, cultivationTypePin?.fieldSx)}>
              <InputLabel id="cultivation-type-label">{t('form.cultivationType')}</InputLabel>
              <Select
                fullWidth
                labelId="cultivation-type-label"
                multiple
                value={selectedCultivationTypes}
                label={t('form.cultivationType')}
                endAdornment={cultivationTypePin?.endAdornment}
                sx={cultivationTypePin ? libraryPinSelectSx : undefined}
                onChange={e => {
                  const values = (e.target.value as CultivationType[]).filter(Boolean);
                  onChange('cultivation_types', values);
                  onChange('cultivation_type', values[0] || 'pre_cultivation');
                  if (values.length === 1 && values[0] === 'direct_sowing') {
                    onChange('propagation_duration_days', 0);
                  }
                }}
                renderValue={(selected) => {
                  const values = selected as CultivationType[];
                  return values
                    .map((item) => item === 'pre_cultivation'
                      ? t('form.cultivationTypePreCultivation')
                      : t('form.cultivationTypeDirectSowing'))
                    .join(', ');
                }}
              >
                <MenuItem value="pre_cultivation">
                  <Checkbox checked={selectedCultivationTypes.includes('pre_cultivation')} />
                  <ListItemText primary={t('form.cultivationTypePreCultivation')} />
                </MenuItem>
                <MenuItem value="direct_sowing">
                  <Checkbox checked={selectedCultivationTypes.includes('direct_sowing')} />
                  <ListItemText primary={t('form.cultivationTypeDirectSowing')} />
                </MenuItem>
              </Select>
            </FormControl>
          </VarietyFieldTooltip>
        </Box>
        <Box sx={{ ...fieldRowSx, alignItems: 'flex-end' }}>
          <DropdownAwareTooltip title={growthDurationVariety?.tooltipTitle ?? t('form.growthDurationDaysHelp')} arrow>
            <TextField
              sx={mergeVarietyFieldSx(smallFieldSx, growthDurationVariety?.sx, growthDurationPin?.fieldSx)}
              type="number"
              label={t('form.growthDurationDays')}
              placeholder={t('form.growthDurationDaysPlaceholder')}
              value={formData.growth_duration_days ?? ''}
              onChange={e => onChange('growth_duration_days', e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
              error={Boolean(errors.growth_duration_days)}
              helperText={errors.growth_duration_days}
              slotProps={{
                htmlInput: { min: 1, step: 1, inputMode: 'numeric' },
                input: { endAdornment: growthDurationPin?.endAdornment },
              }}
            />
          </DropdownAwareTooltip>
          <DropdownAwareTooltip title={harvestDurationVariety?.tooltipTitle ?? t('form.harvestDurationDaysHelp')} arrow>
            <TextField
              sx={mergeVarietyFieldSx(smallFieldSx, harvestDurationVariety?.sx, harvestDurationPin?.fieldSx)}
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
          <DropdownAwareTooltip
            title={propagationDurationVariety?.tooltipTitle
              ?? (isDirectSowingOnly
                ? t('form.directSowingPropagationDisabledHelp')
                : t('form.propagationDurationDaysHelp'))}
            arrow
          >
            <TextField
              sx={mergeVarietyFieldSx(smallFieldSx, propagationDurationVariety?.sx, propagationDurationPin?.fieldSx)}
              type="number"
              label={t('form.propagationDurationDays')}
              value={isDirectSowingOnly ? 0 : (formData.propagation_duration_days ?? '')}
              onChange={e => onChange('propagation_duration_days', e.target.value ? parseInt(e.target.value) : undefined)}
              disabled={isDirectSowingOnly}
              error={Boolean(errors.propagation_duration_days) || ((formData.propagation_duration_days ?? 0) > (formData.growth_duration_days ?? 0))}
              helperText={
                errors.propagation_duration_days
                  || ((formData.propagation_duration_days ?? 0) > (formData.growth_duration_days ?? 0)
                    ? t('form.propagationDurationDaysTooLong')
                    : undefined)
              }
              slotProps={{
                htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
                input: { endAdornment: isDirectSowingOnly ? undefined : propagationDurationPin?.endAdornment },
              }}
            />
          </DropdownAwareTooltip>
        </Box>
      </Box>
    </>
  );
}
