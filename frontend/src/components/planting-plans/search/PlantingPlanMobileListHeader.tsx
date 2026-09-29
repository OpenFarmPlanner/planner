import { Box, Button } from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';

import { useTranslation } from '../../../i18n';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';
import { PlantingPlanSearchCount } from './PlantingPlanSearchCount';

interface PlantingPlanMobileListHeaderProps {
  search: PlantingPlanSearchControls;
  /** The sort order is changed in the filter sheet. */
  onOpenFilterSheet: () => void;
}

/** The line above the mobile card list: hit count left, current sort order right. */
export function PlantingPlanMobileListHeader({ search, onOpenFilterSheet }: PlantingPlanMobileListHeaderProps) {
  const { t } = useTranslation('plantingPlans');
  const sortLabel = t(`search.sortOptions.${search.sortKey}`);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        px: { xs: 1, sm: 0 },
        mb: 1,
      }}
    >
      <PlantingPlanSearchCount search={search} variant="mobile" />
      <Button
        size="small"
        color="inherit"
        startIcon={<SwapVertIcon fontSize="small" />}
        onClick={onOpenFilterSheet}
        aria-label={`${t('search.fields.sort')}: ${sortLabel}`}
        sx={{ color: 'text.secondary', fontWeight: 500, minWidth: 0, whiteSpace: 'nowrap', minHeight: 36 }}
      >
        {sortLabel}
      </Button>
    </Box>
  );
}
