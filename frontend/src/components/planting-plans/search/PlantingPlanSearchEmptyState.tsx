import { Box, Button, Stack, Typography } from '@mui/material';

import { useTranslation } from '../../../i18n';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';

interface PlantingPlanSearchEmptyStateProps {
  search: PlantingPlanSearchControls;
}

/** Shown in place of the grid or card list when search and filters match no plan. */
export function PlantingPlanSearchEmptyState({ search }: PlantingPlanSearchEmptyStateProps) {
  const { t } = useTranslation('plantingPlans');
  const trimmedQuery = search.query.trim();
  const showFilterHint = search.hasSearch && search.hasFilters && search.searchOnlyCount > 0;

  return (
    <Box
      data-testid="planting-plan-search-empty"
      sx={{
        py: { xs: 4, md: 6 },
        px: 2,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Typography variant="h6" component="h2" sx={{ mb: 1, overflowWrap: 'anywhere' }}>
        {trimmedQuery
          ? t('search.empty.titleWithQuery', { query: trimmedQuery })
          : t('search.empty.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 480 }}>
        {showFilterHint
          ? t('search.empty.hintWithFilters', { count: search.searchOnlyCount })
          : t('search.empty.hint')}
      </Typography>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        useFlexGap
        spacing={1}
        sx={{ justifyContent: 'center', alignItems: 'stretch', width: { xs: '100%', sm: 'auto' }, maxWidth: { xs: 320, sm: 'none' } }}
      >
        {search.query ? (
          <Button variant="outlined" onClick={search.clearSearch}>
            {t('search.empty.clearSearch')}
          </Button>
        ) : null}
        {search.hasFilters ? (
          <Button variant="contained" onClick={search.resetFilters}>
            {t('search.empty.resetFilters')}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
