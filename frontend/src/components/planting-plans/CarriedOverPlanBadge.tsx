import { Chip } from '@mui/material';
import { useTranslation } from '../../i18n';
import { AppTooltip } from '../AppTooltip';

export function CarriedOverPlanBadge({ season, tabIndex = 0 }: {
  season?: string | null;
  tabIndex?: number;
}) {
  const { t } = useTranslation('plantingPlans');
  const description = season
    ? t('carriedOver.description', { season })
    : t('carriedOver.unknownDescription');
  return (
    <AppTooltip title={description}>
      <Chip
        component="span"
        size="small"
        variant="outlined"
        tabIndex={tabIndex}
        aria-label={description}
        label={season ? t('carriedOver.badge', { season }) : t('carriedOver.unknownBadge')}
        sx={{ maxWidth: '100%', flexShrink: 0, color: 'text.secondary' }}
      />
    </AppTooltip>
  );
}
