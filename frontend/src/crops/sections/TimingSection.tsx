/**
 * TimingSection: cultivation type, harvest planning and propagation duration.
 */
import { Box, Typography, FormControl, InputLabel, MenuItem, TextField, Checkbox, ListItemText } from '@mui/material';
import { formGridFieldSx, formGridSx } from './styles.tsx';
import type { Crop, CultivationType } from '../../api/types';
import type { TFunction } from 'i18next';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { YearlessDateField } from '../../components/inputs/YearlessDateField';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import { INVALID_HARVEST_DATE_DRAFT, splitAnnualHarvestWindow } from '../annualHarvestWindow';
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
  language?: string;
  isPerennial?: boolean;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function TimingSection({
  formData, errors, onChange, t, language, isPerennial = false, getFieldHighlightSx, getFieldPinProps,
}: TimingSectionProps) {
  const selectedCultivationTypes = formData.cultivation_types?.length
    ? formData.cultivation_types
    : (formData.cultivation_type ? [formData.cultivation_type as CultivationType] : []);
  const isDirectSowingOnly = selectedCultivationTypes.length === 1 && selectedCultivationTypes[0] === 'direct_sowing';
  const propagationTooLong = !isPerennial && !isDirectSowingOnly
    && (formData.propagation_duration_days ?? 0) > (formData.growth_duration_days ?? 0);
  const cultivationTypePin = getFieldPinProps?.('cultivation_types');
  const growthDurationPin = getFieldPinProps?.('growth_duration_days');
  const harvestDurationPin = getFieldPinProps?.('harvest_duration_days');
  const propagationDurationPin = getFieldPinProps?.('propagation_duration_days');
  const annualWindowPin = getFieldPinProps?.('annual_harvest_window');
  const delayPin = getFieldPinProps?.('first_harvest_delay_years');
  const [start, end] = splitAnnualHarvestWindow(formData.annual_harvest_window ?? '');
  const updateAnnualWindow = (nextStart: string, nextEnd: string) => {
    onChange('annual_harvest_window', nextStart || nextEnd ? `${nextStart}/${nextEnd}` : '');
  };
  const windowSx = mergeVarietyFieldSx(
    formGridFieldSx, getFieldHighlightSx?.('annual_harvest_window'), annualWindowPin?.fieldSx,
  );
  const infoButton = (labelKey: string, helpKey: string) => (
    <FieldInfoButton title={t(helpKey)} ariaLabel={t('form.fieldInfoAriaLabel', { field: t(labelKey) })} />
  );
  const yearlessDateProps = {
    sx: windowSx,
    locale: resolveLocaleFromLanguage(language),
    monthLabel: t('annualHarvest.pickerMonth'),
    daysLabel: t('annualHarvest.pickerDays'),
  };

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
        {isPerennial ? (
          <>
            <YearlessDateField
              {...yearlessDateProps}
              label={t('annualHarvest.start')}
              pickerLabel={t('annualHarvest.openStartPicker')}
              value={start === INVALID_HARVEST_DATE_DRAFT ? null : start}
              onChange={value => updateAnnualWindow(value ?? INVALID_HARVEST_DATE_DRAFT, end)}
              error={errors['annual_harvest_window.start']}
              actions={annualWindowPin?.button}
            />
            <YearlessDateField
              {...yearlessDateProps}
              label={t('annualHarvest.end')}
              pickerLabel={t('annualHarvest.openEndPicker')}
              value={end === INVALID_HARVEST_DATE_DRAFT ? null : end}
              onChange={value => updateAnnualWindow(start, value ?? INVALID_HARVEST_DATE_DRAFT)}
              error={errors['annual_harvest_window.end']}
            />
            <TextField
              sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('first_harvest_delay_years'), delayPin?.fieldSx)}
              type="number"
              label={t('annualHarvest.delay')}
              value={formData.first_harvest_delay_years ?? ''}
              onChange={event => onChange('first_harvest_delay_years', event.target.value === '' ? null : Number(event.target.value))}
              error={Boolean(errors.first_harvest_delay_years)}
              helperText={errors.first_harvest_delay_years}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
                input: { endAdornment: delayPin?.endAdornment },
              }}
            />
          </>
        ) : (
          <>
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
                input: { endAdornment: harvestDurationPin?.endAdornment },
              }}
            />
          </>
        )}
        <TextField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('propagation_duration_days'), propagationDurationPin?.fieldSx)}
          type="number"
          label={t('form.propagationDurationDays')}
          value={formData.propagation_duration_days ?? ''}
          onChange={e => onChange('propagation_duration_days', e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
          disabled={isDirectSowingOnly}
          error={Boolean(errors.propagation_duration_days) || propagationTooLong}
          helperText={errors.propagation_duration_days || (propagationTooLong ? t('form.propagationDurationDaysTooLong') : undefined)}
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
      </Box>
    </>
  );
}
