import type { Ref } from 'react';
import { Badge, Box, IconButton } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

import { useAppBarHeight } from '../../../hooks/useAppBarHeight';
import { useTranslation } from '../../../i18n';
import type { PlantingPlanSearchControls } from '../../../pages/usePlantingPlanSearch';
import { PageSearchField } from '../../../search/PageSearchField';
import { AppTooltip } from '../../AppTooltip';
import { PlantingPlanActiveFilterChips } from './PlantingPlanActiveFilterChips';

interface PlantingPlanMobileSearchBarProps {
  search: PlantingPlanSearchControls;
  searchInputRef: Ref<HTMLInputElement>;
  isFilterSheetOpen: boolean;
  onOpenFilterSheet: () => void;
  filterSheetId: string;
}

/**
 * Mobile search row, sticky directly under the app bar: a full-width rounded
 * search field and a round filter button, with the active filter chips on a
 * horizontally scrolling line below.
 */
export function PlantingPlanMobileSearchBar({
  search,
  searchInputRef,
  isFilterSheetOpen,
  onOpenFilterSheet,
  filterSheetId,
}: PlantingPlanMobileSearchBarProps) {
  const { t } = useTranslation('plantingPlans');
  const appBarHeight = useAppBarHeight();
  const activeGroupCount = search.activeFilterGroups.length;
  const hasFilters = activeGroupCount > 0;
  const filterLabel = hasFilters
    ? t('search.filterButtonActiveAria', { count: activeGroupCount })
    : t('search.filterButton');

  return (
    <Box
      data-testid="planting-plan-mobile-search"
      sx={{
        position: 'sticky',
        top: appBarHeight,
        zIndex: (theme) => theme.zIndex.appBar - 1,
        // Starts at the top edge of <main> (pulling up over its top padding),
        // so the list scrolling underneath never shows above the bar.
        mt: { xs: -1.5, md: -2.5 },
        pt: { xs: 1.5, md: 2.5 },
        pb: 1,
        px: { xs: 1, sm: 0 },
        bgcolor: 'surface.contentBackground',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <PageSearchField
          value={search.query}
          onChange={search.setQuery}
          onClear={search.clearSearch}
          placeholder={t('search.placeholderMobile')}
          ariaLabel={t('search.ariaLabel')}
          clearLabel={t('search.clear')}
          inputRef={searchInputRef}
          variant="rounded"
          sx={{ flex: '1 1 auto', minWidth: 0 }}
        />
        <AppTooltip title={filterLabel}>
          <IconButton
            aria-label={filterLabel}
            aria-haspopup="dialog"
            aria-expanded={isFilterSheetOpen}
            aria-controls={isFilterSheetOpen ? filterSheetId : undefined}
            onClick={onOpenFilterSheet}
            sx={{
              width: 44,
              height: 44,
              flexShrink: 0,
              border: '1px solid',
              borderColor: hasFilters ? 'primary.main' : 'divider',
              bgcolor: hasFilters ? 'primary.main' : 'background.paper',
              color: hasFilters ? 'primary.contrastText' : 'text.primary',
              '&:hover': { bgcolor: hasFilters ? 'primary.dark' : 'action.hover' },
            }}
          >
            <Badge
              color="secondary"
              badgeContent={activeGroupCount}
              invisible={!hasFilters}
              sx={{ '& .MuiBadge-badge': { bgcolor: 'background.paper', color: 'primary.main', fontWeight: 700 } }}
            >
              <FilterListIcon fontSize="small" />
            </Badge>
          </IconButton>
        </AppTooltip>
      </Box>
      {hasFilters ? (
        <PlantingPlanActiveFilterChips search={search} scrollable sx={{ mt: 1 }} />
      ) : null}
    </Box>
  );
}
