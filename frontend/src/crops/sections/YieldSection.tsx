/**
 * YieldSection: yield unit and expected yield (the harvest duration sits in
 * TimingSection).
 * @remarks Presentational, no internal state
 */
import { Box, Typography, FormControl, InputLabel, MenuItem } from '@mui/material';
import type { Crop } from '../../api/types';
import type { TFunction } from 'i18next';
import { formGridFieldSx, formGridSx } from './styles.tsx';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import { libraryPinSelectSx } from '../libraryFieldPin';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';

interface YieldSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function YieldSection({ formData, errors, onChange, t, getFieldHighlightSx, getFieldPinProps }: YieldSectionProps) {
  const harvestMethodPin = getFieldPinProps?.('harvest_method');
  const expectedYieldPin = getFieldPinProps?.('expected_yield');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('form.sectionYield')}</Typography>
      <Box sx={formGridSx}>
        <FormControl
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('harvest_method'), harvestMethodPin?.fieldSx)}
          error={Boolean(errors.harvest_method)}
        >
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
        <LocalizedDecimalField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('expected_yield'), expectedYieldPin?.fieldSx)}
          label={formData.harvest_method === 'per_plant'
            ? t('form.expectedYieldPerPlant')
            : formData.harvest_method === 'per_sqm' ? t('form.expectedYieldPerSqm') : t('form.expectedYield')}
          placeholder={t('form.expectedYieldPlaceholder')}
          value={formData.expected_yield}
          onValueChange={(value) => onChange('expected_yield', value ?? undefined)}
          error={Boolean(errors.expected_yield)}
          // The number only means something with its unit; say where to set it.
          helperText={errors.expected_yield
            ?? (formData.harvest_method ? undefined : t('form.expectedYieldChooseUnit'))}
          slotProps={{ input: { endAdornment: expectedYieldPin?.endAdornment } }}
        />
      </Box>
    </>
  );
}
