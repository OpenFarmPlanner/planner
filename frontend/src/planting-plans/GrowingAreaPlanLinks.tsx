import { Link, List, ListItem, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import type { PlantingPlan } from '../api/types';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { useTranslation } from '../i18n';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { isIndividualPlacement } from '../pages/individualPlantGeometry';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { plantingPlanDetailPath, PLANTING_PLANS_PATH } from './plantingPlanDetailRoutes';

interface GrowingAreaPlanLinksProps {
  plans: PlantingPlan[];
  showBed: boolean;
  keepTableLinks?: boolean;
  showIndividualCounts?: boolean;
}

export function GrowingAreaPlanLinks({ plans, showBed, keepTableLinks = false, showIndividualCounts = false }: GrowingAreaPlanLinksProps) {
  const { t, i18n } = useTranslation(['plantingPlans', 'hierarchy', 'fields']);
  const locale = resolveSeasonDateLocale(i18n);
  return (
    <List dense disablePadding>
      {plans.map(plan => {
        if (plan.id === undefined) return null;
        const name = formatCropDisplayName(plan) || t('hierarchy:details.unnamedPlan');
        const detailPath = plantingPlanDetailPath(plan.id);
        const count = showIndividualCounts && isIndividualPlacement(plan) ? plan.plants_count ?? plan.individual_count : undefined;
        const pending = count != null ? plan.pending_plants_count : null;
        return (
          <ListItem key={plan.id} disableGutters sx={{ flexWrap: 'wrap', columnGap: 1, overflowWrap: 'anywhere' }}>
            <Link component={RouterLink} to={keepTableLinks ? `${PLANTING_PLANS_PATH}?planId=${plan.id}` : detailPath}
              underline="hover" sx={{ py: 0.5 }}>{name}</Link>
            <Typography variant="body2" color="text.secondary" component="span">
              {[
                showBed ? plan.bed_name || plan.parcel_name || plan.site_name : null,
                plan.planting_date ? formatSeasonDate(plan.planting_date, locale) : null,
                count != null ? t('fields:individualPlants.count', { count, formatted: formatLocalizedNumber(count, locale) }) : null,
                pending != null && pending > 0
                  ? t('fields:individualPlants.pendingCount', { count: pending, formatted: formatLocalizedNumber(pending, locale) }) : null,
              ].filter(Boolean).join(' · ')}
            </Typography>
            {keepTableLinks && <Link component={RouterLink} to={detailPath} underline="hover"
              aria-label={t('details.openNamed', { name })} sx={{ py: 0.5 }}>{t('details.title')}</Link>}
          </ListItem>
        );
      })}
    </List>
  );
}
