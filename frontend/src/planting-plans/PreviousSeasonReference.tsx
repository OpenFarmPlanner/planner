import { useId, type MouseEvent } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Link, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Link as RouterLink } from 'react-router';
import type { PlantingPlanPreviousSeasonReference } from '../api/types';
import { DetailGrid, DetailRow } from '../components/layout/DetailPrimitives';
import { formatHarvestTotals } from '../harvests/harvestDisplay';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { ACTUAL_DATE_FIELDS } from './plantingPlanActualDates';
import { plantingPlanDetailPath } from './plantingPlanDetailRoutes';

interface PreviousSeasonReferenceProps {
  reference: PlantingPlanPreviousSeasonReference;
  activeSeasonId?: number;
  switchSeason?: (seasonId: number, destination?: string) => void;
}

export function PreviousSeasonReference({ reference, activeSeasonId, switchSeason }: PreviousSeasonReferenceProps) {
  const { t, i18n } = useTranslation('plantingPlans');
  const { t: tHarvest } = useTranslation('harvests');
  const locale = resolveSeasonDateLocale(i18n);
  const id = useId();
  const dates = reference.available ? Object.entries(ACTUAL_DATE_FIELDS).flatMap(([activity, field]) => {
    const value = reference.actual_dates[field];
    return value ? [{ activity, value }] : [];
  }) : [];
  const hasHarvests = reference.available && reference.harvest_quantities.length > 0;
  const hasLosses = reference.available && reference.crop_loss_count > 0;
  const hasActuals = dates.length > 0 || hasHarvests || hasLosses;
  const destination = reference.available ? plantingPlanDetailPath(reference.source_plan_id) : undefined;

  const openSource = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!reference.available || !switchSeason || activeSeasonId === reference.source_season_id
      || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    switchSeason(reference.source_season_id, destination);
  };

  return <Accordion defaultExpanded={hasActuals} disableGutters elevation={0}
    slotProps={{ transition: { unmountOnExit: true } }}
    sx={{ border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 0, '&::before': { display: 'none' } }}>
    <AccordionSummary id={`${id}-heading`} aria-controls={`${id}-content`} expandIcon={<ExpandMoreIcon />}>
      <Typography variant="h6" component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {reference.available ? t('previousSeason.title', { season: reference.source_season_label })
          : t('previousSeason.titleWithoutSeason')}
      </Typography>
    </AccordionSummary>
    <AccordionDetails>
      <Stack spacing={1.5} sx={{ alignItems: 'stretch' }}>
        <Typography variant="body2" color="text.secondary">{t('previousSeason.reference')}</Typography>
        {reference.available ? <>
          {hasActuals ? <DetailGrid>
            {dates.map(({ activity, value }) => <DetailRow key={activity} label={t(`actualDates.actualLabels.${activity}`)}
              value={formatSeasonDate(value, locale)} />)}
            {hasHarvests && <DetailRow label={tHarvest('title')}
              value={formatHarvestTotals(reference.harvest_quantities, locale, tHarvest)} />}
            {hasLosses && <DetailRow label={t('cropLosses.title')}
              value={t('cropLosses.incidentCount', { count: reference.crop_loss_count })} />}
          </DetailGrid> : <Typography color="text.secondary" variant="body2">{t('previousSeason.empty')}</Typography>}
          {destination && <Link component={RouterLink} to={destination} onClick={openSource}
            sx={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', minHeight: 44 }}>
            {t('previousSeason.openSource')}
          </Link>}
        </> : <Typography color="text.secondary" variant="body2">{t('previousSeason.unavailable')}</Typography>}
      </Stack>
    </AccordionDetails>
  </Accordion>;
}
