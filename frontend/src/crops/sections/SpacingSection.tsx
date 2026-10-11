/**
 * SpacingSection: planting distances and sowing depth.
 * @remarks Presentational, no internal state
 */
import { Box, Typography, TextField } from '@mui/material';
import type { Crop } from '../../api/types';
import type { TFunction } from 'i18next';
import { fieldRowSx, smallFieldSx } from './styles.tsx';
import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import { mergeVarietyFieldSx } from '../varietyValueAccent';

interface SpacingSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
}

export function SpacingSection({ formData, errors, onChange, t, getFieldTooltipProps }: SpacingSectionProps) {
  const distanceWithinRowVariety = getFieldTooltipProps?.('distance_within_row_cm');
  const rowSpacingVariety = getFieldTooltipProps?.('row_spacing_cm');
  const sowingDepthVariety = getFieldTooltipProps?.('sowing_depth_cm');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 2 }}>{t('form.sectionPlanting')}</Typography>
      <Box sx={fieldRowSx}>
        <VarietyFieldTooltip tooltipTitle={distanceWithinRowVariety?.tooltipTitle}>
          <TextField
            sx={mergeVarietyFieldSx(smallFieldSx, distanceWithinRowVariety?.sx)}
            type="number"
            label={t('form.distanceWithinRowCm')}
            placeholder={t('form.distanceWithinRowCmPlaceholder')}
            value={formData.distance_within_row_cm ?? ''}
            onChange={e => onChange('distance_within_row_cm', e.target.value ? parseInt(e.target.value) : undefined)}
            error={Boolean(errors.distance_within_row_cm)}
            helperText={errors.distance_within_row_cm}
            slotProps={{ htmlInput: { min: 0, step: 1, inputMode: 'numeric' } }}
          />
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={rowSpacingVariety?.tooltipTitle}>
          <TextField
            sx={mergeVarietyFieldSx(smallFieldSx, rowSpacingVariety?.sx)}
            type="number"
            label={t('form.rowSpacingCm')}
            placeholder={t('form.rowSpacingCmPlaceholder')}
            value={formData.row_spacing_cm ?? ''}
            onChange={e => onChange('row_spacing_cm', e.target.value ? parseInt(e.target.value) : undefined)}
            error={Boolean(errors.row_spacing_cm)}
            helperText={errors.row_spacing_cm}
            slotProps={{ htmlInput: { min: 0, step: 1, inputMode: 'numeric' } }}
          />
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={sowingDepthVariety?.tooltipTitle}>
          <LocalizedDecimalField
            sx={mergeVarietyFieldSx(smallFieldSx, sowingDepthVariety?.sx)}
            label={t('form.sowingDepthCm')}
            placeholder={t('form.sowingDepthCmPlaceholder')}
            value={formData.sowing_depth_cm}
            onValueChange={(value) => onChange('sowing_depth_cm', value ?? undefined)}
            error={Boolean(errors.sowing_depth_cm)}
            helperText={errors.sowing_depth_cm}
          />
        </VarietyFieldTooltip>
      </Box>
    </>
  );
}
