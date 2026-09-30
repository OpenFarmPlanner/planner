import { Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

import { useTranslation } from '../../../i18n';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';

interface PlantingPlanSearchCountProps {
  search: PlantingPlanSearchControls;
  variant: 'desktop' | 'mobile';
  sx?: SxProps<Theme>;
}

/** The hit count, announced politely to screen readers whenever it changes. */
export function PlantingPlanSearchCount({ search, variant, sx }: PlantingPlanSearchCountProps) {
  const { t } = useTranslation('plantingPlans');
  let text: string;
  if (!search.isActive) {
    text = t('search.count', { count: search.totalCount });
  } else if (variant === 'desktop') {
    text = t('search.filteredCountDesktop', { shown: search.shownCount, total: search.totalCount });
  } else {
    text = t('search.filteredCountMobile', { shown: search.shownCount, total: search.totalCount });
  }

  return (
    <Typography
      variant="body2"
      color="text.secondary"
      role="status"
      aria-live="polite"
      data-testid="planting-plan-search-count"
      sx={[{ whiteSpace: 'nowrap' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {text}
    </Typography>
  );
}
