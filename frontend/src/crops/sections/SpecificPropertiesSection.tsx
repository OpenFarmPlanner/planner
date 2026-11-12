import { Alert, Box, Button, FormControl, InputLabel, MenuItem, TextField, Typography } from '@mui/material';
import type { TFunction } from 'i18next';

import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import {
  invalidSpecificPropertyKeys, specificPropertyDefinitions,
  type SpecificProperties, type SpecificPropertyValue,
} from '../specificProperties';
import { formGridFieldSx, formGridSx } from './styles';
import { mergeVarietyFieldSx } from '../varietyValueAccent';

interface Props {
  profile?: string;
  variety?: string;
  values?: SpecificProperties;
  onChange: (values: SpecificProperties) => void;
  t: TFunction;
  errors?: Record<string, string>;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function SpecificPropertiesSection({ profile, variety, values = {}, onChange, t, errors = {}, getFieldPinProps }: Props) {
  const definitions = specificPropertyDefinitions(profile);
  const invalid = invalidSpecificPropertyKeys(profile, values);
  if (!Object.keys(definitions).length && !invalid.length) return null;
  const change = (key: string, value: SpecificPropertyValue | null) => {
    const next = { ...values };
    if (value === null || value === '') delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return <>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
      <Typography variant="h6">{t('specificProperties.title')}</Typography>
      {getFieldPinProps?.('specific_properties')?.button}
    </Box>
    <Typography variant="caption" color="text.secondary">{t(variety ? 'specificProperties.varietyValues' : 'specificProperties.cropValues')}</Typography>
    {invalid.length ? <Alert severity="warning" sx={{
      flexWrap: 'wrap',
      '& .MuiAlert-message': { minWidth: 0, flex: '1 1 180px' },
      '& .MuiAlert-action': { width: { xs: '100%', sm: 'auto' }, maxWidth: '100%', ml: { xs: 0, sm: 'auto' }, justifyContent: 'flex-end' },
    }} action={
      <Button color="inherit" onClick={() => onChange(Object.fromEntries(
        Object.entries(values).filter(([key]) => !invalid.includes(key)),
      ))}>{t('specificProperties.clearIncompatible')}</Button>
    }>{t('specificProperties.incompatible')}</Alert> : null}
    <Box sx={mergeVarietyFieldSx(formGridSx, undefined, getFieldPinProps?.('specific_properties')?.fieldSx)}>
      {Object.entries(definitions).map(([key, definition]) => {
        const label = t(definition.label_key);
        const error = errors[`specific_properties.${key}`];
        if (definition.type === 'enum' || definition.type === 'boolean') {
          const options: Record<string, string> = definition.type === 'boolean'
            ? { true: 'detail.boolean.yes', false: 'detail.boolean.no' } : definition.options ?? {};
          return <FormControl key={key} sx={formGridFieldSx} error={Boolean(error)}>
            <InputLabel id={`specific-property-${key}-label`} shrink>{label}</InputLabel>
            <Select labelId={`specific-property-${key}-label`} label={label} displayEmpty
              value={values[key] === undefined ? '' : String(values[key])}
              renderValue={(value) => value === '' ? t('specificProperties.unset') : t(options[String(value)] ?? 'specificProperties.invalidValue')}
              onChange={(event) => change(key, event.target.value === '' ? null
                : definition.type === 'boolean' ? event.target.value === 'true' : String(event.target.value))}>
              <MenuItem value=""><em>{t('specificProperties.unset')}</em></MenuItem>
              {Object.entries(options).map(([value, labelKey]) => <MenuItem key={value} value={value}>{t(labelKey)}</MenuItem>)}
            </Select>
          </FormControl>;
        }
        if (definition.type === 'number' || definition.type === 'integer') return <LocalizedDecimalField
          key={key} sx={formGridFieldSx} label={label} value={typeof values[key] === 'number' ? values[key] : null}
          onValueChange={(value) => change(key, value)} error={Boolean(error)} helperText={error}
        />;
        return <TextField key={key} sx={formGridFieldSx} label={label} value={values[key] ?? ''}
          onChange={(event) => change(key, event.target.value)} error={Boolean(error)} helperText={error}
        />;
      })}
    </Box>
  </>;
}
