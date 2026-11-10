import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { RangeField } from '../../components/inputs/RangeField';
import { Alert, Box, Checkbox, FormControl, InputLabel, ListItemText, MenuItem, TextField, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import type { Crop, GerminationType } from '../../api/types';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { libraryPinSelectSx } from '../libraryFieldPin';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import { GERMINATION_TYPES, propagationShorterThanGermination } from '../germination';
import { formGridDoubleColumnSx, formGridFieldSx, formGridSx } from './styles';

type RangeBoundField =
  | 'germination_temperature_optimal_min_c' | 'germination_temperature_optimal_max_c'
  | 'germination_days_min' | 'germination_days_max';

interface Props {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function GerminationSection({ formData, errors, onChange, t, getFieldHighlightSx, getFieldPinProps }: Props) {
  const bound = (field: RangeBoundField, placeholderKey: 'germination.from' | 'germination.to') => ({
    value: formData[field],
    onValueChange: (value: number | null) => onChange(field, value),
    ariaLabel: t(`germination.fields.${field}`),
    placeholder: t(placeholderKey),
    adornment: getFieldPinProps?.(field)?.button,
  });
  const range = (
    label: string,
    lower: RangeBoundField,
    upper: RangeBoundField,
    numberKind: 'decimal' | 'integer',
  ) => (
    <RangeField
      sx={mergeVarietyFieldSx(
        formGridFieldSx,
        getFieldHighlightSx?.([lower, upper]),
        getFieldPinProps?.(lower)?.fieldSx ?? getFieldPinProps?.(upper)?.fieldSx,
      )}
      label={label}
      numberKind={numberKind}
      from={bound(lower, 'germination.from')}
      to={bound(upper, 'germination.to')}
      error={errors[lower] || errors[upper]}
      invalidRangeText={t('germination.invalidRange')}
    />
  );
  const minTemperaturePin = getFieldPinProps?.('germination_temperature_min_c');
  const typesPin = getFieldPinProps?.('germination_types');
  const treatmentPin = getFieldPinProps?.('germination_pretreatment');
  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('germination.title')}</Typography>
      <Box sx={formGridSx}>
        {range(t('germination.optimalTemperature'), 'germination_temperature_optimal_min_c', 'germination_temperature_optimal_max_c', 'decimal')}
        {range(t('germination.days'), 'germination_days_min', 'germination_days_max', 'integer')}
        <LocalizedDecimalField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('germination_temperature_min_c'), minTemperaturePin?.fieldSx)}
          label={t('germination.fields.germination_temperature_min_c')}
          value={formData.germination_temperature_min_c}
          onValueChange={(value) => onChange('germination_temperature_min_c', value)}
          error={Boolean(errors.germination_temperature_min_c)}
          helperText={errors.germination_temperature_min_c}
          slotProps={{ input: { endAdornment: minTemperaturePin?.endAdornment } }}
        />
        <FormControl sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('germination_types'), typesPin?.fieldSx)}>
          <InputLabel id="germination-types-label">{t('germination.fields.germination_types')}</InputLabel>
          <Select labelId="germination-types-label" label={t('germination.fields.germination_types')} multiple
            value={formData.germination_types ?? []} endAdornment={typesPin?.endAdornment}
            sx={typesPin ? libraryPinSelectSx : undefined}
            onChange={(event) => onChange('germination_types', event.target.value as GerminationType[])}
            renderValue={(values) => (values as GerminationType[]).map((kind) => t(`germination.types.${kind}`)).join(', ')}>
            {GERMINATION_TYPES.map((kind) => <MenuItem key={kind} value={kind}><Checkbox checked={formData.germination_types?.includes(kind) ?? false} /><ListItemText primary={t(`germination.types.${kind}`)} /></MenuItem>)}
          </Select>
        </FormControl>
        <TextField sx={mergeVarietyFieldSx(formGridDoubleColumnSx, getFieldHighlightSx?.('germination_pretreatment'), treatmentPin?.fieldSx)}
          label={t('germination.fields.germination_pretreatment')} multiline minRows={2}
          value={formData.germination_pretreatment ?? ''} onChange={(event) => onChange('germination_pretreatment', event.target.value)}
          slotProps={{ input: { endAdornment: treatmentPin?.endAdornment } }} />
      </Box>
      {propagationShorterThanGermination(formData) ? <Alert severity="info">{t('germination.propagationShort')}</Alert> : null}
    </>
  );
}
