import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { RangeField } from '../../components/inputs/RangeField';
import { Alert, Box, FormControl, FormHelperText, InputLabel, MenuItem, TextField, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import type { Crop } from '../../api/types';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { libraryPinSelectSx } from '../libraryFieldPin';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import { TEMPERATURE_REQUIREMENTS, GERMINATION_LIGHT_REQUIREMENTS, requiresStratification, hasLegacyGerminationConflict, propagationShorterThanGermination } from '../germination';
import { FieldInfoButton } from '../FieldInfoButton';
import { buildFieldEndAdornment } from '../fieldEndAdornment';
import { formGridDoubleColumnSx, formGridFieldSx, formGridSx } from './styles';

type RangeBoundField =
  | 'germination_temperature_optimal_min_c' | 'germination_temperature_optimal_max_c'
  | 'germination_days_min' | 'germination_days_max'
  | 'stratification_days_min' | 'stratification_days_max'
  | 'stratification_temperature_min_c' | 'stratification_temperature_max_c';

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
  const selectedCultivationTypes = formData.cultivation_types?.length
    ? formData.cultivation_types : (formData.cultivation_type ? [formData.cultivation_type] : []);
  const isDirectSowingOnly = selectedCultivationTypes.length === 1 && selectedCultivationTypes[0] === 'direct_sowing';
  const propagationTooLong = (formData.propagation_duration_days ?? 0) > (formData.growth_duration_days ?? 0);
  const propagationDurationPin = getFieldPinProps?.('propagation_duration_days');
  const infoButton = (labelKey: string, helpKey: string) => (
    <FieldInfoButton title={t(helpKey)} ariaLabel={t('form.fieldInfoAriaLabel', { field: t(labelKey) })} />
  );
  const requirementSelect = <F extends 'germination_temperature_requirement' | 'germination_light_requirement'>(field: F, options: readonly NonNullable<Crop[F]>[]) => {
    const pin = getFieldPinProps?.(field);
    return (
      <FormControl error={Boolean(errors[field])} sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.(field), pin?.fieldSx)}>
        <InputLabel id={`${field}-label`} shrink>{t(`germination.fields.${field}`)}</InputLabel>
        <Select labelId={`${field}-label`} label={t(`germination.fields.${field}`)}
          displayEmpty value={formData[field] ?? ''} endAdornment={pin?.endAdornment}
          renderValue={(value) => value ? t(`germination.values.${field}.${value}`) : t('germination.unknown')}
          sx={pin ? libraryPinSelectSx : undefined}
          onChange={(event) => onChange(field, event.target.value as Crop[F])}>
          <MenuItem value=""><em>{t('germination.unknown')}</em></MenuItem>
          {options.map((value) => <MenuItem key={value} value={value}>{t(`germination.values.${field}.${value}`)}</MenuItem>)}
        </Select>
        {errors[field] ? <FormHelperText>{errors[field]}</FormHelperText> : null}
      </FormControl>
    );
  };
  const treatmentPin = getFieldPinProps?.('germination_pretreatment');
  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('germination.title')}</Typography>
      <Box sx={formGridSx}>
        {range(t('germination.optimalTemperature'), 'germination_temperature_optimal_min_c', 'germination_temperature_optimal_max_c', 'decimal')}
        <LocalizedDecimalField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('germination_temperature_min_c'), minTemperaturePin?.fieldSx)}
          label={t('germination.fields.germination_temperature_min_c')}
          value={formData.germination_temperature_min_c}
          onValueChange={(value) => onChange('germination_temperature_min_c', value)}
          error={Boolean(errors.germination_temperature_min_c)}
          helperText={errors.germination_temperature_min_c}
          slotProps={{ input: { endAdornment: minTemperaturePin?.endAdornment } }}
        />
        {range(t('germination.days'), 'germination_days_min', 'germination_days_max', 'integer')}
        {requirementSelect('germination_temperature_requirement', TEMPERATURE_REQUIREMENTS)}
        {requiresStratification(formData.germination_temperature_requirement) ? <>
          {range(t('germination.stratificationDays'), 'stratification_days_min', 'stratification_days_max', 'integer')}
          {range(t('germination.stratificationTemperature'), 'stratification_temperature_min_c', 'stratification_temperature_max_c', 'decimal')}
        </> : null}
        {requirementSelect('germination_light_requirement', GERMINATION_LIGHT_REQUIREMENTS)}
        <TextField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('propagation_duration_days'), propagationDurationPin?.fieldSx)}
          type="number"
          label={t('form.propagationDurationDays')}
          value={isDirectSowingOnly ? 0 : (formData.propagation_duration_days ?? '')}
          onChange={e => onChange('propagation_duration_days', e.target.value ? parseInt(e.target.value) : undefined)}
          disabled={isDirectSowingOnly}
          error={Boolean(errors.propagation_duration_days) || propagationTooLong}
          helperText={
            errors.propagation_duration_days
              || (propagationTooLong ? t('form.propagationDurationDaysTooLong') : undefined)
          }
          slotProps={{
            htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
            input: {
              endAdornment: buildFieldEndAdornment(
                infoButton(
                  'form.propagationDurationDays',
                  isDirectSowingOnly ? 'form.directSowingPropagationDisabledHelp' : 'form.propagationDurationDaysHelp',
                ),
                isDirectSowingOnly ? undefined : propagationDurationPin,
              ),
            },
          }}
        />
        <TextField sx={mergeVarietyFieldSx(formGridDoubleColumnSx, getFieldHighlightSx?.('germination_pretreatment'), treatmentPin?.fieldSx)}
          label={t('germination.fields.germination_pretreatment')} multiline minRows={2}
          value={formData.germination_pretreatment ?? ''} onChange={(event) => onChange('germination_pretreatment', event.target.value)}
          slotProps={{ input: { endAdornment: treatmentPin?.endAdornment } }} />
      </Box>
      {hasLegacyGerminationConflict(formData) ? <Alert severity="warning">{t('germination.legacyConflict')}</Alert> : null}
      {propagationShorterThanGermination(formData) ? <Alert severity="info">{t('germination.propagationShort')}</Alert> : null}
    </>
  );
}
