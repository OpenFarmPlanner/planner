import { SpecificPropertiesDetails } from './SpecificPropertiesDetails';
import { CropSupplierDataSection } from './CropSupplierDataSection';
import { CropTaskTemplatesSection } from './CropTaskTemplatesSection';
/**
 * Crop Detail component with searchable dropdown and detailed crop information view.
 */

import { germinationDetailFields, formatGerminationValue } from './germination';
import { SITE_HEALTH_FIELDS, formatSiteHealthValue } from './siteHealth';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import { useSearchParams } from 'react-router';
import { useTranslation } from '../i18n';
import { AppTooltip } from '../components/AppTooltip';
import { CropFiltersPopover } from './CropFiltersPopover';
import { CropMobileSelectorDialog } from './CropMobileSelectorDialog';
import { CropHeaderActionsMenu } from './CropHeaderActionsMenu';
import { CropTitleSelectorButton } from './CropTitleSelectorButton';
import TuneIcon from '@mui/icons-material/Tune';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import AddIcon from '@mui/icons-material/Add';
import { CropHierarchyRow } from './CropHierarchyRow';
import { PublicCropUpdateDialog } from './PublicCropUpdateDialog';
import { CropLibraryActionButton } from './CropLibraryActionButton';
import { CropLibraryPinnedChip } from './CropLibraryPinnedChip';
import { LibraryPinIndicator, ValueWithLibraryPin } from './LibraryPinIndicator';
import { getLibraryPinnedValueLabel, isLibraryFieldPinned, type LibraryPinFormField } from './libraryFieldPin';
import { CropLibraryStatusIcon } from './CropLibraryStatusIcon';
import { canUnlinkPublicCrop, type CropLibraryTrigger } from './cropLibraryAction';
import { CropSpeciesPendingChip } from './CropSpeciesPendingChip';
import { getSeedTypeLabel, matchesSeedTypeFilter } from './seedType';
import { usePublicCropUpdate } from './usePublicCropUpdate';
import {
  Badge,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Typography,
  Chip,
  Divider,
  List,
  Stack,
  Button,
  IconButton,
  TextField,
} from '@mui/material';
import type { Crop } from '../api/api';
import EmptyStateCard from '../components/project/EmptyStateCard';
import { useCropListKeyboardNavigation } from './useCropListKeyboardNavigation';
import { useSearchExpandedGroups } from './useSearchExpandedGroups';
import { DetailPageActions } from '../components/layout/DetailPageActions';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { getCropDisplayName } from './cropDisplay';
import {
  type ProjectCropHierarchyItem,
  buildCropHierarchy,
  findSpeciesCrop,
  getCropSpeciesKey,
  getFirstVarietyItem,
} from './cropHierarchy';
import {
  cropMatchesSearchQuery,
  normalizeCropSearchQuery,
} from './cropSearchMatch';
import { filterCropGroupsForSearch } from './cropGroupSearch';
import { flattenTreeRows } from '../components/hierarchy/utils/treeRows';
import { useExpandedState } from '../components/hierarchy/hooks/useExpandedState';
import { usePreservedScrollPosition } from '../hooks/usePreservedScrollPosition';
import { CropSeedDetails, type CropSeedRateRow, type ValueSource } from './CropSeedDetails';
import { VarietyValueLegend } from './VarietyValueLegend';
import { CropVarietiesOverview } from './CropVarietiesOverview';
import { CropCompanionsSection } from './CropCompanionsSection';
import { varietySpecificValueHighlightSx } from './varietyValueAccent';
import { getEffectiveCropValue, isEmptyCropValue, getVarietyOwnValueSource } from './varietyValueSource';
import { collectProjectTags, getEffectiveCropTags } from './cropTags';
import { buildLocalizedText } from '../crop-library/publicCropDisplay';
import { LocalizedMarkdownNotes } from '../crop-library/components/LocalizedMarkdownNotes';

interface CropDetailProps {
  crops: Crop[];
  isLoading?: boolean;
  selectedCropId?: number;
  onCropSelect: (crop: Crop | null) => void;
  /**
   * Selecting a variety by clicking its row in the Varieties comparison
   * table — a deliberate "go to this variety" navigation, so (unlike
   * `onCropSelect`, used for sidebar browsing) it should push a new
   * history entry. Falls back to `onCropSelect` if not provided.
   */
  onNavigateToVariety?: (crop: Crop) => void;
  onCreateCrop?: () => void;
  onOpenPublicLibrary?: () => void;
  onImportFile?: () => void;
  onEditCrop?: (crop: Crop) => void;
  onEditCompanions?: (crop: Crop) => void;
  onAddVariety?: (speciesCrop: Crop) => void;
  onCreatePlan?: () => void;
  onOpenHistory?: () => void;
  onExportCrop?: () => void;
  onPublishCrop?: () => void;
  /** Called after a pending public-library update was applied to the selected crop. */
  onPublicUpdateApplied?: () => void;
  onSupplierDataSaved?: (crop: Crop) => void;
  onDeleteCrop?: (crop: Crop) => void;
  /** Opens the "Verknüpfung aufheben" confirmation for the selected crop. */
  onUnlinkPublicCrop?: (crop: Crop) => void;
  canCreatePlan?: boolean;
  createPlanDisabledTooltip?: string;
  isPublishingCrop?: boolean;
  searchInputRef?: Ref<HTMLInputElement>;
}

import {
  formatDistance,
  formatSowingDepth,
  formatNumber,
} from './cropDetailFormatters';
import { usePersistedCropFilters } from './usePersistedCropFilters';
import { CropTimingWindowsDetail } from './CropTimingWindowsDetail';
import { hasAnyDetailValue, hasDetailValue } from './cropDetailFieldVisibility';
import { canBeSownInMonth } from './timingWindows';
import { usePlantFamilies } from './plantFamilies';
import { detailHeaderRowSx, detailHeaderTitleColumnSx, detailHeaderTitleTextSx } from '../components/layout/detailHeaderStyles';


export function CropDetail({
  crops,
  isLoading = false,
  selectedCropId,
  onCropSelect,
  onNavigateToVariety,
  onCreateCrop,
  onOpenPublicLibrary,
  onImportFile,
  onEditCrop,
  onEditCompanions,
  onAddVariety,
  onCreatePlan,
  onOpenHistory,
  onExportCrop,
  onPublishCrop,
  onPublicUpdateApplied,
  onSupplierDataSaved,
  onDeleteCrop,
  onUnlinkPublicCrop,
  canCreatePlan = true,
  createPlanDisabledTooltip,
  isPublishingCrop = false,
  searchInputRef,
}: CropDetailProps) {
  const { t, i18n } = useTranslation('crops');
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language;
  const plantFamilies = usePlantFamilies();
  const locale = resolveLocaleFromLanguage(currentLanguage);
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const isMobileLayout = useMediaQuery(theme.breakpoints.down('sm'));
  const isMobileLandscapeLayout = useMediaQuery(
    `${theme.breakpoints.between('sm', 'md')} and (orientation: landscape) and (max-height: 560px)`,
  );
  const useUnifiedMobileLayout = isMobileLayout || isMobileLandscapeLayout;
  const detailAreaRef = useRef<HTMLDivElement>(null);
  // How tall the two-pane area is allowed to be, measured directly from where it
  // actually starts in the viewport rather than guessed via a hardcoded "chrome
  // height" offset (which drifts whenever the surrounding header/layout changes
  // and silently leaves the panes shorter than the available space).
  const [detailAreaMaxHeight, setDetailAreaMaxHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (useUnifiedMobileLayout) {
      return undefined;
    }
    const element = detailAreaRef.current;
    if (!element) {
      return undefined;
    }
    const updateMaxHeight = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      // The page wrapper's margin and main's padding both follow the panes.
      // A fixed bottom allowance misses those spaces and overflows the document.
      let bottomSpacing = 0;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        bottomSpacing += [style.marginBottom, style.paddingBottom, style.borderBottomWidth]
          .reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
        if (ancestor.tagName === 'MAIN') break;
      }
      // In very short windows keep the selector and a few rows usable; the
      // document may scroll there instead of crushing or clipping the controls.
      setDetailAreaMaxHeight(Math.max(280, window.innerHeight - top - bottomSpacing));
    };
    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateMaxHeight) : undefined;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      resizeObserver?.observe(ancestor);
    }
    return () => {
      window.removeEventListener('resize', updateMaxHeight);
      resizeObserver?.disconnect();
    };
  }, [useUnifiedMobileLayout, isLoading, crops.length]);

  const { filters, updateFilter, resetFilters } = usePersistedCropFilters(searchParams, setSearchParams);
  // The clear button unmounts as it empties the field, so focus has to be put
  // back on the input explicitly instead of dropping to the document body.
  // The input is addressed by id because `searchInputRef` belongs to the
  // caller and may be a callback ref this component cannot read back.
  const searchFieldId = useId();
  const [filterAnchorEl, setFilterAnchorEl] = useState<HTMLElement | null>(null);
  const [headerMenuAnchorEl, setHeaderMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [mobileSelectorOpen, setMobileSelectorOpen] = useState(false);
  const [selectedSpeciesViewKey, setSelectedSpeciesViewKey] = useState<string | null>(null);
  const {
    expandedRows: expandedCropRows,
    toggleExpand: toggleCropRow,
    ensureExpanded: ensureCropRowExpanded,
    collapse: collapseCropRow,
  } = useExpandedState('projectCropLibrary');
  const isFilterPopoverOpen = Boolean(filterAnchorEl);
const detailSectionStackSx = {
    '& > * + *': { borderTop: '1px solid', borderTopColor: 'divider', pt: 2.5 },
  } as const;
const detailSectionGridSx = {
    display: 'grid',
    gridTemplateColumns: {
      xs: '1fr',
      sm: 'repeat(2, minmax(180px, 1fr))',
      lg: 'repeat(3, minmax(180px, 1fr))',
    },
    gap: 2,
    justifyContent: 'start',
    } as const;
  const activeFilterCount = useMemo(
    () => {
      const filterValues = [
        filters.selectedFamilyFilter,
        filters.selectedTagFilter,
        filters.selectedCultivationFilter,
        filters.selectedNutrientFilter,
        filters.selectedSeedTypeFilter,
        filters.selectedSupplierFilter,
        filters.growthDaysMin,
        filters.growthDaysMax,
        filters.yieldMin,
        filters.yieldMax,
        filters.sowingMonth,
      ];
      return filterValues.filter((value) => value.length > 0).length;
    },
    [filters],
  );

  const familyOptions = useMemo(
    () => Array.from(new Set(
      crops
        .map((crop) => getEffectiveCropValue(crop, 'crop_family'))
        .filter((entry): entry is string => Boolean(entry))
    )),
    [crops]
  );

  const tagOptions = useMemo(() => collectProjectTags(crops), [crops]);
  const supplierOptions = useMemo(
    () => {
      const suppliersById = new Map<string, string>();

      crops.forEach((crop) => {
        if (crop.supplier?.id !== undefined) {
          suppliersById.set(String(crop.supplier.id), crop.supplier.name);
        }

        crop.supplier_data?.forEach((supplierRow) => {
          const supplierId = supplierRow.supplier_id ?? supplierRow.supplier?.id;
          const supplierName = supplierRow.supplier?.name ?? supplierRow.supplier_name;
          if (typeof supplierId === 'number' && supplierName) {
            suppliersById.set(String(supplierId), supplierName);
          }
        });
      });

      const options = Array.from(suppliersById.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name, 'de'));

      if (
        filters.selectedSupplierFilter
        && !options.some((option) => option.id === filters.selectedSupplierFilter)
      ) {
        return [
          ...options,
          {
            id: filters.selectedSupplierFilter,
            name: t('filters.unknownSupplier', { id: filters.selectedSupplierFilter }),
          },
        ];
      }

      return options;
    },
    [crops, filters.selectedSupplierFilter, t],
  );

  const normalizedSearchQuery = normalizeCropSearchQuery(filters.searchQuery);

  // Every filter except the search term. The search runs on top of this
  // because it widens matches to whole Kultur groups (see below), and that
  // widening must never reach past the other filters.
  const filterMatchingCrops = useMemo(() => {
    const parsedGrowthDaysMin = filters.growthDaysMin ? Number(filters.growthDaysMin) : null;
    const parsedGrowthDaysMax = filters.growthDaysMax ? Number(filters.growthDaysMax) : null;
    const parsedYieldMin = filters.yieldMin ? Number(filters.yieldMin) : null;
    const parsedYieldMax = filters.yieldMax ? Number(filters.yieldMax) : null;

    const selectedSupplierId = filters.selectedSupplierFilter ? Number(filters.selectedSupplierFilter) : null;
    return crops.filter((crop) => {
      const familyMatches = filters.selectedFamilyFilter.length === 0
        || getEffectiveCropValue(crop, 'crop_family') === filters.selectedFamilyFilter;
      const effectiveTags = getEffectiveCropTags(crop).map((tag) => tag.toLocaleLowerCase());
      const tagMatches = filters.selectedTagFilter.every((tag) => (
        effectiveTags.includes(tag.toLocaleLowerCase())
      ));
      const effectiveCultivationTypes = getEffectiveCropValue(crop, 'cultivation_types');
      const effectiveCultivationType = getEffectiveCropValue(crop, 'cultivation_type');
      const cultivationValues = effectiveCultivationTypes?.length
        ? effectiveCultivationTypes
        : (effectiveCultivationType ? [effectiveCultivationType] : []);
      const cultivationMatches = (
        filters.selectedCultivationFilter.length === 0
        || (filters.selectedCultivationFilter === 'both'
          ? cultivationValues.includes('direct_sowing') && cultivationValues.includes('pre_cultivation')
          : cultivationValues.includes(filters.selectedCultivationFilter as 'direct_sowing' | 'pre_cultivation'))
      );
      const effectiveGrowthDays = getEffectiveCropValue(crop, 'growth_duration_days');
      const growthValue = typeof effectiveGrowthDays === 'number' ? effectiveGrowthDays : null;
      const growthMatches = (
        (parsedGrowthDaysMin === null || (growthValue !== null && growthValue >= parsedGrowthDaysMin))
        && (parsedGrowthDaysMax === null || (growthValue !== null && growthValue <= parsedGrowthDaysMax))
      );
      const nutrientMatches = filters.selectedNutrientFilter.length === 0
        || getEffectiveCropValue(crop, 'nutrient_demand') === filters.selectedNutrientFilter;
      const effectiveYield = getEffectiveCropValue(crop, 'expected_yield');
      const yieldValue = typeof effectiveYield === 'number' ? effectiveYield : null;
      const yieldMatches = (
        (parsedYieldMin === null || (yieldValue !== null && yieldValue >= parsedYieldMin))
        && (parsedYieldMax === null || (yieldValue !== null && yieldValue <= parsedYieldMax))
      );
      const supplierIds = [
        crop.supplier?.id,
        crop.selected_seed_demand_supplier,
        ...(crop.supplier_data ?? []).map((supplierRow) => supplierRow.supplier_id ?? supplierRow.supplier?.id),
      ];
      const supplierMatches = selectedSupplierId === null
        || supplierIds.some((supplierId) => supplierId === selectedSupplierId);
      const sowingMatches = canBeSownInMonth(crop, filters.sowingMonth);
      const seedTypeMatches = matchesSeedTypeFilter(crop, filters.selectedSeedTypeFilter);

      return familyMatches
        && tagMatches
        && cultivationMatches
        && growthMatches
        && nutrientMatches
        && seedTypeMatches
        && yieldMatches
        && supplierMatches
        && sowingMatches;
    });
  }, [
    crops,
    filters,
  ]);

  const { filteredCrops, matchedGroupRowIds } = useMemo(
    () => filterCropGroupsForSearch({
      crops,
      filterMatchingCrops,
      normalizedSearchQuery,
      matchesSearchQuery: cropMatchesSearchQuery,
    }),
    [crops, filterMatchingCrops, normalizedSearchQuery],
  );

  const cropHierarchyItems = useMemo(
    () => buildCropHierarchy(filteredCrops),
    [filteredCrops],
  );

  const visibleCropRows = useMemo(
    () => flattenTreeRows(cropHierarchyItems, { expandedIds: expandedCropRows }),
    [cropHierarchyItems, expandedCropRows],
  );

  // Every row the arrow keys stop on: the Kultur group headers plus the Sorten
  // of the groups that are open. Rows hidden behind a collapsed header are not
  // stops — the list walks exactly what is on screen.
  const navigableCropRows = useMemo(
    () => visibleCropRows.map((row) => row.node),
    [visibleCropRows],
  );

  const selectedCrop = useMemo(
    () => crops.find((crop) => crop.id === selectedCropId) ?? null,
    [crops, selectedCropId],
  );
  const localizedNotes = useMemo(
    () => buildLocalizedText(
      selectedCrop?.notes,
      selectedCrop?.description_language_code,
      currentLanguage,
      '',
    ),
    [currentLanguage, selectedCrop],
  );
  const publicUpdate = usePublicCropUpdate(selectedCrop, onPublicUpdateApplied);
  // The variety is published, but under a species a moderator has not
  // confirmed yet — visible as a chip, and the library sync waits for it
  // (the badge-row action button disables itself in that case).
  const isPublishedUnderPendingSpecies = Boolean(selectedCrop?.public_crop_species_pending);
  const selectedCropSpeciesKey = selectedCrop ? getCropSpeciesKey(selectedCrop) : null;
  const isSelectedSpeciesEntry = Boolean(selectedCrop && !(selectedCrop.variety || '').trim());
  const isSpeciesView = Boolean(
    selectedCrop
    && (
      isSelectedSpeciesEntry
      || (selectedSpeciesViewKey !== null && selectedSpeciesViewKey === selectedCropSpeciesKey)
    ),
  );

  // The group holding the selected Sorte: kept open so the selected row can
  // never drop out of the list while the detail view still shows it.
  const selectedVarietyGroupRowIds = useMemo(
    () => (selectedCrop?.variety && !isSpeciesView && selectedCropSpeciesKey
      ? new Set([`species:${selectedCropSpeciesKey}`])
      : new Set<string>()),
    [isSpeciesView, selectedCrop, selectedCropSpeciesKey],
  );

  useEffect(() => {
    selectedVarietyGroupRowIds.forEach((rowId) => ensureCropRowExpanded(rowId));
  }, [ensureCropRowExpanded, selectedVarietyGroupRowIds]);
  useSearchExpandedGroups({
    matchedGroupRowIds,
    isExpanded: (rowId) => expandedCropRows.has(rowId),
    ensureExpanded: ensureCropRowExpanded,
    collapse: collapseCropRow,
    keepExpandedRowIds: selectedVarietyGroupRowIds,
  });

  const selectedCropRowId = selectedCrop
    ? (isSpeciesView && selectedCropSpeciesKey ? `species:${selectedCropSpeciesKey}` : `crop:${selectedCrop.id}`)
    : null;

  const cropListNavigation = useCropListKeyboardNavigation({
    items: navigableCropRows,
    selectedId: selectedCropRowId,
    getId: (item) => item.id,
    onSelect: (item) => {
      if (item.crop) {
        setSelectedSpeciesViewKey(item.kind === 'species' ? item.speciesKey : null);
        onCropSelect(item.crop);
      }
    },
  });

  // A list row's library status icon opens the same dialog as the badge-row
  // button, and both dialogs act on the selected crop. Clicking the icon of
  // another row therefore selects that row first and opens the dialog once the
  // selection has landed. A ref, not state: it only bridges one selection.
  const pendingListLibraryActionRef = useRef<{
    cropId: number;
    fromCropId: number | null;
    trigger: CropLibraryTrigger;
  } | null>(null);
  const runLibraryTrigger = useCallback((trigger: CropLibraryTrigger): void => {
    // Same guards as the badge-row button, which is disabled while a publish
    // of the selected crop is in flight or while its diff is loading.
    if (trigger === 'publish') {
      if (!isPublishingCrop) {
        onPublishCrop?.();
      }
    } else if (!publicUpdate.isLoading) {
      publicUpdate.openDiff();
    }
  }, [isPublishingCrop, onPublishCrop, publicUpdate]);
  const handleListLibraryAction = (node: ProjectCropHierarchyItem, trigger: CropLibraryTrigger): void => {
    const cropId = node.crop?.id;
    if (cropId === undefined) {
      return;
    }
    if (selectedCrop?.id === cropId) {
      runLibraryTrigger(trigger);
      return;
    }
    pendingListLibraryActionRef.current = { cropId, fromCropId: selectedCrop?.id ?? null, trigger };
    cropListNavigation.selectItem(node, false);
  };
  useEffect(() => {
    const pending = pendingListLibraryActionRef.current;
    if (!pending) {
      return;
    }
    const currentCropId = selectedCrop?.id ?? null;
    if (currentCropId === pending.cropId) {
      pendingListLibraryActionRef.current = null;
      runLibraryTrigger(pending.trigger);
    } else if (currentCropId !== pending.fromCropId) {
      // The selection went somewhere else; never open a dialog for it later.
      pendingListLibraryActionRef.current = null;
    }
  }, [runLibraryTrigger, selectedCrop]);

  // Declared after the keyboard navigation hook on purpose: both act on the
  // list in the same commit, and the restored offset must win over the
  // "scroll the selected row into view" the navigation hook does on mount.
  const {
    scrollableRef: cropListScrollableRef,
    onScroll: handleCropListScroll,
  } = usePreservedScrollPosition<HTMLUListElement>();

  const selectedSpeciesCrop = useMemo(
    () => findSpeciesCrop(selectedCrop, crops),
    [crops, selectedCrop],
  );

  // Siblings of the current selection within its species group — shown as
  // the "Varieties" list regardless of whether a species (general) row or
  // one of its varieties is currently selected, since a species group with
  // no general entry (all legacy data, until now) would otherwise have no
  // way to reach "add a variety" at all.
  const varietySiblings = useMemo(
    () => (
      selectedCropSpeciesKey
        ? cropHierarchyItems.filter((item) => (
          item.kind === 'variety'
          && item.speciesKey === selectedCropSpeciesKey
          && item.crop?.id !== selectedCrop?.id
        ))
        : []
    ),
    [cropHierarchyItems, selectedCrop, selectedCropSpeciesKey],
  );
  const varietyAddContext = isSpeciesView ? selectedCrop : (selectedSpeciesCrop ?? selectedCrop);
  const addVarietyButton = (
    <Button
      size="small"
      variant="outlined"
      startIcon={<AddIcon fontSize="small" />}
      disabled={!onAddVariety || !varietyAddContext}
      onClick={() => {
        if (varietyAddContext) {
          onAddVariety?.(varietyAddContext);
        }
      }}
    >
      {t('hierarchy.addVariety')}
    </Button>
  );

  const getCropValueSource = useCallback((
    field: keyof Crop,
  ): ValueSource | null => (
    isSpeciesView ? null : getVarietyOwnValueSource(selectedCrop, selectedSpeciesCrop, field)
  ), [isSpeciesView, selectedCrop, selectedSpeciesCrop]);

  const getCropValue = useCallback(<TValue,>(
    field: keyof Crop,
    value: TValue,
  ): TValue => {
    if (
      selectedCrop?.variety
      && !isSpeciesView
      && selectedSpeciesCrop
      && isEmptyCropValue(value)
    ) {
      return selectedSpeciesCrop[field] as TValue;
    }
    return value;
  }, [isSpeciesView, selectedCrop?.variety, selectedSpeciesCrop]);

  const getOwnValueSx = (...fields: (keyof Crop)[]) => (
    fields.some((field) => getCropValueSource(field) === 'ownValue')
      ? varietySpecificValueHighlightSx
      : undefined
  );

  const showSeedType = !isSpeciesView && Boolean(selectedCrop?.variety);
  const getLibraryPin = (field: LibraryPinFormField) => (
    selectedCrop?.source_public_crop && isLibraryFieldPinned(selectedCrop, field)
      ? (
        <LibraryPinIndicator
          libraryValue={getLibraryPinnedValueLabel(selectedCrop.library_pinned_values ?? {}, field, t)}
          t={t}
        />
      )
      : null
  );

  const showVarietyValueLegend = Boolean(!isSpeciesView && selectedCrop?.variety && selectedSpeciesCrop);

  const activeCultivationTypes = useMemo(
    () => (
      selectedCrop
        ? (
          getCropValue('cultivation_types', selectedCrop.cultivation_types) && getCropValue('cultivation_types', selectedCrop.cultivation_types)?.length
            ? getCropValue('cultivation_types', selectedCrop.cultivation_types) ?? []
            : (getCropValue('cultivation_type', selectedCrop.cultivation_type) ? [getCropValue('cultivation_type', selectedCrop.cultivation_type)] : [])
        ).filter((item): item is 'direct_sowing' | 'pre_cultivation' => (
          item === 'direct_sowing' || item === 'pre_cultivation'
        ))
        : []
    ),
    [getCropValue, selectedCrop]
  );
  const seedRateRows = useMemo<CropSeedRateRow[]>(() => {
    if (!selectedCrop) {
      return [];
    }
    const isDirectActive = activeCultivationTypes.includes('direct_sowing');
    const isPreCultivationActive = activeCultivationTypes.includes('pre_cultivation');
    const directValue = getCropValue('seed_rate_direct_value', selectedCrop.seed_rate_direct_value);
    const directUnit = getCropValue('seed_rate_direct_unit', selectedCrop.seed_rate_direct_unit);
    const preCultivationValue = getCropValue('seed_rate_pre_cultivation_value', selectedCrop.seed_rate_pre_cultivation_value);
    const preCultivationUnit = getCropValue('seed_rate_pre_cultivation_unit', selectedCrop.seed_rate_pre_cultivation_unit);

    const rows: CropSeedRateRow[] = [];
    if (
      isDirectActive
      && directValue !== null
      && directValue !== undefined
      && directUnit
    ) {
      rows.push({
        method: 'direct_sowing',
        value: directValue,
        unit: directUnit,
        safety: getCropValue('sowing_calculation_safety_percent_direct', selectedCrop.sowing_calculation_safety_percent_direct) ?? null,
        valueSource: getCropValueSource('seed_rate_direct_value') ?? getCropValueSource('seed_rate_direct_unit'),
        safetySource: getCropValueSource('sowing_calculation_safety_percent_direct'),
      });
    }
    if (
      isPreCultivationActive
      && preCultivationValue !== null
      && preCultivationValue !== undefined
      && preCultivationUnit
    ) {
      rows.push({
        method: 'pre_cultivation',
        value: preCultivationValue,
        unit: preCultivationUnit,
        safety: getCropValue('sowing_calculation_safety_percent_pre_cultivation', selectedCrop.sowing_calculation_safety_percent_pre_cultivation) ?? null,
        valueSource: getCropValueSource('seed_rate_pre_cultivation_value') ?? getCropValueSource('seed_rate_pre_cultivation_unit'),
        safetySource: getCropValueSource('sowing_calculation_safety_percent_pre_cultivation'),
      });
    }

    if (rows.length > 0) {
      return rows;
    }

    const seedRateByCultivation = getCropValue('seed_rate_by_cultivation', selectedCrop.seed_rate_by_cultivation);
    if (seedRateByCultivation && Object.keys(seedRateByCultivation).length > 0) {
      return Object.entries(seedRateByCultivation)
        .filter(([method, payload]) => (
          activeCultivationTypes.includes(method as 'direct_sowing' | 'pre_cultivation')
          && (
          (method === 'direct_sowing' || method === 'pre_cultivation')
          && payload
          && typeof payload.value === 'number'
          && typeof payload.unit === 'string'
          )
        ))
        .map(([method, payload]) => ({
          method: method as 'direct_sowing' | 'pre_cultivation',
          value: payload.value,
          unit: payload.unit,
          safety: null,
          valueSource: getCropValueSource('seed_rate_by_cultivation'),
          safetySource: null,
        } satisfies CropSeedRateRow));
    }

    const generalSeedRateValue = getCropValue('seed_rate_value', selectedCrop.seed_rate_value);
    const generalSeedRateUnit = getCropValue('seed_rate_unit', selectedCrop.seed_rate_unit);
    if (
      activeCultivationTypes.length > 0
      && generalSeedRateValue !== null
      && generalSeedRateValue !== undefined
      && generalSeedRateUnit
    ) {
      return [{
        method: activeCultivationTypes.includes('direct_sowing') ? 'direct_sowing' : 'pre_cultivation',
        value: generalSeedRateValue,
        unit: generalSeedRateUnit,
        safety: getCropValue('sowing_calculation_safety_percent', selectedCrop.sowing_calculation_safety_percent) ?? null,
        valueSource: getCropValueSource('seed_rate_value') ?? getCropValueSource('seed_rate_unit'),
        safetySource: getCropValueSource('sowing_calculation_safety_percent'),
      }];
    }

    return [];
  }, [activeCultivationTypes, getCropValue, getCropValueSource, selectedCrop]);

  const selectorControl = crops.length > 0 ? (
      <Box sx={{ width: '100%', p: 1.25, borderBottom: '1px solid', borderColor: 'surface.surfaceBorder', bgcolor: 'surface.surfaceSubtleBackground' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, }} >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <TextField
              label={t('searchPlaceholder')}
              placeholder={t('searchInputPlaceholderEnhanced')}
              id={searchFieldId}
              inputRef={searchInputRef}
              value={filters.searchQuery}
              onChange={(event) => updateFilter('searchQuery', event.target.value)}
              fullWidth
              slotProps={{
                input: {
                  endAdornment: (
                    <>
                      {filters.searchQuery ? (
                        <AppTooltip title={t('clearSearch')}>
                          <IconButton
                            size="small"
                            aria-label={t('clearSearch')}
                            onClick={() => {
                              updateFilter('searchQuery', '');
                              document.getElementById(searchFieldId)?.focus();
                            }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </AppTooltip>
                      ) : null}
                      <IconButton
                        size="small"
                        onClick={(event) => setFilterAnchorEl(event.currentTarget)}
                        aria-expanded={isFilterPopoverOpen}
                        aria-haspopup="dialog"
                        aria-controls={isFilterPopoverOpen ? 'crop-filters-popover' : undefined}
                        aria-label={t('filters.openAdvanced')}
                        sx={{ bgcolor: activeFilterCount > 0 ? 'action.selected' : 'transparent' }}
                      >
                        <Badge color="primary" badgeContent={activeFilterCount > 0 ? activeFilterCount : null}>
                          <TuneIcon fontSize="small" />
                        </Badge>
                      </IconButton>
                    </>
                  ),
                },
              }}
            />
          </Box>
        </Stack>

        <CropFiltersPopover
          anchorEl={filterAnchorEl}
          onClose={() => setFilterAnchorEl(null)}
          filters={filters}
          onFilterChange={updateFilter}
          familyOptions={familyOptions}
          tagOptions={tagOptions}
          supplierOptions={supplierOptions}
          onReset={() => {
            resetFilters();
            setFilterAnchorEl(null);
          }}
        />
      </Box>
  ) : null;

  return (
    <Box sx={{ width: '100%' }}>
      {/* Detail View */}
      {!isLoading && crops.length > 0 ? (
        <Box
          ref={detailAreaRef}
          sx={{
      display: 'flex',
      flexDirection: useUnifiedMobileLayout ? 'column' : { xs: 'column', md: 'row' },
      gap: { xs: 1.25, lg: 1.1, xl: 1.25 },
      height: {
              md: detailAreaMaxHeight !== null ? `${detailAreaMaxHeight}px` : 'calc(100vh - 210px)',
            },
          }}
        >
          {!useUnifiedMobileLayout ? (<Card
            sx={{
              width: { md: 230, lg: 300, xl: 330 },
              flexShrink: 0,
              height: { md: '100%' },
              // Flex items default to `min-height: auto`, which ignores the
              // parent's bounded height and lets content push the card taller
              // than its 100% instead of letting the inner list scroll.
              minHeight: { xs: 280, md: 0 },
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              border: '1px solid',
              borderColor: 'surface.surfaceBorder',
              boxShadow: 1,
              borderRadius: 2,
            }}
          >
            {selectorControl}
            {visibleCropRows.length === 0 ? (
              // Rendered instead of the listbox, not inside it: a plain <li>
              // in there carries no role of its own and gets pruned, and an
              // empty listbox would still flex-grow and push the message to
              // the bottom of the card. Mirrors the public crop library page.
              <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 2 }}>
                {t('noOptionsEnhanced')}
              </Typography>
            ) : (
            <List
              {...cropListNavigation.getListProps()}
              ref={cropListScrollableRef}
              onScroll={handleCropListScroll}
              dense
              role="listbox"
              aria-label={t('title')}
              sx={{
                py: { xs: 0.5, lg: 0.75 },
                px: { xs: 0.5, lg: 0.75 },
                overflowY: 'auto',
                // MUI breakpoint values cascade upward when not overridden, so the
                // sub-md formula must be explicitly cleared at md+ or it silently
                // caps the list there too instead of letting it fill the card via flex.
                maxHeight: { sm: 'calc(100vh - 290px)', md: 'none' },
                flex: { md: 1 },
                minHeight: 0,
              }}
            >
              {visibleCropRows.map(({ node, depth, hasChildren }) => {
                const crop = node.crop;
                // A species row with no dedicated varietyless entry has nothing of its
                // own to select — but it always has at least one variety underneath it,
                // so clicking it selects that first variety instead of leaving the row
                // inert. Mirrors the public crop library list (PublicCropLibraryPage.tsx).
                const firstVariety = !crop ? getFirstVarietyItem(cropHierarchyItems, node.id) : null;
                const isClickable = crop?.id !== undefined || firstVariety !== null;
                const itemProps = cropListNavigation.getItemProps(node);
                const isRowSelected = Boolean(
                  crop?.id !== undefined
                  && selectedCrop?.id === crop.id
                  && (node.kind === 'species' ? isSpeciesView : !isSpeciesView),
                );

                return (
                  <CropHierarchyRow
                    key={node.id}
                    itemProps={itemProps}
                    depth={depth}
                    hasChildren={hasChildren}
                    isExpanded={expandedCropRows.has(node.id)}
                    onToggleExpand={() => toggleCropRow(node.id)}
                    expandLabel={t('hierarchy.expandCrop')}
                    collapseLabel={t('hierarchy.collapseCrop')}
                    isSelected={isRowSelected}
                    isClickable={isClickable}
                    ariaLabel={node.kind === 'species' ? node.label : undefined}
                    primary={node.label}
                    isPrimaryEmphasized={node.kind === 'species'}
                    secondary={undefined}
                    varietyCount={node.kind === 'species' ? node.varietyCount : undefined}
                    showZeroVarietyCount={node.kind === 'species'}
                    highlightQuery={normalizedSearchQuery}
                    statusAdornment={onPublishCrop ? (
                      crop ? (
                        <CropLibraryStatusIcon
                          crop={crop}
                          onActivate={(trigger) => handleListLibraryAction(node, trigger)}
                        />
                      ) : (
                        // A Kultur header without its own entry has nothing to
                        // publish; the empty slot keeps its count in the column.
                        <Box component="span" />
                      )
                    ) : undefined}
                    onKeyboardActivate={() => {
                      // Enter on a Kultur group header opens or closes the
                      // group and leaves the selection alone; the Sorte rows
                      // keep Enter as "select this Sorte".
                      if (node.kind !== 'species' || !hasChildren) {
                        return false;
                      }
                      toggleCropRow(node.id);
                      return true;
                    }}
                    onClick={() => {
                      if (crop) {
                        cropListNavigation.selectItem(node);
                        return;
                      }
                      if (firstVariety) {
                        cropListNavigation.selectItem(firstVariety);
                      }
                    }}
                    onDoubleClick={(event) => {
                      if (!hasChildren) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      toggleCropRow(node.id);
                    }}
                  />
                );
              })}
            </List>
            )}
          </Card>) : null}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              width: '100%',
              display: 'flex',
              justifyContent: 'flex-start',
              // The card must size to its own (often much taller) content instead of
              // being stretched to the wrapper's height, or nothing would overflow it.
              alignItems: { md: 'flex-start' },
              height: { md: '100%' },
            }}
          >
            {selectedCrop ? (
              <Card
                sx={{
                  width: '100%',
                  maxWidth: useUnifiedMobileLayout ? '100%' : { sm: 920, lg: 980, xl: 1040 },
                  // The card itself (not a wider wrapper spanning the full column) owns
                  // the bounded height and scroll, so its own scrollbar hugs the card's
                  // right edge instead of sitting far away at the wrapper's full width.
                  height: { md: '100%' },
                  overflowY: { md: 'auto' },
                }}
              >
                <CardContent sx={{ p: { xs: 1, sm: 2, lg: 2.5 } }}>
            {/* Header with crop name and badge */}
                  <Box sx={{ mb: { xs: 2, sm: 3 } }}>
              {/* The actions stay beside the title and move below it only when a
                  word of the crop name would not fit next to them (see
                  detailHeaderStyles.ts). Phones keep a single non-wrapping row. */}
              <Box
                data-testid="crop-detail-header"
                sx={[
                  { display: 'flex', alignItems: 'flex-start', flexWrap: 'nowrap', gap: { xs: 1, sm: 2 }, mb: 0.75 },
                  !useUnifiedMobileLayout && detailHeaderRowSx,
                ]}
              >
                <Box sx={[{ flexGrow: 1, minWidth: 0 }, !useUnifiedMobileLayout && detailHeaderTitleColumnSx]}>
                  <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'stretch', gap: 1.75 }}>
                    {selectedCrop.display_color ? (
                      <Box
                        sx={{
                          width: 4,
                          borderRadius: 1,
                          backgroundColor: selectedCrop.display_color,
                          opacity: 0.75,
                          my: 0.5,
                          alignSelf: 'stretch',
                          flexShrink: 0,
                        }}
                        aria-label={t('form.displayColorAria')}
                        title={selectedCrop.display_color}
                      />
                    ) : null}
                    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', py: 0.25 }}>
                      {useUnifiedMobileLayout ? (
                        <CropTitleSelectorButton
                          title={getCropDisplayName(selectedCrop)}
                          ariaLabel={t('selectCrop')}
                          onClick={() => setMobileSelectorOpen(true)}
                        />
                      ) : (
                        <Typography component="h2" sx={[{ fontSize: { xs: '1.25rem', sm: '2rem' }, lineHeight: 1.2, fontWeight: 600 }, detailHeaderTitleTextSx]}>
                          {getCropDisplayName(selectedCrop)}
                        </Typography>
                      )}
                      {!isSpeciesView && selectedCrop.variety ? (
                        <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase' }}>
                            {t('hierarchy.varietyLabel')}
                          </Typography>
                          <Typography variant="body2" color="text.primary" sx={{ fontWeight: 600 }}>
                            {selectedCrop.variety}
                          </Typography>
                        </Stack>
                      ) : null}
                      <Box data-testid="crop-detail-badge-row" sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        {selectedCrop.origin_type === 'imported' ? (
                          <AppTooltip title={t('library.badges.importedTooltip')}>
                            <Box component="span" sx={{ display: 'inline-flex' }}>
                              <Chip
                                size="small"
                                color="secondary"
                                label={t('library.badges.imported')}
                              />
                            </Box>
                          </AppTooltip>
                        ) : null}
                        {onPublishCrop ? (
                          <CropLibraryActionButton
                            crop={selectedCrop}
                            controller={publicUpdate}
                            onPublish={() => onPublishCrop?.()}
                            isPublishing={isPublishingCrop}
                          />
                        ) : null}
                        {onPublishCrop ? <CropLibraryPinnedChip crop={selectedCrop} /> : null}
                        {isPublishedUnderPendingSpecies ? <CropSpeciesPendingChip /> : null}
                      </Box>
                    </Box>
                  </Box>
                </Box>
                <DetailPageActions
                  compact={useUnifiedMobileLayout}
                  primaryActions={[
                    {
                      label: t('buttons.edit'),
                      icon: <EditIcon fontSize="small" />,
                      onClick: () => onEditCrop?.(selectedCrop),
                      disabled: !onEditCrop,
                    },
                    {
                      label: t('buttons.createPlantingPlan'),
                      icon: <AgricultureIcon fontSize="small" />,
                      onClick: () => onCreatePlan?.(),
                      disabled: !canCreatePlan || !onCreatePlan,
                      tooltip: canCreatePlan ? undefined : (createPlanDisabledTooltip ?? t('buttons.createPlantingPlanMissingBedsTooltip')),
                      variant: 'contained',
                    },
                  ]}
                  overflowLabel={t('buttons.moreActions')}
                  onOpenOverflow={(event) => setHeaderMenuAnchorEl(event.currentTarget)}
                />
              </Box>
              <CropHeaderActionsMenu
                anchorEl={headerMenuAnchorEl}
                onClose={() => setHeaderMenuAnchorEl(null)}
                onOpenHistory={() => onOpenHistory?.()}
                onExport={() => onExportCrop?.()}
                onDelete={() => onDeleteCrop?.(selectedCrop)}
                onUnlinkPublicCrop={onUnlinkPublicCrop && canUnlinkPublicCrop(selectedCrop)
                  ? () => onUnlinkPublicCrop(selectedCrop)
                  : undefined}
                t={t}
              />
            </Box>

            <PublicCropUpdateDialog
              crop={selectedCrop}
              controller={publicUpdate}
            />

            {showVarietyValueLegend ? (
              <Box sx={{ mt: 1.25 }}>
                <VarietyValueLegend
                  sampleLabel={t('hierarchy.ownValueLegendSample')}
                  description={t('hierarchy.ownValueLegendDescription')}
                />
              </Box>
            ) : null}

            <Divider sx={{ mb: 2.5 }} />

            {/* Section order follows the crop form (see CropForm.tsx); the
                Sorten list leads, the detail-only actionable sections (task
                templates, supplier offers) close. Empty sections render
                nothing, so the separator is drawn between rendered siblings;
                the bordered cards sit in a plain Box so it stays outside them. */}
            <Box data-testid="crop-detail-sections" sx={detailSectionStackSx}>
            {isSpeciesView ? (
            <Box>
            <CropVarietiesOverview
              varieties={varietySiblings
                .filter((variety): variety is typeof variety & { crop: Crop } => Boolean(variety.crop))
                .map((variety) => ({ crop: variety.crop, label: variety.label }))}
              cropCrop={selectedCrop}
              action={addVarietyButton}
              onSelect={(crop) => {
                setSelectedSpeciesViewKey(null);
                (onNavigateToVariety ?? onCropSelect)(crop);
              }}
            />
            </Box>
            ) : null}

            {/* General Information: the crop's identity details */}
            {hasAnyDetailValue(
              showSeedType ? selectedCrop.seed_type : undefined,
              getCropValue('botanical_name', selectedCrop.botanical_name),
              getEffectiveCropTags(selectedCrop),
            ) ? (
                <Box sx={{ mb: 3 }} data-testid="crop-detail-general">
                  <Typography variant="h6" gutterBottom>
                    {t('detail.sections.general')}
                  </Typography>
                  <Box sx={detailSectionGridSx}>
                    {showSeedType && hasDetailValue(selectedCrop.seed_type) && (
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          {t('form.seedType')}
                        </Typography>
                        <ValueWithLibraryPin pin={getLibraryPin('seed_type')}>
                          <Typography variant="body1" data-testid="crop-detail-seed-type">
                            {getSeedTypeLabel(selectedCrop.seed_type, t)}
                          </Typography>
                        </ValueWithLibraryPin>
                      </Box>
                    )}
                    {hasDetailValue(getCropValue('botanical_name', selectedCrop.botanical_name)) && (
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          {t('form.botanicalName')}
                        </Typography>
                        <ValueWithLibraryPin pin={getLibraryPin('botanical_name')}>
                          <Typography variant="body1" sx={[{ fontStyle: 'italic' }, getOwnValueSx('botanical_name') ?? {}]}>
                            {getCropValue('botanical_name', selectedCrop.botanical_name)}
                          </Typography>
                        </ValueWithLibraryPin>
                      </Box>
                    )}
                    {hasDetailValue(getEffectiveCropTags(selectedCrop)) && (
                      <Box data-testid="crop-detail-tags">
                        <Typography variant="body2" color="text.secondary">
                          {t('form.tags')}
                        </Typography>
                        <Box sx={[{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }, getOwnValueSx('tags') ?? {}]}>
                          {getEffectiveCropTags(selectedCrop).map((tag) => (
                            <Chip key={tag} size="small" label={tag} />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                </Box>
            ) : null}

            <SpecificPropertiesDetails profile={selectedCrop.specific_property_profile}
              values={selectedCrop.specific_properties} variety={selectedCrop.variety} t={t} />
            {/* Crop Rotation Properties Section */}
            {hasAnyDetailValue(
              getCropValue('crop_family', selectedCrop.crop_family),
              getCropValue('nutrient_demand', selectedCrop.nutrient_demand),
              getCropValue('rotation_break_years', selectedCrop.rotation_break_years),
            ) ? (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('form.sectionCropRotation')}
              </Typography>
              <Box sx={detailSectionGridSx}>
                {hasDetailValue(getCropValue('crop_family', selectedCrop.crop_family)) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.cropFamily')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('crop_family')}>
                      {plantFamilies.getName(getCropValue('crop_family', selectedCrop.crop_family))}
                    </Typography>
                  </Box>
                )}
                {hasDetailValue(getCropValue('nutrient_demand', selectedCrop.nutrient_demand)) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.nutrientDemand')}
                    </Typography>
                    <ValueWithLibraryPin pin={getLibraryPin('nutrient_demand')}>
                      <Typography variant="body1" sx={getOwnValueSx('nutrient_demand')}>
                        {getCropValue('nutrient_demand', selectedCrop.nutrient_demand) === 'low'
                          ? t('form.nutrientDemandLow')
                          : getCropValue('nutrient_demand', selectedCrop.nutrient_demand) === 'medium'
                            ? t('form.nutrientDemandMedium')
                            : t('form.nutrientDemandHigh')}
                      </Typography>
                    </ValueWithLibraryPin>
                  </Box>
                )}
                {hasDetailValue(getCropValue('rotation_break_years', selectedCrop.rotation_break_years)) && (
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('form.rotationBreakYears')}
                  </Typography>
                  <Typography variant="body1" sx={getOwnValueSx('rotation_break_years')}>
                    {`${formatNumber(getCropValue('rotation_break_years', selectedCrop.rotation_break_years), t, locale)} ${t('detail.units.years')}`}
                  </Typography>
                </Box>
                )}
              </Box>
            </Box>
            ) : null}

            {/* Timing Section */}
            {hasAnyDetailValue(
              getCropValue('growth_duration_days', selectedCrop.growth_duration_days),
              getCropValue('harvest_duration_days', selectedCrop.harvest_duration_days),
            ) ? (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('form.sectionTiming')}
              </Typography>
              <Box sx={detailSectionGridSx}>
                {([
                  ['growth_duration_days', 'form.growthDurationDays'],
                  ['harvest_duration_days', 'form.harvestDurationDays'],
                ] as const).map(([field, labelKey]) => (
                  hasDetailValue(getCropValue(field, selectedCrop[field])) ? (
                    <Box key={field}>
                      <Typography variant="body2" color="text.secondary">
                        {t(labelKey)}
                      </Typography>
                      <ValueWithLibraryPin pin={getLibraryPin(field)}>
                        <Typography variant="body1" sx={getOwnValueSx(field)}>
                          {`${formatNumber(getCropValue(field, selectedCrop[field]), t, locale)} ${t('detail.units.days')}`}
                        </Typography>
                      </ValueWithLibraryPin>
                    </Box>
                  ) : null
                ))}
              </Box>
            </Box>
            ) : null}

            {/* Spacing Section */}
            {hasAnyDetailValue(
              getCropValue('distance_within_row_cm', selectedCrop.distance_within_row_cm),
              getCropValue('row_spacing_cm', selectedCrop.row_spacing_cm),
              getCropValue('sowing_depth_cm', selectedCrop.sowing_depth_cm),
              getCropValue('sowing_depth_max_cm', selectedCrop.sowing_depth_max_cm),
            ) ? (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('form.sectionPlanting')}
              </Typography>
              <Box sx={detailSectionGridSx}>
                {([
                  ['distance_within_row_cm', 'detail.fields.distanceWithinRow'],
                  ['row_spacing_cm', 'detail.fields.rowSpacing'],
                ] as const).map(([field, labelKey]) => (
                  hasDetailValue(getCropValue(field, selectedCrop[field])) ? (
                    <Box key={field}>
                      <Typography variant="body2" color="text.secondary">
                        {t(labelKey)}
                      </Typography>
                      <ValueWithLibraryPin pin={getLibraryPin(field)}>
                        <Typography variant="body1" sx={getOwnValueSx(field)}>
                          {`${formatDistance(getCropValue(field, selectedCrop[field]), t, locale)} ${t('detail.units.centimeters')}`}
                        </Typography>
                      </ValueWithLibraryPin>
                    </Box>
                  ) : null
                ))}
                {hasAnyDetailValue(
                  getCropValue('sowing_depth_cm', selectedCrop.sowing_depth_cm),
                  getCropValue('sowing_depth_max_cm', selectedCrop.sowing_depth_max_cm),
                ) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('detail.fields.sowingDepth')}
                    </Typography>
                    <ValueWithLibraryPin pin={getLibraryPin('sowing_depth_cm')}>
                      <Typography variant="body1" sx={getOwnValueSx('sowing_depth_cm')}>
                        {`${formatSowingDepth(
                          getCropValue('sowing_depth_cm', selectedCrop.sowing_depth_cm),
                          getCropValue('sowing_depth_max_cm', selectedCrop.sowing_depth_max_cm),
                          t,
                          locale,
                        )} ${t('detail.units.centimeters')}`}
                      </Typography>
                    </ValueWithLibraryPin>
                  </Box>
                )}
              </Box>
            </Box>
            ) : null}

            {/* Yield Section */}
            {hasAnyDetailValue(
              getCropValue('harvest_method', selectedCrop.harvest_method),
              getCropValue('expected_yield', selectedCrop.expected_yield),
            ) ? (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('form.sectionYield')}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(auto-fit, minmax(180px, 260px))',
                  },
                  gap: 2,
                  justifyContent: 'start',
                }}
              >
                {hasDetailValue(getCropValue('harvest_method', selectedCrop.harvest_method)) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.yieldUnit')}
                    </Typography>
                    <ValueWithLibraryPin pin={getLibraryPin('harvest_method')}>
                      <Typography variant="body1" sx={getOwnValueSx('harvest_method')}>
                        {getCropValue('harvest_method', selectedCrop.harvest_method) === 'per_plant'
                          ? t('form.yieldUnitPerPlant')
                          : t('form.yieldUnitPerSqm')}
                      </Typography>
                    </ValueWithLibraryPin>
                  </Box>
                )}
                {hasDetailValue(getCropValue('expected_yield', selectedCrop.expected_yield)) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.expectedYield')}
                    </Typography>
                    <ValueWithLibraryPin pin={getLibraryPin('expected_yield')}>
                      <Typography variant="body1" sx={getOwnValueSx('expected_yield')}>
                        {`${formatNumber(getCropValue('expected_yield', selectedCrop.expected_yield), t, locale)} ${getCropValue('harvest_method', selectedCrop.harvest_method) === 'per_plant' ? t('detail.units.kgPerPlant') : getCropValue('harvest_method', selectedCrop.harvest_method) === 'per_sqm' ? t('detail.units.kgPerSqm') : t('detail.units.kilograms')}`}
                      </Typography>
                    </ValueWithLibraryPin>
                  </Box>
                )}
              </Box>
            </Box>
            ) : null}

            {/* Seed Demand Section */}
            {hasAnyDetailValue(
              activeCultivationTypes,
              seedRateRows,
              seedRateRows.length === 0
                ? getCropValue('sowing_calculation_safety_percent', selectedCrop.sowing_calculation_safety_percent)
                : undefined,
              getCropValue('seeding_requirement', selectedCrop.seeding_requirement),
              getCropValue('thousand_kernel_weight_g', selectedCrop.thousand_kernel_weight_g),
            ) ? (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('form.seedRateSectionTitle')}
              </Typography>
              <CropSeedDetails
                activeCultivationTypes={activeCultivationTypes}
                cultivationTypePin={getLibraryPin('cultivation_types')}
                thousandKernelWeightPin={getLibraryPin('thousand_kernel_weight_g')}
                cultivationTypeSource={
                  getCropValueSource('cultivation_types') === 'ownValue' || getCropValueSource('cultivation_type') === 'ownValue'
                    ? 'ownValue'
                    : null
                }
                seedRateRows={seedRateRows}
                sowingSafetyPercent={getCropValue('sowing_calculation_safety_percent', selectedCrop.sowing_calculation_safety_percent)}
                sowingSafetySource={getCropValueSource('sowing_calculation_safety_percent')}
                seedingRequirement={getCropValue('seeding_requirement', selectedCrop.seeding_requirement)}
                seedingRequirementSource={getCropValueSource('seeding_requirement')}
                seedingRequirementType={getCropValue('seeding_requirement_type', selectedCrop.seeding_requirement_type)}
                seedingRequirementTypeSource={getCropValueSource('seeding_requirement_type')}
                thousandKernelWeightG={getCropValue('thousand_kernel_weight_g', selectedCrop.thousand_kernel_weight_g)}
                thousandKernelWeightSource={getCropValueSource('thousand_kernel_weight_g')}
                locale={locale}
                t={t}
              />
            </Box>
            ) : null}

            <CropTimingWindowsDetail crop={selectedCrop} isVarietyView={!isSpeciesView && Boolean(selectedCrop.variety)} />

            {hasAnyDetailValue(...germinationDetailFields(getCropValue('germination_temperature_requirement', selectedCrop.germination_temperature_requirement)).map((field) => getCropValue(field, selectedCrop[field]))) ? (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>{t('germination.title')}</Typography>
              <Box sx={detailSectionGridSx}>
                {germinationDetailFields(getCropValue('germination_temperature_requirement', selectedCrop.germination_temperature_requirement)).filter((field) => hasDetailValue(getCropValue(field, selectedCrop[field]))).map((field) => (
                  <Box key={field} sx={{ minWidth: 0 }}>
                    <Typography variant="body2" color="text.secondary">{t(`germination.fields.${field}`)}</Typography>
                    <ValueWithLibraryPin pin={getLibraryPin(field)}>
                      <Typography sx={[getOwnValueSx(field) ?? {}, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }]}>
                        {formatGerminationValue(field, getCropValue(field, selectedCrop[field]), t, locale)}
                      </Typography>
                    </ValueWithLibraryPin>
                  </Box>
                ))}
              </Box>
            </Box>
            ) : null}

            {hasAnyDetailValue(...SITE_HEALTH_FIELDS.map((field) => getCropValue(field, selectedCrop[field]))) ? (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>{t('siteHealth.title')}</Typography>
              <Box sx={detailSectionGridSx}>
                {SITE_HEALTH_FIELDS.filter((field) => hasDetailValue(getCropValue(field, selectedCrop[field]))).map((field) => (
                  <Box key={field} sx={{ minWidth: 0 }}>
                    <Typography variant="body2" color="text.secondary">{t(`siteHealth.fields.${field}`)}</Typography>
                    <ValueWithLibraryPin pin={getLibraryPin(field)}>
                      <Typography sx={[getOwnValueSx(field) ?? {}, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }]}>
                        {formatSiteHealthValue(field, getCropValue(field, selectedCrop[field]), t)}
                      </Typography>
                    </ValueWithLibraryPin>
                  </Box>
                ))}
              </Box>
            </Box>
            ) : null}

            <CropCompanionsSection crop={selectedCrop} crops={crops} onCropSelect={onCropSelect} onEdit={onEditCompanions} />

            {/* Notes Section */}
            {hasDetailValue(selectedCrop.notes) ? (
            <Box component="section" sx={{ mb: 3 }}>
              <ValueWithLibraryPin pin={getLibraryPin('notes')}>
                <Typography variant="h6" gutterBottom>
                  {t('detail.sections.notes')}
                </Typography>
              </ValueWithLibraryPin>
              <Box sx={{ p: { xs: 1.5, sm: 2.5 }, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: { xs: '100%', xl: 1180 } }}>
                  <Box>
                    <LocalizedMarkdownNotes localized={localizedNotes} />
                  </Box>
                </Box>
              </Box>
            </Box>
            ) : null}

            {selectedCrop.id !== undefined && (
              <Box>
                <CropTaskTemplatesSection key={`task-templates:${selectedCrop.id}`} cropId={selectedCrop.id} />
              </Box>
            )}

            <Box>
              <CropSupplierDataSection key={`supplier-data:${selectedCrop.id ?? selectedCrop.name}`} crop={selectedCrop}
                crops={crops} onSaved={onSupplierDataSaved} />
            </Box>
            </Box>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent>
                  {useUnifiedMobileLayout ? (
                    <Typography
                      component="button"
                      type="button"
                      onClick={() => setMobileSelectorOpen(true)}
                      sx={{ border: 'none', background: 'transparent', p: 0, m: 0, color: 'text.secondary', textAlign: 'left', cursor: 'pointer' }}
                    >
                      {t('selectCrop')} ▼
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('selectPrompt')}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            )}
          </Box>
        </Box>
      ) : null}


      {useUnifiedMobileLayout ? (
        <CropMobileSelectorDialog
          open={mobileSelectorOpen}
          onClose={() => setMobileSelectorOpen(false)}
          selectorControl={selectorControl}
          crops={filteredCrops}
          selectedCropId={selectedCrop?.id}
          selectedSpeciesViewKey={selectedSpeciesViewKey}
          highlightQuery={normalizedSearchQuery}
          matchedGroupRowIds={matchedGroupRowIds}
          onSelect={(crop, itemKind, speciesKey) => {
            setSelectedSpeciesViewKey(itemKind === 'species' ? speciesKey : null);
            onCropSelect(crop);
            setMobileSelectorOpen(false);
          }}
          t={t}
        />
      ) : null}

      {/* Empty State */}
      {isLoading && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                {t('messages.loadingCrops')}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {!isLoading && !selectedCrop && crops.length === 0 && (
        <EmptyStateCard
          title={t('emptyOnboarding.title')}
          description={t('emptyOnboarding.description')}
          actions={[
            { label: t('emptyOnboarding.openLibraryAction'), onClick: onOpenPublicLibrary },
            ...(onImportFile ? [{ label: t('import.menuLabel'), onClick: onImportFile }] : []),
            { label: t('emptyOnboarding.createAction'), onClick: onCreateCrop },
          ]}
        />
      )}

      {!isLoading && !selectedCrop && crops.length > 0 && filteredCrops.length === 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" align="center" sx={{ mb: 1 }}>
              {t('emptySearch.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 2 }}>
              {t('emptySearch.description')}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Button
                variant="outlined"
                onClick={resetFilters}
              >
                {t('emptySearch.resetAction')}
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
