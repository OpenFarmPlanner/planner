import { Box, Typography } from '@mui/material';

import type { Crop } from '../api/types';
import { useTranslation } from '../i18n';
import {
  computedHarvestYearSegments,
  formatTimingWindows,
  timingWindowYearSegments,
  type YearSegment,
} from './timingWindows';
import { collectKinds, type KindWindows } from './timingWindowKinds';
import {
  TIMING_WINDOW_LANE_COLORS,
  computedHarvestSegmentSx,
  timingWindowLaneGridSx,
  timingWindowTrackSx,
} from './timingWindowStyles';
import { getEffectiveCropValue } from './varietyValueSource';
import { varietySpecificValueHighlightSx } from './varietyValueAccent';

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

const detailGridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fit, minmax(180px, 260px))' },
  gap: 2,
  justifyContent: 'start',
  mb: 2,
} as const;

interface CropTimingWindowsDetailProps {
  crop: Crop;
  /** Whether a Sorte is shown; its own windows get the variety highlight. */
  isVarietyView: boolean;
}

const segmentPosition = (segment: YearSegment) => ({
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: `${segment.start * 100}%`,
  width: `${(segment.end - segment.start) * 100}%`,
}) as const;

/**
 * Year bar, January to December of `year`: one labelled lane per kind with
 * windows, plus the calculated harvest, hatched as derived.
 */
function TimingWindowYearBar({ kinds, harvest, year }: { kinds: KindWindows[]; harvest: YearSegment[]; year: number }) {
  const { t } = useTranslation(['crops', 'common']);
  return (
    <Box role="img" aria-label={t('crops:timingWindows.yearBarLabel', { year })} sx={timingWindowLaneGridSx}>
      <Box />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }} aria-hidden>
        {MONTH_KEYS.map((key) => (
          <Typography
            key={key}
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t(`common:monthsShort.${key}`)}</Box>
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{t(`common:monthsShort.${key}`).slice(0, 1)}</Box>
          </Typography>
        ))}
      </Box>
      {kinds.map(({ kind, windows }) => (
        <Box key={kind} sx={{ display: 'contents' }} data-testid={`timing-window-lane-${kind}`}>
          <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t(`crops:timingWindows.kinds.${kind}`)}
          </Typography>
          <Box sx={timingWindowTrackSx}>
            {timingWindowYearSegments(windows, year).map((segment, index) => (
              <Box key={index} sx={{ ...segmentPosition(segment), bgcolor: TIMING_WINDOW_LANE_COLORS[kind] }} />
            ))}
          </Box>
        </Box>
      ))}
      {harvest.length > 0 ? (
        <Box sx={{ display: 'contents' }} data-testid="timing-window-lane-computed-harvest">
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {t('crops:timingWindows.computedHarvest')}
          </Typography>
          <Box sx={timingWindowTrackSx}>
            {harvest.map((segment, index) => (
              <Box key={index} sx={{ ...segmentPosition(segment), ...computedHarvestSegmentSx }} />
            ))}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * The crop detail's "Zeiträume" section: the effective windows per kind as
 * text and, below, a year bar. Week windows are drawn in the current year.
 */
export function CropTimingWindowsDetail({ crop, isVarietyView }: CropTimingWindowsDetailProps) {
  const { t } = useTranslation(['crops', 'common']);
  const kinds = collectKinds(crop);
  const year = new Date().getFullYear();
  const harvest = computedHarvestYearSegments(
    kinds.flatMap(({ windows }) => windows),
    {
      growthDurationDays: getEffectiveCropValue(crop, 'growth_duration_days'),
      harvestDurationDays: getEffectiveCropValue(crop, 'harvest_duration_days'),
      propagationDurationDays: getEffectiveCropValue(crop, 'propagation_duration_days'),
    },
    year,
  );

  return (
    <Box sx={{ mb: 3 }} data-testid="crop-timing-windows-detail">
      <Typography variant="h6" gutterBottom>
        {t('crops:timingWindows.sectionTitle')}
      </Typography>
      {kinds.length === 0 ? (
        <Typography variant="body1" color="text.secondary">{t('crops:noData')}</Typography>
      ) : (
        <>
          <Box sx={detailGridSx}>
            {kinds.map(({ kind, windows, inherited }) => (
              <Box key={kind}>
                <Typography variant="body2" color="text.secondary">
                  {t(`crops:timingWindows.kinds.${kind}`)}
                </Typography>
                <Typography
                  variant="body1"
                  sx={isVarietyView && !inherited ? varietySpecificValueHighlightSx : undefined}
                >
                  {formatTimingWindows(windows, t)}
                </Typography>
              </Box>
            ))}
          </Box>
          <TimingWindowYearBar kinds={kinds} harvest={harvest} year={year} />
        </>
      )}
    </Box>
  );
}
