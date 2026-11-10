/**
 * SpacingSection: planting distances and sowing depth.
 * @remarks Presentational, no internal state
 */
import { Box, Typography, TextField } from '@mui/material';
import type { Crop } from '../../api/types';
import type { TFunction } from 'i18next';
import { formGridFieldSx, formGridSx } from './styles.tsx';
import { RangeField } from '../../components/inputs/RangeField';
import { mergeVarietyFieldSx, type GetVarietyFieldHighlightSx } from '../varietyValueAccent';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';

interface SpacingSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  getFieldHighlightSx?: GetVarietyFieldHighlightSx;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function SpacingSection({ formData, errors, onChange, t, getFieldHighlightSx, getFieldPinProps }: SpacingSectionProps) {
  const distanceWithinRowPin = getFieldPinProps?.('distance_within_row_cm');
  const rowSpacingPin = getFieldPinProps?.('row_spacing_cm');
  const sowingDepthPin = getFieldPinProps?.('sowing_depth_cm');
  const sowingDepthMaxPin = getFieldPinProps?.('sowing_depth_max_cm');

  return (
    <>
      <Typography variant="h6" sx={{ mt: 1 }}>{t('form.sectionPlanting')}</Typography>
      <Box sx={formGridSx}>
        <TextField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('distance_within_row_cm'), distanceWithinRowPin?.fieldSx)}
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
        <TextField
          sx={mergeVarietyFieldSx(formGridFieldSx, getFieldHighlightSx?.('row_spacing_cm'), rowSpacingPin?.fieldSx)}
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
        <RangeField
          sx={mergeVarietyFieldSx(
            formGridFieldSx,
            getFieldHighlightSx?.(['sowing_depth_cm', 'sowing_depth_max_cm']),
            sowingDepthPin?.fieldSx ?? sowingDepthMaxPin?.fieldSx,
          )}
          label={t('form.sowingDepthCm')}
          // null, not undefined: a cleared bound must reach the backend, which
          // then gives it the other bound's value (one depth is a range of one).
          from={{
            value: formData.sowing_depth_cm,
            onValueChange: (value) => onChange('sowing_depth_cm', value ?? null),
            ariaLabel: t('form.sowingDepthMinCm'),
            placeholder: t('germination.from'),
            adornment: sowingDepthPin?.button,
          }}
          to={{
            value: formData.sowing_depth_max_cm,
            onValueChange: (value) => onChange('sowing_depth_max_cm', value ?? null),
            ariaLabel: t('form.sowingDepthMaxCm'),
            placeholder: t('germination.to'),
            adornment: sowingDepthMaxPin?.button,
          }}
          error={errors.sowing_depth_cm || errors.sowing_depth_max_cm}
          invalidRangeText={t('form.sowingDepthRangeError')}
        />
      </Box>
    </>
  );
}
