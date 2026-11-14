import { useEffect, useMemo, type ReactNode, type Ref, type UIEvent } from 'react';
import { List, Typography, type SxProps, type Theme } from '@mui/material';
import type { PublicCrop } from '../api/types';
import { useTranslation } from '../i18n';
import { buildCropHierarchy, getCropSpeciesKey, getFirstVarietyItem, type CropHierarchyItemKind } from './cropHierarchy';
import { flattenTreeRows } from '../components/hierarchy/utils/treeRows';
import { useExpandedState } from '../components/hierarchy/hooks/useExpandedState';
import { useCropListKeyboardNavigation } from './useCropListKeyboardNavigation';
import { useSearchExpandedGroups } from './useSearchExpandedGroups';
import { CropHierarchyRow } from './CropHierarchyRow';
import { getPublicCropTitle } from '../crop-library/publicCropDisplay';
import { CropSpeciesPendingChip } from './CropSpeciesPendingChip';
import { isCropSpeciesPending } from './cropSpeciesPending';
import { getSearchMatchedHierarchyGroupRowIds } from './cropGroupSearch';
import { normalizePublicCropSearchQuery } from './publicCropSearchMatch';

interface PublicCropHierarchyListProps {
  crops: PublicCrop[];
  selectedCropId: number | null;
  isSpeciesView: boolean;
  onSelect: (crop: PublicCrop, meta: { kind: CropHierarchyItemKind; speciesKey: string }) => void;
  ariaLabel: string;
  /** Persists expand/collapse state across remounts under this session-storage key; left in-memory-only when omitted. */
  storageKey?: string;
  /** When non-empty, ancestor rows of every matching entry are auto-expanded — mirrors search-result reveal behavior. */
  searchQuery?: string;
  autoFocusSelected?: boolean;
  emptyState?: ReactNode;
  dense?: boolean;
  sx?: SxProps<Theme>;
  listRef?: Ref<HTMLUListElement>;
  onScroll?: (event: UIEvent<HTMLUListElement>) => void;
}

/**
 * Hierarchical crop -> variety list (with "(count)" badge and expand/collapse),
 * shared by the full public crop library page and the "import from library"
 * dialog so both present the exact same tree/list behavior.
 */
export function PublicCropHierarchyList({
  crops,
  selectedCropId,
  isSpeciesView,
  onSelect,
  ariaLabel,
  storageKey,
  searchQuery,
  autoFocusSelected = false,
  emptyState,
  dense = false,
  sx,
  listRef,
  onScroll,
}: PublicCropHierarchyListProps) {
  const { t, i18n } = useTranslation('crops');
  const language = i18n.resolvedLanguage ?? i18n.language;

  const {
    expandedRows: expandedRowIds,
    toggleExpand: toggleRow,
    ensureExpanded: ensureRowExpanded,
    collapse: collapseRow,
  } = useExpandedState(storageKey);

  const normalizedSearchQuery = normalizePublicCropSearchQuery(searchQuery ?? '');
  const cropHierarchyItems = useMemo(() => buildCropHierarchy(crops), [crops]);

  const selectedCrop = useMemo(
    () => (selectedCropId === null ? null : crops.find((crop) => crop.id === selectedCropId) ?? null),
    [crops, selectedCropId],
  );

  const selectedVarietyGroupRowIds = useMemo(
    () => (selectedCrop?.variety && !isSpeciesView
      ? new Set([`species:${getCropSpeciesKey(selectedCrop)}`])
      : new Set<string>()),
    [isSpeciesView, selectedCrop],
  );

  useEffect(() => {
    if (!selectedCrop?.variety || isSpeciesView) {
      return;
    }
    const varietyItem = cropHierarchyItems.find((item) => item.kind === 'variety' && item.crop?.id === selectedCrop.id);
    if (varietyItem?.parentId) {
      ensureRowExpanded(varietyItem.parentId);
    }
  }, [cropHierarchyItems, ensureRowExpanded, isSpeciesView, selectedCrop]);

  useEffect(() => {
    selectedVarietyGroupRowIds.forEach((rowId) => ensureRowExpanded(rowId));
  }, [ensureRowExpanded, selectedVarietyGroupRowIds]);

  const matchedGroupRowIds = useMemo(
    () => getSearchMatchedHierarchyGroupRowIds(cropHierarchyItems, normalizedSearchQuery),
    [cropHierarchyItems, normalizedSearchQuery],
  );

  useSearchExpandedGroups({
    matchedGroupRowIds,
    isExpanded: (rowId) => expandedRowIds.has(rowId),
    ensureExpanded: ensureRowExpanded,
    collapse: collapseRow,
    keepExpandedRowIds: selectedVarietyGroupRowIds,
  });

  const visibleRows = useMemo(
    () => flattenTreeRows(cropHierarchyItems, { expandedIds: expandedRowIds }),
    [cropHierarchyItems, expandedRowIds],
  );

  const navigableRows = useMemo(
    () => visibleRows.map((row) => row.node),
    [visibleRows],
  );

  const selectedRowId = selectedCrop
    ? (isSpeciesView ? `species:${getCropSpeciesKey(selectedCrop)}` : `crop:${selectedCrop.id}`)
    : null;

  const listNavigation = useCropListKeyboardNavigation({
    items: navigableRows,
    selectedId: selectedRowId,
    getId: (item) => item.id,
    onSelect: (item) => {
      if (item.crop) {
        onSelect(item.crop, { kind: item.kind, speciesKey: item.speciesKey });
      }
    },
    autoFocusSelected,
  });

  if (visibleRows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <List
      ref={listRef}
      {...listNavigation.getListProps()}
      dense={dense}
      role="listbox"
      aria-label={ariaLabel}
      onScroll={onScroll}
      sx={sx}
    >
      {visibleRows.map(({ node, depth, hasChildren }) => {
        const crop = node.crop;
        // A species row with no dedicated varietyless entry (crop === null) has
        // nothing of its own to show, but always has at least one variety
        // underneath it — clicking it selects that first variety instead of
        // leaving the row inert.
        const firstVarietyCrop = !crop
          ? getFirstVarietyItem(cropHierarchyItems, node.id)?.crop ?? null
          : null;
        const isClickable = crop?.id !== undefined || firstVarietyCrop !== null;
        const itemProps = isClickable ? listNavigation.getItemProps(node) : {};
        // A proposed species is pending for every entry beneath it, so the
        // marker sits on the species row — including species rows that only
        // exist through their varieties.
        const showPendingMarker = node.kind === 'species'
          && isCropSpeciesPending(crop ?? firstVarietyCrop);
        const isRowSelected = Boolean(
          crop?.id !== undefined
          && crop.id === selectedCropId
          && (node.kind === 'species' ? isSpeciesView : !isSpeciesView),
        );
        return (
          <CropHierarchyRow
            key={node.id}
            itemProps={itemProps}
            depth={depth}
            hasChildren={hasChildren}
            isExpanded={expandedRowIds.has(node.id)}
            onToggleExpand={() => toggleRow(node.id)}
            expandLabel={t('hierarchy.expandCrop')}
            collapseLabel={t('hierarchy.collapseCrop')}
            isSelected={isRowSelected}
            isClickable={isClickable}
            ariaLabel={node.kind === 'species'
              ? node.label
              : crop ? getPublicCropTitle(crop, language, t('library.translation.missingName')) : undefined}
            primary={node.label}
            isPrimaryEmphasized={node.kind === 'species'}
            secondary={crop?.project_import_status ? t('library.linkExisting.alreadyLinked') : undefined}
            varietyCount={node.kind === 'species' ? node.varietyCount : undefined}
            showZeroVarietyCount={node.kind === 'species' && Boolean(normalizedSearchQuery)}
            highlightQuery={normalizedSearchQuery}
            endAdornment={showPendingMarker ? <CropSpeciesPendingChip iconOnly /> : undefined}
            isPendingSuggestion={showPendingMarker}
            onKeyboardActivate={() => {
              if (node.kind !== 'species' || !hasChildren) {
                return false;
              }
              toggleRow(node.id);
              return true;
            }}
            onClick={() => {
              if (crop?.id !== undefined) {
                listNavigation.selectItem(node);
              } else if (firstVarietyCrop) {
                ensureRowExpanded(node.id);
                onSelect(firstVarietyCrop, { kind: 'variety', speciesKey: node.speciesKey });
              }
            }}
            onDoubleClick={(event) => {
              if (!hasChildren) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              toggleRow(node.id);
            }}
          />
        );
      })}
    </List>
  );
}

export function PublicCropHierarchyEmpty({ message }: { message: string }) {
  return <Typography color="text.secondary" sx={{ p: 2 }}>{message}</Typography>;
}
