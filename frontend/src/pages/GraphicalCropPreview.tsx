import { Alert, Box, Stack, Typography } from '@mui/material';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import type { BedCultivationEntry, CropReference } from './graphicalCultivation';

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
  const interval = (start: string | null, end: string | null) => start && end
    ? t('graphical.display.range', { start: dateText(start), end: dateText(end) })
    : start || end ? dateText((start ?? end)!) : null;
  return (
    <Stack component="section" spacing={0.5} aria-label={t('graphical.display.mode.crops')}>
      <Typography variant="subtitle2" component="h3">{t('graphical.display.mode.crops')}</Typography>
      <Typography variant="caption" color="text.secondary">
        {reference.kind === 'season' ? t('graphical.display.entireSeason') : dateText(reference.date)}
      </Typography>
      {loading ? <Typography role="status" variant="caption">{t('common:messages.loading')}</Typography> : null}
      {failed ? <Alert severity="error" action={<LoadRetryButton onClick={refresh} />}>
        {t('graphical.display.cropLoadError')}
      </Alert> : null}
      {!loading && !failed && (entries.length ? <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
        {entries.map(({ plan, phase, recordedHarvest, harvest }) => {
          const name = plan.name || t('ganttChart:taskNames.unknownCrop', { id: plan.crop ?? '' });
          const period = interval(plan.start, plan.end);
          return <Box component="li" key={plan.id} sx={{ mb: 0.5, overflowWrap: 'anywhere' }}>
            <Typography variant="body2">{plan.variety ? `${name} (${plan.variety})` : name}</Typography>
            {phase && <Typography component="div" variant="caption" color="text.secondary">
              {t(recordedHarvest ? 'graphical.display.recordedHarvest' : `graphical.display.phase.${phase}`)}
              {harvest && ` · ${interval(harvest.start_date, harvest.end_date)}`}
            </Typography>}
            {plan.planted && <Typography component="div" variant="caption" color="text.secondary">
              {t('graphical.display.recordedPlanting', { date: dateText(plan.planted) })}
            </Typography>}
            {reference.kind === 'season' && period && <Typography component="div" variant="caption" color="text.secondary">
              {period}
            </Typography>}
            {(!plan.start || !plan.end || !plan.crop) && <Typography component="div" variant="caption" color="text.secondary">
              {t('graphical.display.incompletePlan')}
            </Typography>}
          </Box>;
        })}
      </Box> : <Typography variant="caption" color="text.secondary">{t('graphical.display.noPlans')}</Typography>)}
    </Stack>
  );
}
