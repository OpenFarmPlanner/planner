/**
 * SpacingSection: planting distances and sowing depth.
 * @remarks Presentational, no internal state
 */
import { Box, Typography, TextField } from '@mui/material';
import type { Crop } from '../../api/types';
import type { TFunction } from 'i18next';
import { formGridFieldSx, formGridSx } from './styles.tsx';
import { LocalizedDecimalField } from '../../components/inputs/LocalizedDecimalField';
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import { mergeVarietyFieldSx } from '../varietyValueAccent';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';

interface SpacingSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

/** From sm up "von" starts a new row, so the depth range stays together beside "bis". */
const sowingDepthRangeStartSx = { ...formGridFieldSx, gridColumnStart: { xs: 'auto', sm: 1 } } as const;

export function SpacingSection({ formData, errors, onChange, t, getFieldTooltipProps, getFieldPinProps }: SpacingSectionProps) {
  const distanceWithinRowVariety = getFieldTooltipProps?.('distance_within_row_cm');
  const rowSpacingVariety = getFieldTooltipProps?.('row_spacing_cm');
  const sowingDepthVariety = getFieldTooltipProps?.('sowing_depth_cm');
  const sowingDepthMaxVariety = getFieldTooltipProps?.('sowing_depth_max_cm');
  const distanceWithinRowPin = getFieldPinProps?.('distance_within_row_cm');
  const rowSpacingPin = getFieldPinProps?.('row_spacing_cm');
  const sowingDepthPin = getFieldPinProps?.('sowing_depth_cm');
  const sowingDepthMaxPin = getFieldPinProps?.('sowing_depth_max_cm');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('form.sectionPlanting')}</Typography>
      <Box sx={formGridSx}>
        <VarietyFieldTooltip tooltipTitle={distanceWithinRowVariety?.tooltipTitle}>
          <TextField
            sx={mergeVarietyFieldSx(formGridFieldSx, distanceWithinRowVariety?.sx, distanceWithinRowPin?.fieldSx)}
            type="number"
            label={t('form.distanceWithinRowCm')}
            placeholder={t('form.distanceWithinRowCmPlaceholder')}
            value={formData.distance_within_row_cm ?? ''}
            onChange={e => onChange('distance_within_row_cm', e.target.value ? parseInt(e.target.value) : undefined)}
            error={Boolean(errors.distance_within_row_cm)}
            helperText={errors.distance_within_row_cm}
            slotProps={{
              htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
              input: { endAdornment: distanceWithinRowPin?.endAdornment },
            }}
          />
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={rowSpacingVariety?.tooltipTitle}>
          <TextField
            sx={mergeVarietyFieldSx(formGridFieldSx, rowSpacingVariety?.sx, rowSpacingPin?.fieldSx)}
            type="number"
            label={t('form.rowSpacingCm')}
            placeholder={t('form.rowSpacingCmPlaceholder')}
            value={formData.row_spacing_cm ?? ''}
            onChange={e => onChange('row_spacing_cm', e.target.value ? parseInt(e.target.value) : undefined)}
            error={Boolean(errors.row_spacing_cm)}
            helperText={errors.row_spacing_cm}
            slotProps={{
              htmlInput: { min: 0, step: 1, inputMode: 'numeric' },
              input: { endAdornment: rowSpacingPin?.endAdornment },
            }}
          />
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={sowingDepthVariety?.tooltipTitle}>
          <LocalizedDecimalField
            sx={mergeVarietyFieldSx(sowingDepthRangeStartSx, sowingDepthVariety?.sx, sowingDepthPin?.fieldSx)}
            label={t('form.sowingDepthMinCm')}
            placeholder={t('form.sowingDepthCmPlaceholder')}
            value={formData.sowing_depth_cm}
            // null, not undefined: a cleared bound must reach the backend, which
            // then gives it the other bound's value (one depth is a range of one).
            onValueChange={(value) => onChange('sowing_depth_cm', value ?? null)}
            error={Boolean(errors.sowing_depth_cm)}
            helperText={errors.sowing_depth_cm}
            slotProps={{ input: { endAdornment: sowingDepthPin?.endAdornment } }}
          />
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={sowingDepthMaxVariety?.tooltipTitle}>
          <LocalizedDecimalField
            sx={mergeVarietyFieldSx(formGridFieldSx, sowingDepthMaxVariety?.sx, sowingDepthMaxPin?.fieldSx)}
            label={t('form.sowingDepthMaxCm')}
            value={formData.sowing_depth_max_cm}
            onValueChange={(value) => onChange('sowing_depth_max_cm', value ?? null)}
            error={Boolean(errors.sowing_depth_max_cm)}
            helperText={errors.sowing_depth_max_cm}
            slotProps={{ input: { endAdornment: sowingDepthMaxPin?.endAdornment } }}
          />
        </VarietyFieldTooltip>
      </Box>
    </>
  );
}
