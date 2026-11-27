import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import type { TFunction } from 'i18next';

import type { Crop } from '../api/api';
import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { getCropDisplayName } from './cropDisplay';
import { buildCropHierarchy, getFirstVarietyItem, type CropHierarchyItemKind } from './cropHierarchy';
import { flattenTreeRows } from '../components/hierarchy/utils/treeRows';
import { useExpandedState } from '../components/hierarchy/hooks/useExpandedState';
import { CropHierarchyExpandToggle } from './CropHierarchyExpandToggle';
import {
  MOBILE_ROW_MIN_HEIGHT,
  MOBILE_TOUCH_TARGET_SIZE,
  mobileCropChevronButtonSx,
} from './cropHierarchyRowSx';
import { HighlightedText } from '../components/HighlightedText';
import { useSearchExpandedGroups } from './useSearchExpandedGroups';
import { CropBulkSelectionActions, CropBulkSelectionRow } from './CropBulkSelectionControls';
import { CropColorSwatch } from './CropColorSwatch';
import type { ProjectCropSelection } from './useProjectCropSelection';

const EMPTY_MATCHED_GROUP_ROW_IDS: ReadonlySet<string> = new Set();

interface CropMobileSelectorDialogProps {
  open: boolean;
  onClose: () => void;
  /** The shared search/filter control rendered above the list. */
  selectorControl: ReactNode;
  crops: Crop[];
  selectedCropId: number | undefined;
  selectedSpeciesViewKey?: string | null;
  onSelect: (crop: Crop, itemKind: CropHierarchyItemKind, speciesKey: string) => void;
  /** Lower-cased search needle: marks the hits and opens the groups they sit in. */
  highlightQuery?: string;
  /** Row ids of the Kultur groups the running search hit. */
  matchedGroupRowIds?: ReadonlySet<string>;
  bulkSelection?: ProjectCropSelection;
  bulkVisibleCropIds?: number[];
  onResetColors?: () => void;
  t: TFunction<'crops'>;
}

/**
 * Presentational full-screen crop picker for the unified mobile layout.
 * State (open flag, filtered crops, selected crop) and the select
 * handler live in CropDetail.tsx; this component only renders.
 */
export function CropMobileSelectorDialog({
  open,
  onClose,
  selectorControl,
  crops,
  selectedCropId,
  selectedSpeciesViewKey = null,
  onSelect,
  highlightQuery,
  matchedGroupRowIds = EMPTY_MATCHED_GROUP_ROW_IDS,
  bulkSelection,
  bulkVisibleCropIds,
  onResetColors,
  t,
}: CropMobileSelectorDialogProps) {
  useOverlayHistory({
    open,
    onClose,
    historyKey: 'openFarmPlannerCropSelector',
  });
  const {
    expandedRows,
    toggleExpand,
    ensureExpanded,
    collapse,
  } = useExpandedState('projectCropLibraryMobile');
  const hierarchyItems = useMemo(() => buildCropHierarchy(crops), [crops]);
  // The group holding the selected Sorte: kept open so the selected row can
  // never drop out of the list while the detail view still shows it.
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
  const bulkSelecting = Boolean(bulkSelection?.selected);

  return (
    <Dialog fullScreen open={open} onClose={onClose}>
      <DialogTitle>{t('selectCrop')}</DialogTitle>
      <DialogContent sx={{ px: 1.5, pb: 2 }}>
        {selectorControl}
        {bulkSelection && bulkVisibleCropIds ? (
          <CropBulkSelectionActions selection={bulkSelection} onOpenPreview={onClose} visibleIds={bulkVisibleCropIds}
            onResetColors={onResetColors} />
        ) : null}
        {visibleRows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 2 }}>
            {t('noOptionsEnhanced')}
          </Typography>
        ) : null}
        <List dense sx={{ py: 0.5, px: 0.25, overflowY: 'auto' }}>
          {visibleRows.map(({ node, depth, hasChildren }) => {
            const crop = node.crop;
            // A species row with no dedicated varietyless entry has nothing of its own
            // to select — but it always has at least one variety underneath it, so
            // tapping it selects that first variety instead of doing nothing. Mirrors
            // the public crop library's mobile selector (PublicCropMobileSelectorDialog.tsx).
            const firstVarietyCrop = !crop
              ? getFirstVarietyItem(hierarchyItems, node.id)?.crop ?? null
              : null;
            const isClickable = crop?.id !== undefined || firstVarietyCrop !== null;
            const rowLabel = node.kind === 'species'
              ? node.label
              : node.label || (crop ? getCropDisplayName(crop) : '');
            const isRowSelected = Boolean(
              crop?.id !== undefined
              && selectedCropId === crop.id
              && (node.kind === 'species'
                ? selectedSpeciesViewKey === node.speciesKey || !(crop.variety || '').trim()
                : selectedSpeciesViewKey !== node.speciesKey),
            );
            return (
              <CropBulkSelectionRow key={`mobile-${node.id}`} selection={bulkSelection} crop={crop}>
                <ListItemButton
                  role={isClickable ? (bulkSelecting ? 'button' : 'option') : 'presentation'}
                  aria-label={node.kind === 'species' ? node.label : undefined}
                  aria-selected={isClickable && !bulkSelecting ? isRowSelected : undefined}
                  aria-current={bulkSelecting && isRowSelected ? 'true' : undefined}
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
                    mb: 0.375,
                    pl: `calc(${0.75 + depth * 0.85}rem)`,
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
                  {crop?.display_color ? <CropColorSwatch crop={crop} /> : null}
                  <ListItemText
                    primary={highlightQuery
                      ? <HighlightedText text={rowLabel} query={highlightQuery} />
                      : rowLabel}
                    slotProps={{
                      primary: { sx: { fontSize: '0.95rem', fontWeight: node.kind === 'species' ? 700 : 500 } },
                    }} />
                </ListItemButton>
              </CropBulkSelectionRow>
            );
          })}
        </List>
      </DialogContent>
    </Dialog>
  );
}
