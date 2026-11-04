import { loadRetryAlertSx } from '../../../components/loadRetryStyles';
import LoadRetryButton from '../../../components/LoadRetryButton';
import { useEffect, useMemo, type FormEvent, type Ref, type UIEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { PublicCrop } from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { buildCropHierarchy, getFirstVarietyItem, type CropHierarchyItemKind } from '../../../crops/cropHierarchy';
import { flattenTreeRows } from '../../../components/hierarchy/utils/treeRows';
import { useExpandedState } from '../../../components/hierarchy/hooks/useExpandedState';
import { CropHierarchyExpandToggle } from '../../../crops/CropHierarchyExpandToggle';
import {
  MOBILE_ROW_MIN_HEIGHT,
  MOBILE_TOUCH_TARGET_SIZE,
  mobileCropChevronButtonSx,
} from '../../../crops/cropHierarchyRowSx';
import { HighlightedText } from '../../../components/HighlightedText';
import { useOverlayHistory } from '../../../hooks/useOverlayHistory';
import { getPublicCropTitle } from '../../publicCropDisplay';
import { useSearchExpandedGroups } from '../../../crops/useSearchExpandedGroups';
import { getSearchMatchedHierarchyGroupRowIds } from '../../../crops/cropGroupSearch';
import { normalizePublicCropSearchQuery } from '../../../crops/publicCropSearchMatch';

export interface PublicCropMobileSelectorDialogProps {
  open: boolean;
  query: string;
  crops: PublicCrop[];
  loading: boolean;
  error: string;
  selectedCropId: number | null;
  selectedSpeciesViewKey?: string | null;
  listRef: Ref<HTMLUListElement>;
  onClose: () => void;
  onRetry: () => void;
  onQueryChange: (value: string) => void;
  onSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (crop: PublicCrop, itemKind: CropHierarchyItemKind, speciesKey: string) => void;
  onListScroll: (event: UIEvent<HTMLUListElement>) => void;
}

export function PublicCropMobileSelectorDialog({
  open,
  query,
  crops,
  loading,
  error,
  selectedCropId,
  selectedSpeciesViewKey = null,
  listRef,
  onClose,
  onRetry,
  onQueryChange,
  onSearchSubmit,
  onSelect,
  onListScroll,
}: PublicCropMobileSelectorDialogProps) {
  const { t, i18n } = useTranslation('crops');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const {
    expandedRows,
    toggleExpand,
    ensureExpanded,
    collapse,
  } = useExpandedState('publicCropLibraryMobile');
  const normalizedSearchQuery = normalizePublicCropSearchQuery(query);
  const hierarchyItems = useMemo(() => buildCropHierarchy(crops), [crops]);

  const selectedVarietyGroupRowIds = useMemo(() => {
    const selectedVariety = hierarchyItems.find((item) => (
      item.kind === 'variety'
      && item.crop?.id === selectedCropId
      && selectedSpeciesViewKey !== item.speciesKey
    ));
    return selectedVariety?.parentId ? new Set([selectedVariety.parentId]) : new Set<string>();
  }, [hierarchyItems, selectedCropId, selectedSpeciesViewKey]);

  useEffect(() => {
    selectedVarietyGroupRowIds.forEach((rowId) => ensureExpanded(rowId));
  }, [ensureExpanded, selectedVarietyGroupRowIds]);

  const matchedGroupRowIds = useMemo(
    () => getSearchMatchedHierarchyGroupRowIds(hierarchyItems, normalizedSearchQuery),
    [hierarchyItems, normalizedSearchQuery],
  );

  useSearchExpandedGroups({
    matchedGroupRowIds,
    isExpanded: (rowId) => expandedRows.has(rowId),
    ensureExpanded,
    collapse,
    keepExpandedRowIds: selectedVarietyGroupRowIds,
  });
  const visibleRows = useMemo(
    () => flattenTreeRows(hierarchyItems, { expandedIds: expandedRows }),
    [expandedRows, hierarchyItems],
  );

  useOverlayHistory({
    open,
    onClose,
    historyKey: 'openFarmPlannerPublicCropSelector',
  });

  return (
    <Dialog fullScreen open={open} onClose={onClose}>
      <DialogTitle>{t('selectCrop')}</DialogTitle>
      <DialogContent sx={{ px: 1.5, pb: 2 }}>
        <Box component="form" onSubmit={onSearchSubmit} sx={{ mb: 1.5 }}>
          <TextField
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            label={t('library.searchLabel')}
            size="medium"
            fullWidth
          />
        </Box>
        {loading ? (
          <Box sx={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Stack spacing={1} sx={{ alignItems: "center", }} >
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">{t('messages.loadingCrops')}</Typography>
            </Stack>
          </Box>
        ) : error ? (
          <Alert severity="error" sx={loadRetryAlertSx} action={<LoadRetryButton disabled={loading} onClick={onRetry} />}>{error}</Alert>
        ) : crops.length === 0 ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {t('library.emptyState.noResultsTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {t('library.empty')}
            </Typography>
          </Box>
        ) : (
          <List
            ref={listRef}
            dense
            disablePadding
            role="listbox"
            aria-label={t('library.page.title')}
            onScroll={onListScroll}
            sx={{ py: 0.5, px: 0.25, overflowY: 'auto' }}
          >
            {visibleRows.map(({ node, depth, hasChildren }) => {
              const crop = node.crop;
              // A species row with no dedicated varietyless entry has nothing of its
              // own to select — but it always has at least one variety underneath it,
              // so tapping it selects that first variety instead of doing nothing.
              // Mirrors the desktop list (PublicCropLibraryPage.tsx).
              const firstVarietyCrop = !crop
                ? getFirstVarietyItem(hierarchyItems, node.id)?.crop ?? null
                : null;
              const isClickable = crop?.id !== undefined || firstVarietyCrop !== null;
              const isRowSelected = Boolean(
                crop?.id !== undefined
                && crop.id === selectedCropId
                && (node.kind === 'species'
                  ? selectedSpeciesViewKey === node.speciesKey || !(crop.variety || '').trim()
                  : selectedSpeciesViewKey !== node.speciesKey),
              );
              return (
                <ListItemButton
                  key={`mobile-public-${node.id}`}
                  role={isClickable ? 'option' : 'presentation'}
                  aria-label={node.kind === 'species'
                    ? node.label
                    : crop ? getPublicCropTitle(crop, language, t('library.translation.missingName')) : undefined}
                  aria-selected={isClickable ? isRowSelected : undefined}
                  selected={isRowSelected}
                  disabled={!isClickable}
                  onClick={() => {
                    if (crop) {
                      onSelect(crop, node.kind, node.speciesKey);
                    } else if (firstVarietyCrop) {
                      ensureExpanded(node.id);
                      onSelect(firstVarietyCrop, 'variety', node.speciesKey);
                    }
                  }}
                  onDoubleClick={(event) => {
                    if (!hasChildren) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    toggleExpand(node.id);
                  }}
                  sx={{
                    borderRadius: 1.25,
                    mb: 0.125,
                    ml: `calc(${depth * 1.75}rem)`,
                    pl: 0.75,
                    py: 0.25,
                    minHeight: MOBILE_ROW_MIN_HEIGHT,
                  }}
                >
                  <CropHierarchyExpandToggle
                    hasChildren={hasChildren}
                    isExpanded={expandedRows.has(node.id)}
                    onToggle={() => toggleExpand(node.id)}
                    expandLabel={t('hierarchy.expandCrop')}
                    collapseLabel={t('hierarchy.collapseCrop')}
                    sx={mobileCropChevronButtonSx}
                    placeholderWidth={MOBILE_TOUCH_TARGET_SIZE}
                  />
                  <ListItemText
                    primary={node.kind === 'species'
                      ? <HighlightedText text={node.label} query={normalizedSearchQuery} />
                      : (
                        <HighlightedText
                          text={node.label || (crop ? getPublicCropTitle(crop, language, t('library.translation.missingName')) : '')}
                          query={normalizedSearchQuery}
                        />
                      )}
                    slotProps={{
                      primary: { sx: { fontSize: '0.95rem', fontWeight: node.kind === 'species' ? 700 : 500, lineHeight: 1.2 } },
                    }}
                    sx={{ my: 0 }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 1.5, py: 1 }}>
        <Button onClick={onClose} sx={{ minHeight: MOBILE_TOUCH_TARGET_SIZE }}>
          {t('common:actions.cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
