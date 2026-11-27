import { Box, Paper, Typography } from '@mui/material';
import { useTranslation } from '../i18n';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import { getMetricScaleBar } from './graphicalViewport';

export const SCALE_INDICATOR_CLEARANCE = 42;
export const QUALIFIED_SCALE_INDICATOR_CLEARANCE = 62;

export function GraphicalScaleIndicator({ scale, compact, measured, approximate }: {
  scale: number;
  compact: boolean;
  measured: boolean;
  approximate: boolean;
}) {
  const { t } = useTranslation('fields');
  const bar = measured ? getMetricScaleBar(scale, compact ? 72 : 96) : null;
  const unit = bar && bar.meters < 1 ? 'centimeter' : 'meter';
  const distance = bar && formatLocalizedNumber(unit === 'centimeter' ? bar.meters * 100 : bar.meters,
    getActiveFormattingLocale(), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 });
  const qualification = approximate ? t('graphical.scaleBar.measuredOnly') : null;

  return (
    <Paper data-graphical-annotation-obstacle data-testid="graphical-scale-indicator" elevation={1}
      sx={{ maxWidth: 'min(160px, 55%)', ml: 'auto', flexShrink: 0, px: 1, py: 0.5,
        borderRadius: 1.5, textAlign: 'center', color: 'text.primary', lineHeight: 1 }}>
      {bar ? (
        <Box role="img" aria-label={[t('graphical.scaleBar.label'), distance, qualification].filter(Boolean).join(' · ')}>
          <Typography aria-hidden variant="caption" sx={{ display: 'block', whiteSpace: 'nowrap' }}>{distance}</Typography>
          <Box aria-hidden data-testid="graphical-metric-scale-bar"
            sx={{ width: `${bar.width}px`, mx: 'auto', height: 5, border: '1px solid', borderTop: 0, boxSizing: 'border-box' }} />
          {qualification && <Typography aria-hidden variant="caption" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{qualification}</Typography>}
        </Box>
      ) : <Typography variant="caption" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{t('graphical.scaleBar.approximate')}</Typography>}
    </Paper>
  );
}
