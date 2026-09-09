/**
 * ColorSection: Display color picker
 * @remarks Presentational, no internal state
 */
import { Box, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Crop } from '../../api/types';
import type { TFunction } from 'i18next';

interface ColorSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  defaultColor: string;
}

const COLOR_VALUE_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function ColorSection({ formData, errors, onChange, t, defaultColor }: ColorSectionProps) {
  const displayColor = formData.display_color || defaultColor;
  const swatchColor = COLOR_VALUE_PATTERN.test(displayColor) ? displayColor : defaultColor;
  const displayValue = COLOR_VALUE_PATTERN.test(displayColor) ? displayColor.toUpperCase() : displayColor;

  return (
    <>
      <Typography variant="h6" sx={{ mt: 2 }}>{t('form.displayColor')}</Typography>
      <Stack spacing={0.75} sx={{ maxWidth: 360 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", }} >
          <Box
            component="label"
            sx={{
              width: 38,
              height: 38,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: swatchColor,
              boxShadow: (theme) => `inset 0 0 0 1px ${alpha(theme.palette.common.white, 0.45)}`,
              cursor: 'pointer',
              flexShrink: 0,
              position: 'relative',
              '&:focus-within': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
            title={displayValue}
          >
            <Box
              component="input"
              type="color"
              aria-label={t('form.displayColor')}
              value={swatchColor}
              onChange={e => onChange('display_color', e.target.value)}
              sx={{
                position: 'absolute',
                inset: 0,
                opacity: 0,
                width: '100%',
                height: '100%',
                cursor: 'pointer',
              }}
            />
          </Box>
          <Typography
            variant="body2"
            component="code"
            sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
          >
            {displayValue}
          </Typography>
        </Stack>
        <Typography variant="body2" color={errors.display_color ? 'error' : 'text.secondary'}>
          {errors.display_color || t('form.displayColorHelp')}
        </Typography>
      </Stack>
    </>
  );
}
