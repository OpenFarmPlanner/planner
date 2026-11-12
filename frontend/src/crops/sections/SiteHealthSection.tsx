import { Box, FormControl, FormHelperText, InputLabel, MenuItem, TextField, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import type { Crop } from '../../api/types';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { libraryPinSelectSx } from '../libraryFieldPin';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import { selectableSiteHealthChoices, SITE_HEALTH_CHOICE_FIELDS, type SiteHealthChoiceField } from '../siteHealth';
import { formGridFieldSx, formGridFullRowSx, formGridSx } from './styles';

interface Props {
  formData: Partial<Crop>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

/** Site, life cycle and plant health: light, water, life cycle, winter hardiness, pests and diseases. */
export function SiteHealthSection({ formData, onChange, t, getFieldHighlightSx, getFieldPinProps }: Props) {
  const choiceField = (field: SiteHealthChoiceField) => {
    const pin = getFieldPinProps?.(field);
    const labelId = `crop-${field}-label`;
    const legacyLifeCycle = field === 'life_cycle' && formData.life_cycle === 'biennial';
    const helperId = `${labelId}-legacy`;
    return (
      <FormControl key={field} sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.(field), pin?.fieldSx)}>
        <InputLabel id={labelId}>{t(`siteHealth.fields.${field}`)}</InputLabel>
        <Select
          labelId={labelId}
          label={t(`siteHealth.fields.${field}`)}
          value={formData[field] ?? ''}
          renderValue={legacyLifeCycle ? () => t('siteHealth.values.life_cycle.biennial') : undefined}
          aria-describedby={legacyLifeCycle ? helperId : undefined}
          endAdornment={pin?.endAdornment}
          sx={pin ? libraryPinSelectSx : undefined}
          onChange={(event) => onChange(field, String(event.target.value) as Crop[typeof field])}
        >
          <MenuItem value="">{t('noData')}</MenuItem>
          {legacyLifeCycle ? (
            <MenuItem value="biennial" disabled>
              {t('siteHealth.legacyLifeCycleOption', { value: t('siteHealth.values.life_cycle.biennial') })}
            </MenuItem>
          ) : null}
          {selectableSiteHealthChoices(field).map((value) => (
            <MenuItem key={value} value={value}>{t(`siteHealth.values.${field}.${value}`)}</MenuItem>
          ))}
        </Select>
        {legacyLifeCycle ? <FormHelperText id={helperId}>{t('siteHealth.legacyLifeCycleHint')}</FormHelperText> : null}
      </FormControl>
    );
  };
  const pestsPin = getFieldPinProps?.('pests_diseases');
  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('siteHealth.title')}</Typography>
      <Box sx={formGridSx}>
        {SITE_HEALTH_CHOICE_FIELDS.map(choiceField)}
        <TextField
          sx={mergeVarietyFieldSx(formGridFullRowSx, getFieldHighlightSx?.('pests_diseases'), pestsPin?.fieldSx)}
          label={t('siteHealth.fields.pests_diseases')}
          placeholder={t('siteHealth.pestsPlaceholder')}
          multiline
          minRows={2}
          value={formData.pests_diseases ?? ''}
          onChange={(event) => onChange('pests_diseases', event.target.value)}
          slotProps={{ input: { endAdornment: pestsPin?.endAdornment } }}
        />
      </Box>
    </>
  );
}
