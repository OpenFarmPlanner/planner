import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import type { CultivationType } from '../api/types';
import { ValueWithLibraryPin } from './LibraryPinIndicator';
import type { ValueSource } from './CropSeedDetails';
import { formatNumber } from './cropDetailFormatters';
import { hasDetailValue } from './cropDetailFieldVisibility';
import { varietySpecificValueHighlightSx } from './varietyValueAccent';

const TIMING_DURATION_FIELDS = [
  ['growth_duration_days', 'form.growthDurationDays'],
  ['harvest_duration_days', 'form.harvestDurationDays'],
] as const;
type DurationField = typeof TIMING_DURATION_FIELDS[number][0];

export function CropTimingDetails({ cultivationTypes, cultivationSource, cultivationPin, value, source, pin, locale, t, sx }: {
  cultivationTypes: CultivationType[];
  cultivationSource?: ValueSource | null;
  cultivationPin?: ReactNode;
  value: (field: DurationField) => number | null | undefined;
  source?: (field: DurationField) => ValueSource | null;
  pin?: (field: DurationField) => ReactNode;
  locale: string;
  t: (key: string) => string;
  sx?: SxProps<Theme>;
}) {
  const fieldValue = (content: ReactNode, origin?: ValueSource | null, marker?: ReactNode) =>
    <ValueWithLibraryPin pin={marker}>
      <Typography variant="body1" sx={origin === 'ownValue' ? varietySpecificValueHighlightSx : undefined}>{content}</Typography>
    </ValueWithLibraryPin>;
  return <Box sx={sx ?? { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
    {cultivationTypes.length ? <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">{t('form.cultivationType')}</Typography>
      {fieldValue(cultivationTypes.map(type => t(type === 'pre_cultivation' ? 'form.cultivationTypePreCultivation' : 'form.cultivationTypeDirectSowing')).join(', '), cultivationSource, cultivationPin)}
    </Box> : null}
    {TIMING_DURATION_FIELDS.filter(([field]) => hasDetailValue(value(field))).map(([field, label]) => <Box key={field}>
      <Typography variant="body2" color="text.secondary">{t(label)}</Typography>
      {fieldValue(`${formatNumber(value(field), t, locale)} ${t('detail.units.days')}`, source?.(field), pin?.(field))}
    </Box>)}
  </Box>;
}
