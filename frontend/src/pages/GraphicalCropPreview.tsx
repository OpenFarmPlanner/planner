import { Alert, Box, Stack, Typography } from '@mui/material';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { bedCropDisplayName, bedCropPhaseLabel, type BedCultivationEntry, type CropReference } from './graphicalCultivation';
import { formatCropInterval, formatCropOccupation, formatCropReference } from './graphicalCropTimeLabels';

export interface CropPreviewData {
  reference: CropReference;
  entries: readonly BedCultivationEntry[];
  loading: boolean;
  failed: boolean;
  refresh: () => void;
}

export function GraphicalCropPreview({ reference, entries, loading, failed, refresh }: CropPreviewData) {
  const { t, i18n } = useTranslation(['fields', 'common', 'ganttChart']);
  const locale = resolveSeasonDateLocale(i18n);
  const dateText = (date: string) => formatSeasonDate(date, locale);
  const interval = (start: string, end: string) => formatCropInterval(start, end, locale, t);
  return (
    <Stack component="section" spacing={0.5} aria-label={t('graphical.display.mode.crops')}>
      <Typography variant="subtitle2" component="h3">{t('graphical.display.mode.crops')}</Typography>
      <Typography variant="caption" color="text.secondary">
        {formatCropReference(reference, locale, t)}
      </Typography>
      {loading ? <Typography role="status" variant="caption">{t('common:messages.loading')}</Typography> : null}
      {failed ? <Alert severity="error" action={<LoadRetryButton onClick={refresh} />}>
        {t('graphical.display.cropLoadError')}
      </Alert> : null}
      {!loading && !failed && (entries.length ? <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
        {entries.map(entry => {
          const { plan, harvest, recordedPeriods } = entry;
          const phase = bedCropPhaseLabel(entry, t);
          const period = formatCropOccupation(plan, locale, t);
          return <Box component="li" key={plan.id} sx={{ mb: 0.5, overflowWrap: 'anywhere' }}>
            <Typography variant="body2">{bedCropDisplayName(plan, t)}</Typography>
            {phase && <Typography component="div" variant="caption" color="text.secondary">
              {phase}
              {harvest && ` · ${interval(harvest.start_date, harvest.end_date)}`}
            </Typography>}
            {plan.planted && <Typography component="div" variant="caption" color="text.secondary">
              {t('graphical.display.recordedPlanting', { date: dateText(plan.planted) })}
            </Typography>}
            {reference.kind !== 'date' && period && <Typography component="div" variant="caption" color="text.secondary">
              {t('graphical.display.phase.occupancy')} · {period}
            </Typography>}
            {recordedPeriods?.map(actual => <Typography key={`${actual.start_date}:${actual.end_date}`}
              component="div" variant="caption" color="text.secondary">
              {t('graphical.display.recordedHarvest')} · {interval(actual.start_date, actual.end_date)}
            </Typography>)}
            {(!plan.start || !plan.end || !plan.crop) && <Typography component="div" variant="caption" color="text.secondary">
              {t('graphical.display.incompletePlan')}
            </Typography>}
          </Box>;
        })}
      </Box> : <Typography variant="caption" color="text.secondary">{t('graphical.display.noPlans')}</Typography>)}
    </Stack>
  );
}
