import { useId } from 'react';
import { Box, Button, Drawer, Stack, Typography } from '@mui/material';

import { useOverlayHistory } from '../../../hooks/useOverlayHistory';
import { useTranslation } from '../../../i18n';
import { DEFAULT_PLANTING_PLAN_SORT } from '../../../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';
import { PlantingPlanFilterFields } from './PlantingPlanFilterFields';

/** Keeps the bottom button clear of the home indicator on notched phones. */
const SAFE_AREA_BOTTOM = 'env(safe-area-inset-bottom, 0px)';

interface PlantingPlanFilterSheetProps {
  id: string;
  open: boolean;
  onClose: () => void;
  search: PlantingPlanSearchControls;
}

/**
 * Mobile bottom sheet with the sort order and the same filter fields as the
 * desktop panel. Filters apply live; the full-width button only closes the
 * sheet and shows the live hit count. Browser Back closes it too.
 */
export function PlantingPlanFilterSheet({ id, open, onClose, search }: PlantingPlanFilterSheetProps) {
  const { t } = useTranslation('plantingPlans');
  const titleId = useId();
  useOverlayHistory({ open, onClose, historyKey: 'plantingPlanFilterSheet' });

  const canReset = search.hasFilters || search.sortKey !== DEFAULT_PLANTING_PLAN_SORT;
  const handleReset = (): void => {
    search.resetFilters();
    search.setSortKey(DEFAULT_PLANTING_PLAN_SORT);
  };

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          id,
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          sx: {
            borderTopLeftRadius: (theme) => theme.spacing(2),
            borderTopRightRadius: (theme) => theme.spacing(2),
            maxHeight: '85dvh',
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: SAFE_AREA_BOTTOM,
          },
        },
      }}
    >
      <Box
        aria-hidden="true"
        sx={{ width: 40, height: 4, borderRadius: 1, bgcolor: 'divider', mx: 'auto', mt: 1, flexShrink: 0 }}
      />
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, pt: 1, pb: 1, flexShrink: 0 }}
      >
        <Typography id={titleId} variant="subtitle1" component="h2">
          {t('search.sheetTitle')}
        </Typography>
        <Button size="small" onClick={handleReset} disabled={!canReset}>
          {t('search.reset')}
        </Button>
      </Stack>
      <Box sx={{ px: 2, pb: 2, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
        <PlantingPlanFilterFields search={search} showSort />
      </Box>
      <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Button variant="contained" fullWidth size="large" onClick={onClose}>
          {t('search.showResults', { count: search.shownCount })}
        </Button>
      </Box>
    </Drawer>
  );
}
