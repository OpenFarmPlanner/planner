import { Box, Checkbox, Chip, FormControl, FormHelperText, InputLabel, ListItemText, MenuItem, TextField, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import type { Crop } from '../../api/types';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { libraryPinSelectSx } from '../libraryFieldPin';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import { formatSiteHealthValue, normalizeLightRequirements, SITE_HEALTH_CHOICE_FIELDS, SITE_HEALTH_CHOICES } from '../siteHealth';
import { formGridFieldSx, formGridFullRowSx, formGridSx } from './styles';

interface Props {
  formData: Partial<Crop>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  getFieldPinProps?: GetLibraryFieldPinProps;
  plantHealthField?: ReactNode;
  inheritedLight?: Crop['light_requirement'];
}

export function SiteHealthSection({
  formData, onChange, t, getFieldHighlightSx, getFieldPinProps, plantHealthField, inheritedLight,
}: Props) {
  const choiceField = (field: 'water_requirement' | 'winter_hardiness') => {
    const pin = getFieldPinProps?.(field);
    const labelId = `crop-${field}-label`;
    return (
      <FormControl key={field} sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.(field), pin?.fieldSx)}>
        <InputLabel id={labelId}>{t(`siteHealth.fields.${field}`)}</InputLabel>
        <Select
          labelId={labelId}
          label={t(`siteHealth.fields.${field}`)}
          value={formData[field] ?? ''}
          endAdornment={pin?.endAdornment}
          sx={pin ? libraryPinSelectSx : undefined}
          onChange={(event) => onChange(field, String(event.target.value) as Crop[typeof field])}
        >
          <MenuItem value="">{t('noData')}</MenuItem>
          {SITE_HEALTH_CHOICES[field].map((value) => (
            <MenuItem key={value} value={value}>{t(`siteHealth.values.${field}.${value}`)}</MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  };
  const light = normalizeLightRequirements(formData.light_requirement);
  const lightPin = getFieldPinProps?.('light_requirement');
  const showInheritedLight = light.length === 0 && normalizeLightRequirements(inheritedLight).length > 0;
  const lightLabel = t('siteHealth.fields.light_requirement');
  const pestsPin = getFieldPinProps?.('pests_diseases');
  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('siteHealth.title')}</Typography>
      <Box sx={formGridSx}>
        <FormControl sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('light_requirement'), lightPin?.fieldSx)}>
          <InputLabel id="crop-light-requirement-label">{lightLabel}</InputLabel>
          <Select
            labelId="crop-light-requirement-label"
            label={lightLabel}
            multiple
            value={light}
            endAdornment={lightPin?.endAdornment}
            sx={lightPin ? libraryPinSelectSx : undefined}
            aria-describedby={showInheritedLight ? 'crop-light-requirement-inherited' : undefined}
            onChange={(event) => onChange('light_requirement', normalizeLightRequirements(event.target.value))}
            renderValue={() => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {light.map((value) => <Chip key={value} size="small" label={t(`siteHealth.values.light_requirement.${value}`)} />)}
              </Box>
            )}
          >
            {SITE_HEALTH_CHOICES.light_requirement.map((value) => (
              <MenuItem key={value} value={value}>
                <Checkbox checked={light.includes(value)} />
                <ListItemText primary={t(`siteHealth.values.light_requirement.${value}`)} />
              </MenuItem>
            ))}
          </Select>
          {showInheritedLight ? (
            <FormHelperText id="crop-light-requirement-inherited">
              {t('siteHealth.inheritedLight', { value: formatSiteHealthValue('light_requirement', inheritedLight, t) })}
            </FormHelperText>
          ) : null}
        </FormControl>
        {SITE_HEALTH_CHOICE_FIELDS.filter((field) => field !== 'light_requirement').map(choiceField)}
        {plantHealthField ? <Box sx={formGridFullRowSx}>{plantHealthField}</Box> : null}
        <TextField
          sx={mergeVarietyFieldSx(formGridFullRowSx, getFieldHighlightSx?.('pests_diseases'), pestsPin?.fieldSx)}
          label={t('plantHealth.notes')}
          placeholder={t('siteHealth.pestsPlaceholder')}
          multiline
          minRows={2}
          value={formData.pests_diseases ?? ''}
          onChange={(event) => onChange('pests_diseases', event.target.value)}
          slotProps={{ inputLabel: { shrink: true }, input: { endAdornment: pestsPin?.endAdornment } }}
        />
      </Box>
    </>
  );
}
