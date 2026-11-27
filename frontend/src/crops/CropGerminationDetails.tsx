import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { formatCropDetailRange } from './cropDetailFormatters';
import { formatGerminationValue, type GerminationDetailField, type getGerminationDetailRows } from './germination';
import type { ValueSource } from './CropSeedDetails';
import { ValueWithLibraryPin } from './LibraryPinIndicator';
import { varietySpecificValueHighlightSx } from './varietyValueAccent';

export function CropGerminationDetails({ rows, source, pin, gridSx, t, locale }: {
  rows: ReturnType<typeof getGerminationDetailRows>;
  source: (field: GerminationDetailField) => ValueSource | null;
  pin?: (field: GerminationDetailField) => ReactNode;
  gridSx?: SxProps<Theme>;
  t: TFunction<'crops'>;
  locale: string;
}) {
  return (
    <Box component="section" aria-label={t('germination.title')}>
      <Typography variant="h6" gutterBottom>{t('germination.title')}</Typography>
      <Box sx={gridSx ?? { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
        {rows.map(({ row, lower, upper }) => {
          const ownValue = source(row.field) === 'ownValue' || (row.upper && source(row.upper) === 'ownValue');
          const lowerPin = pin?.(row.field);
          const upperPin = row.upper ? pin?.(row.upper) : null;
          return (
            <Box key={row.field} sx={{ minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary">{t(row.label)}</Typography>
              <ValueWithLibraryPin pin={lowerPin} secondPin={upperPin}>
                <Typography sx={[ownValue ? varietySpecificValueHighlightSx : {}, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }]}>
                  {row.unit ? formatCropDetailRange(lower, upper, row.unit, t, locale)
                    : formatGerminationValue(row.field, lower, t, locale)}
                </Typography>
              </ValueWithLibraryPin>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
