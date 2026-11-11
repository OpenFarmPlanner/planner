/**
 * TimingSection: cultivation type, then propagation, growth and harvest
 * duration in one row.
 * @remarks Presentational, no internal state
 */
import { Box, Typography, FormControl, InputLabel, MenuItem, TextField, Checkbox, ListItemText } from '@mui/material';
import { formGridFieldSx, formGridSx } from './styles.tsx';
import type { Crop, CultivationType } from '../../api/types';
import type { TFunction } from 'i18next';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import { libraryPinSelectSx } from '../libraryFieldPin';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { FieldInfoButton } from '../FieldInfoButton';
import { buildFieldEndAdornment } from '../fieldEndAdornment';

interface TimingSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function TimingSection({ formData, errors, onChange, t, getFieldHighlightSx, getFieldPinProps }: TimingSectionProps) {
  const selectedCultivationTypes = formData.cultivation_types?.length
    ? formData.cultivation_types
    : (formData.cultivation_type ? [formData.cultivation_type as CultivationType] : []);
  const cultivationTypePin = getFieldPinProps?.('cultivation_types');
  const growthDurationPin = getFieldPinProps?.('growth_duration_days');
  const harvestDurationPin = getFieldPinProps?.('harvest_duration_days');
  const infoButton = (labelKey: string, helpKey: string) => (
    <FieldInfoButton title={t(helpKey)} ariaLabel={t('form.fieldInfoAriaLabel', { field: t(labelKey) })} />
  );

  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('form.sectionTiming')}</Typography>
      <Box sx={formGridSx}>
        <FormControl
          sx={mergeVarietyFieldSx(
            formGridFieldSx,
            getFieldHighlightSx?.(['cultivation_types', 'cultivation_type']),
            cultivationTypePin?.fieldSx,
          )}
        >
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
      </Box>
      <Box sx={formGridSx}>
        <TextField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('growth_duration_days'), growthDurationPin?.fieldSx)}
          type="number"
          label={t('form.growthDurationDays')}
          placeholder={t('form.growthDurationDaysPlaceholder')}
          value={formData.growth_duration_days ?? ''}
          onChange={e => onChange('growth_duration_days', e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
          error={Boolean(errors.growth_duration_days)}
          helperText={errors.growth_duration_days}
          slotProps={{
            htmlInput: { min: 1, step: 1, inputMode: 'numeric' },
            input: {
              endAdornment: buildFieldEndAdornment(
                infoButton('form.growthDurationDays', 'form.growthDurationDaysHelp'),
                growthDurationPin,
              ),
            },
          }}
        />
        <TextField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('harvest_duration_days'), harvestDurationPin?.fieldSx)}
          type="number"
          label={t('form.harvestDurationDays')}
          placeholder={t('form.harvestDurationDaysPlaceholder')}
          value={formData.harvest_duration_days ?? ''}
          onChange={e => onChange('harvest_duration_days', e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
          error={Boolean(errors.harvest_duration_days)}
          helperText={errors.harvest_duration_days}
          slotProps={{
            htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
            input: {
              endAdornment: buildFieldEndAdornment(
                infoButton('form.harvestDurationDays', 'form.harvestDurationDaysHelp'),
                harvestDurationPin,
              ),
            },
          }}
        />
      </Box>
    </>
  );
}
