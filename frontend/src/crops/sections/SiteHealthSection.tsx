import { Box, FormControl, InputLabel, MenuItem, TextField, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import type { Crop } from '../../api/types';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';
import { libraryPinSelectSx } from '../libraryFieldPin';
import { mergeVarietyFieldSx } from '../varietyValueAccent';
import { SITE_HEALTH_CHOICES, SITE_HEALTH_CHOICE_FIELDS, type SiteHealthChoiceField } from '../siteHealth';
import { formGridFieldSx, formGridFullRowSx, formGridSx } from './styles';

interface Props {
  formData: Partial<Crop>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

/** Site, life cycle and plant health: light, water, life cycle, winter hardiness, pests and diseases. */
export function SiteHealthSection({ formData, onChange, t, getFieldTooltipProps, getFieldPinProps }: Props) {
  const choiceField = (field: SiteHealthChoiceField) => {
    const source = getFieldTooltipProps?.(field);
    const pin = getFieldPinProps?.(field);
    const labelId = `crop-${field}-label`;
    return (
      <VarietyFieldTooltip key={field} tooltipTitle={source?.tooltipTitle}>
        <FormControl sx={mergeVarietyFieldSx(formGridFieldSx, source?.sx, pin?.fieldSx)}>
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
      </VarietyFieldTooltip>
    );
  };
  const pestsSource = getFieldTooltipProps?.('pests_diseases');
  const pestsPin = getFieldPinProps?.('pests_diseases');
  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('siteHealth.title')}</Typography>
      <Box sx={formGridSx}>
        {SITE_HEALTH_CHOICE_FIELDS.map(choiceField)}
        <VarietyFieldTooltip tooltipTitle={pestsSource?.tooltipTitle}>
          <TextField
            sx={mergeVarietyFieldSx(formGridFullRowSx, pestsSource?.sx, pestsPin?.fieldSx)}
            label={t('siteHealth.fields.pests_diseases')}
            placeholder={t('siteHealth.pestsPlaceholder')}
            multiline
            minRows={2}
            value={formData.pests_diseases ?? ''}
            onChange={(event) => onChange('pests_diseases', event.target.value)}
            slotProps={{ input: { endAdornment: pestsPin?.endAdornment } }}
          />
        </VarietyFieldTooltip>
      </Box>
    </>
  );
}
