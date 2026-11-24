import { Box, FormControl, FormHelperText, InputLabel, MenuItem, TextField } from '@mui/material';
import type { TFunction } from 'i18next';
import type { Crop } from '../../api/types';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { FieldInfoButton } from '../FieldInfoButton';
import { buildFieldEndAdornment } from '../fieldEndAdornment';
import { libraryPinSelectSx } from '../libraryFieldPin';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { selectableSiteHealthChoices } from '../siteHealth';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import { formGridFieldSx, formGridSx } from './styles';

interface Props {
  formData: Partial<Crop>;
  errors: Readonly<Record<string, string>>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  getFieldPinProps?: GetLibraryFieldPinProps;
  isPerennial: boolean;
  inheritedStandingTime?: Crop['standing_time_years'];
}

export function LifeCycleFields({
  formData, errors, onChange, t, getFieldHighlightSx, getFieldPinProps,
  isPerennial, inheritedStandingTime,
}: Props) {
  const lifeCyclePin = getFieldPinProps?.('life_cycle');
  const standingTimePin = getFieldPinProps?.('standing_time_years');
  const standingTimeError = errors.standing_time_years;
  const legacyLifeCycle = formData.life_cycle === 'biennial';
  return (
    <Box sx={formGridSx} role="group" aria-label={t('form.generalInfoSectionTitle')}>
      <FormControl sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('life_cycle'), lifeCyclePin?.fieldSx)}>
        <InputLabel id="crop-life_cycle-label">{t('siteHealth.fields.life_cycle')}</InputLabel>
        <Select
          labelId="crop-life_cycle-label"
          label={t('siteHealth.fields.life_cycle')}
          value={formData.life_cycle ?? ''}
          renderValue={legacyLifeCycle ? () => t('siteHealth.values.life_cycle.biennial') : undefined}
          aria-describedby={legacyLifeCycle ? 'crop-life_cycle-label-legacy' : undefined}
          endAdornment={lifeCyclePin?.endAdornment}
          sx={lifeCyclePin ? libraryPinSelectSx : undefined}
          onChange={event => onChange('life_cycle', String(event.target.value) as Crop['life_cycle'])}
        >
          <MenuItem value="">{t('noData')}</MenuItem>
          {legacyLifeCycle ? (
            <MenuItem value="biennial" disabled>
              {t('siteHealth.legacyLifeCycleOption', { value: t('siteHealth.values.life_cycle.biennial') })}
            </MenuItem>
          ) : null}
          {selectableSiteHealthChoices('life_cycle').map(value => (
            <MenuItem key={value} value={value}>{t(`siteHealth.values.life_cycle.${value}`)}</MenuItem>
          ))}
        </Select>
        {legacyLifeCycle ? <FormHelperText id="crop-life_cycle-label-legacy">{t('siteHealth.legacyLifeCycleHint')}</FormHelperText> : null}
      </FormControl>
      {isPerennial ? (
        <TextField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('standing_time_years'), standingTimePin?.fieldSx)}
          label={t('siteHealth.fields.standing_time_years')}
          type="number"
          value={formData.standing_time_years ?? ''}
          placeholder={inheritedStandingTime == null ? undefined : String(inheritedStandingTime)}
          error={Boolean(standingTimeError)}
          helperText={standingTimeError}
          onChange={event => onChange('standing_time_years', event.target.value === '' ? null : Number(event.target.value))}
          slotProps={{
            htmlInput: { min: 1, step: 1 },
            inputLabel: { shrink: true },
            input: {
              endAdornment: buildFieldEndAdornment(
                <FieldInfoButton
                  title={t('siteHealth.standingTimeHelp')}
                  ariaLabel={t('form.fieldInfoAriaLabel', { field: t('siteHealth.fields.standing_time_years') })}
                />,
                standingTimePin,
              ),
            },
          }}
        />
      ) : null}
    </Box>
  );
}
