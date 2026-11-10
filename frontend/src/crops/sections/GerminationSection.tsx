import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { Alert, Box, Checkbox, FormControl, InputLabel, ListItemText, MenuItem, TextField, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import type { Crop, GerminationType } from '../../api/types';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { libraryPinSelectSx } from '../libraryFieldPin';
import { mergeVarietyFieldSx } from '../varietyValueAccent';
import { GERMINATION_NUMBER_FIELDS, GERMINATION_TYPES, propagationShorterThanGermination } from '../germination';
import { formGridCaptionedGroupSx, formGridDoubleColumnSx, formGridFieldSx, formGridSx, formRangeInputsSx } from './styles';

type NumericField = typeof GERMINATION_NUMBER_FIELDS[number];

interface Props {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function GerminationSection({ formData, errors, onChange, t, getFieldTooltipProps, getFieldPinProps }: Props) {
  const numberInput = (field: NumericField) => {
    const source = getFieldTooltipProps?.(field);
    const pin = getFieldPinProps?.(field);
    const days = field.includes('days');
    const label = field === 'germination_temperature_min_c' ? undefined
      : t(field.endsWith('_min_c') || field.endsWith('_min') ? 'germination.from' : 'germination.to');
    const props = {
      sx: mergeVarietyFieldSx(formGridFieldSx, source?.sx, pin?.fieldSx),
      label, value: formData[field] ?? '', error: Boolean(errors[field]), helperText: errors[field],
      slotProps: {
        htmlInput: { 'aria-label': t(`germination.fields.${field}`), ...(days ? { min: 0, step: 1, inputMode: 'numeric' as const } : {}) },
        input: { endAdornment: pin?.endAdornment },
      },
    };
    return (
      <VarietyFieldTooltip key={field} tooltipTitle={source?.tooltipTitle}>
        {days ? <TextField {...props} type="number"
          onChange={(event) => onChange(field, event.target.value === '' ? null : Number(event.target.value))} />
          : <LocalizedDecimalField {...props} onValueChange={(value) => onChange(field, value)} />}
      </VarietyFieldTooltip>
    );
  };
  const typesSource = getFieldTooltipProps?.('germination_types');
  const typesPin = getFieldPinProps?.('germination_types');
  const treatmentSource = getFieldTooltipProps?.('germination_pretreatment');
  const treatmentPin = getFieldPinProps?.('germination_pretreatment');
  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('germination.title')}</Typography>
      <Box sx={formGridSx}>
        <Box sx={formGridCaptionedGroupSx}>
          <Typography variant="body2" sx={{ mb: 1 }}>{t('germination.optimalTemperature')}</Typography>
          <Box sx={formRangeInputsSx}>
            {numberInput('germination_temperature_optimal_min_c')}{numberInput('germination_temperature_optimal_max_c')}
          </Box>
        </Box>
        <Box sx={formGridCaptionedGroupSx}>
          <Typography variant="body2" sx={{ mb: 1 }}>{t('germination.days')}</Typography>
          <Box sx={formRangeInputsSx}>
            {numberInput('germination_days_min')}{numberInput('germination_days_max')}
          </Box>
        </Box>
        <Box sx={formGridCaptionedGroupSx}>
          <Typography variant="body2" sx={{ mb: 1 }}>{t('germination.fields.germination_temperature_min_c')}</Typography>
          {numberInput('germination_temperature_min_c')}
        </Box>
        <VarietyFieldTooltip tooltipTitle={typesSource?.tooltipTitle}>
          <FormControl sx={mergeVarietyFieldSx(formGridFieldSx, typesSource?.sx, typesPin?.fieldSx)}>
            <InputLabel id="germination-types-label">{t('germination.fields.germination_types')}</InputLabel>
            <Select labelId="germination-types-label" label={t('germination.fields.germination_types')} multiple
              value={formData.germination_types ?? []} endAdornment={typesPin?.endAdornment}
              sx={typesPin ? libraryPinSelectSx : undefined}
              onChange={(event) => onChange('germination_types', event.target.value as GerminationType[])}
              renderValue={(values) => (values as GerminationType[]).map((kind) => t(`germination.types.${kind}`)).join(', ')}>
              {GERMINATION_TYPES.map((kind) => <MenuItem key={kind} value={kind}><Checkbox checked={formData.germination_types?.includes(kind) ?? false} /><ListItemText primary={t(`germination.types.${kind}`)} /></MenuItem>)}
            </Select>
          </FormControl>
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={treatmentSource?.tooltipTitle}>
          <TextField sx={mergeVarietyFieldSx(formGridDoubleColumnSx, treatmentSource?.sx, treatmentPin?.fieldSx)}
            label={t('germination.fields.germination_pretreatment')} multiline minRows={2}
            value={formData.germination_pretreatment ?? ''} onChange={(event) => onChange('germination_pretreatment', event.target.value)}
            slotProps={{ input: { endAdornment: treatmentPin?.endAdornment } }} />
        </VarietyFieldTooltip>
      </Box>
      {propagationShorterThanGermination(formData) ? <Alert severity="info">{t('germination.propagationShort')}</Alert> : null}
    </>
  );
}
