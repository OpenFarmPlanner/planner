/**
 * Crop Detail component with searchable dropdown and detailed crop information view.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import { useSearchParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
import TranslateOutlinedIcon from '@mui/icons-material/TranslateOutlined';
import { CropHierarchyRow } from './CropHierarchyRow';
import { PublicCropUpdateDialog } from './PublicCropUpdateDialog';
import { CropLibraryActionButton } from './CropLibraryActionButton';
import { CropSpeciesPendingChip } from './CropSpeciesPendingChip';
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
  Link,
  List,
  Stack,
  Button,
  IconButton,
  TextField,
} from '@mui/material';
import type { Crop } from '../api/api';
import EmptyStateCard from '../components/project/EmptyStateCard';
import { stripCitationMarkers } from '../components/data-grid/markdown';
import { markdownComponents } from '../components/data-grid/markdownComponents';
import { useCropListKeyboardNavigation } from './useCropListKeyboardNavigation';
import { useSearchExpandedGroups } from './useSearchExpandedGroups';
import { DetailPageActions } from '../components/layout/DetailPageActions';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { getCropDisplayName } from './cropDisplay';
import {
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
import { varietySpecificValueHighlightSx } from './varietyValueAccent';
import { getEffectiveCropValue, isEmptyCropValue, getVarietyOwnValueSource } from './varietyValueSource';
import { buildLocalizedText, getDescriptionFallbackNotice } from '../crop-library/publicCropDisplay';

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
  onEditCrop?: (crop: Crop) => void;
  onAddVariety?: (speciesCrop: Crop) => void;
  onCreatePlan?: () => void;
  onOpenHistory?: () => void;
  onExportCrop?: () => void;
  onPublishCrop?: () => void;
  /** Called after a pending public-library update was applied to the selected crop. */
  onPublicUpdateApplied?: () => void;
  onDeleteCrop?: (crop: Crop) => void;
  canCreatePlan?: boolean;
  createPlanDisabledTooltip?: string;
  isPublishingCrop?: boolean;
  searchInputRef?: Ref<HTMLInputElement>;
}

import {
  formatDistance,
  formatNumber,
  formatPackageSizes,
  getSowingMonths,
} from './cropDetailFormatters';
import { usePersistedCropFilters } from './usePersistedCropFilters';


export function CropDetail({
  crops,
  isLoading = false,
  selectedCropId,
  onCropSelect,
  onNavigateToVariety,
  onCreateCrop,
  onOpenPublicLibrary,
  onEditCrop,
  onAddVariety,
  onCreatePlan,
  onOpenHistory,
  onExportCrop,
  onPublishCrop,
  onPublicUpdateApplied,
  onDeleteCrop,
  canCreatePlan = true,
  createPlanDisabledTooltip,
  isPublishingCrop = false,
  searchInputRef,
}: CropDetailProps) {
  const { t, i18n } = useTranslation('crops');
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language;
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
    const BOTTOM_MARGIN_PX = 16;
    const updateMaxHeight = () => {
      const top = element.getBoundingClientRect().top;
      setDetailAreaMaxHeight(Math.max(0, window.innerHeight - top - BOTTOM_MARGIN_PX));
    };
    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateMaxHeight) : undefined;
    resizeObserver?.observe(document.body);
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
        filters.selectedCultivationFilter,
        filters.selectedNutrientFilter,
        filters.selectedSupplierFilter,
        filters.growthDaysMin,
        filters.growthDaysMax,
        filters.yieldMin,
        filters.yieldMax,
        filters.selectedSowingMonths.length > 0 ? 'months' : '',
      ];
      return filterValues.filter((v) => typeof v === 'string' && v.length > 0).length;
    },
    [filters],
  );

  const familyOptions = useMemo(
    () => Array.from(new Set(
      crops
        .map((crop) => crop.crop_family?.trim())
        .filter((entry): entry is string => Boolean(entry))
    )).sort((left, right) => left.localeCompare(right, 'de')),
    [crops]
  );

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

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short' }),
    [locale],
  );

  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, index) => ({
      value: index + 1,
      label: monthFormatter.format(new Date(2026, index, 1)),
    })),
    [monthFormatter],
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
      const sowingMonths = getSowingMonths(crop);
      const sowingMatches = filters.selectedSowingMonths.length === 0
        || filters.selectedSowingMonths.some((month) => sowingMonths.includes(month));
      const supplierIds = [
        crop.supplier?.id,
        crop.selected_seed_demand_supplier,
        ...(crop.supplier_data ?? []).map((supplierRow) => supplierRow.supplier_id ?? supplierRow.supplier?.id),
      ];
      const supplierMatches = selectedSupplierId === null
        || supplierIds.some((supplierId) => supplierId === selectedSupplierId);

      return familyMatches
        && cultivationMatches
        && growthMatches
        && nutrientMatches
        && yieldMatches
        && sowingMatches
        && supplierMatches;
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
  const descriptionFallbackNotice = useMemo(
    () => getDescriptionFallbackNotice(
      buildLocalizedText(
        selectedCrop?.notes,
        selectedCrop?.description_language_code,
        currentLanguage,
        '',
      ),
      t,
      currentLanguage,
    ),
    [currentLanguage, selectedCrop, t],
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

  const showVarietyValueLegend = Boolean(!isSpeciesView && selectedCrop?.variety && selectedSpeciesCrop);

  const supplierRows = useMemo(
    () => selectedCrop?.supplier_data ?? [],
    [selectedCrop?.supplier_data],
  );

  const orderedSupplierRows = useMemo(() => {
    if (supplierRows.length <= 1) {
      return supplierRows;
    }

    const preferredSupplierId = selectedCrop?.supplier?.id ?? selectedCrop?.selected_seed_demand_supplier ?? null;
    if (typeof preferredSupplierId !== 'number') {
      return supplierRows;
    }

    const preferredIndex = supplierRows.findIndex((row) => (row.supplier?.id ?? row.supplier_id ?? null) === preferredSupplierId);
    if (preferredIndex <= 0) {
      return supplierRows;
    }

    return [supplierRows[preferredIndex], ...supplierRows.filter((_row, index) => index !== preferredIndex)];
  }, [selectedCrop?.selected_seed_demand_supplier, selectedCrop?.supplier?.id, supplierRows]);
  const hasMultipleSupplierRows = supplierRows.length > 1;
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
          supplierOptions={supplierOptions}
          monthOptions={monthOptions}
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
              {/* Never wraps: the actions are pinned top-right and the title column
                  shrinks (and wraps to a second line) instead, so a long crop name
                  can't push the buttons onto a row of their own. */}
              <Box data-testid="crop-detail-header" sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'nowrap', gap: { xs: 1, sm: 2 }, mb: 0.75 }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
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
                        <Typography component="h2" sx={{ fontSize: { xs: '1.25rem', sm: '2rem' }, lineHeight: 1.2, fontWeight: 600, overflowWrap: 'anywhere' }}>
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

            {/* Varieties Section — only relevant when viewing the crop/species
                overview, not a single variety's own detail page. */}
            {isSpeciesView ? (
            <>
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

            <Divider sx={{ mb: 2.5 }} />
            </>
            ) : null}

            {/* Crop Rotation Properties Section */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('detail.sections.cropRotation')}
              </Typography>
              <Box sx={detailSectionGridSx}>
                {getCropValue('crop_family', selectedCrop.crop_family) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.cropFamily')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('crop_family')}>
                      {getCropValue('crop_family', selectedCrop.crop_family)}
                    </Typography>
                  </Box>
                )}
                {getCropValue('nutrient_demand', selectedCrop.nutrient_demand) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.nutrientDemand')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('nutrient_demand')}>
                      {getCropValue('nutrient_demand', selectedCrop.nutrient_demand) === 'low'
                        ? t('form.nutrientDemandLow')
                        : getCropValue('nutrient_demand', selectedCrop.nutrient_demand) === 'medium'
                          ? t('form.nutrientDemandMedium')
                          : t('form.nutrientDemandHigh')}
                    </Typography>
                  </Box>
                )}
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('form.rotationBreakYears')}
                  </Typography>
                  <Typography variant="body1" sx={getOwnValueSx('rotation_break_years')}>
                    {getCropValue('rotation_break_years', selectedCrop.rotation_break_years) !== null
                      && getCropValue('rotation_break_years', selectedCrop.rotation_break_years) !== undefined
                      ? `${formatNumber(getCropValue('rotation_break_years', selectedCrop.rotation_break_years), t, locale)} ${t('detail.units.years')}`
                      : t('noData')}
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Divider sx={{ mb: 2.5 }} />

            {/* Timing Section */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('form.sectionTiming')}
              </Typography>
              <Box sx={detailSectionGridSx}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('form.growthDurationDays')}
                  </Typography>
                  <Typography variant="body1" sx={getOwnValueSx('growth_duration_days')}>
                    {formatNumber(getCropValue('growth_duration_days', selectedCrop.growth_duration_days), t, locale)} {t('detail.units.days')}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('form.harvestDurationDays')}
                  </Typography>
                  <Typography variant="body1" sx={getOwnValueSx('harvest_duration_days')}>
                    {formatNumber(getCropValue('harvest_duration_days', selectedCrop.harvest_duration_days), t, locale)} {t('detail.units.days')}
                  </Typography>
                </Box>
                {getCropValue('propagation_duration_days', selectedCrop.propagation_duration_days) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.propagationDurationDays')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('propagation_duration_days')}>
                      {formatNumber(getCropValue('propagation_duration_days', selectedCrop.propagation_duration_days), t, locale)} {t('detail.units.days')}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>

            <Divider sx={{ mb: 2.5 }} />

            {/* Spacing Section */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('detail.sections.spacing')}
              </Typography>
              <Box sx={detailSectionGridSx}>
                {getCropValue('distance_within_row_cm', selectedCrop.distance_within_row_cm) !== null && getCropValue('distance_within_row_cm', selectedCrop.distance_within_row_cm) !== undefined && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('detail.fields.distanceWithinRow')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('distance_within_row_cm')}>
                      {formatDistance(getCropValue('distance_within_row_cm', selectedCrop.distance_within_row_cm), t, locale)} {t('detail.units.centimeters')}
                    </Typography>
                  </Box>
                )}
                {getCropValue('row_spacing_cm', selectedCrop.row_spacing_cm) !== null && getCropValue('row_spacing_cm', selectedCrop.row_spacing_cm) !== undefined && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('detail.fields.rowSpacing')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('row_spacing_cm')}>
                      {formatDistance(getCropValue('row_spacing_cm', selectedCrop.row_spacing_cm), t, locale)} {t('detail.units.centimeters')}
                    </Typography>
                  </Box>
                )}
                {getCropValue('sowing_depth_cm', selectedCrop.sowing_depth_cm) !== null && getCropValue('sowing_depth_cm', selectedCrop.sowing_depth_cm) !== undefined && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('detail.fields.sowingDepth')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('sowing_depth_cm')}>
                      {formatDistance(getCropValue('sowing_depth_cm', selectedCrop.sowing_depth_cm), t, locale, 1)} {t('detail.units.centimeters')}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>

            <Divider sx={{ mb: 2.5 }} />

            {/* Seeding Section */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('detail.sections.seed')}
              </Typography>
              <CropSeedDetails
                activeCultivationTypes={activeCultivationTypes}
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
                emptyValueLabel={t('noData')}
                locale={locale}
                t={t}
              />
              <Box sx={{ mt: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
                <Typography variant="subtitle1" component="h3" gutterBottom>
                  {hasMultipleSupplierRows ? t('form.supplierDataSectionTitle') : t('filters.supplier')}
                </Typography>
                {hasMultipleSupplierRows && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('form.supplierDataSectionDescription')}
                  </Typography>
                )}
                {orderedSupplierRows.length === 0 ? (
                  <Box sx={{ gridColumn: '1 / -1', display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
                    <Typography variant="body2">{t('form.noSupplierDataRows')}</Typography>
                  </Box>
                ) : (
                  <Stack spacing={2} sx={{ gridColumn: '1 / -1' }}>
                    {orderedSupplierRows.map((row, index) => (
                      <Box key={row.id ?? `${row.supplier?.id ?? row.supplier_id ?? 'supplier'}-${index}`}>
                        {hasMultipleSupplierRows && index > 0 ? <Divider sx={{ mb: 2 }} /> : null}
                        <Stack spacing={1}>
                          <Typography variant="subtitle2">{row.supplier?.name || row.supplier_name || t('form.supplier')}</Typography>
                          {row.supplier_product_name ? (
                            <Box>
                              <Typography variant="body2" color="text.secondary">{t('form.supplierProductNameLabel')}</Typography>
                              <Typography variant="body1">{row.supplier_product_name}</Typography>
                            </Box>
                          ) : null}
                          {row.supplier_product_url && (
                            <Link href={row.supplier_product_url} target="_blank" rel="noopener noreferrer" underline="hover">
                              {row.supplier_product_url}
                            </Link>
                          )}
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              {t('form.seedPackagesLabel')}
                            </Typography>
                            <Typography variant="body1">
                              {formatPackageSizes(row.packaging_sizes, t, locale)}
                            </Typography>
                          </Box>
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
            </Box>

            <Divider sx={{ mb: 3 }} />
            {/* Harvest Section */}
            <Box sx={{ mb: 4 }}>
              <Typography variant="h6" gutterBottom>
                {t('detail.sections.harvest')}
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
                {getCropValue('harvest_method', selectedCrop.harvest_method) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.yieldUnit')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('harvest_method')}>
                      {getCropValue('harvest_method', selectedCrop.harvest_method) === 'per_plant' ? t('form.yieldUnitPerPlant') : t('form.yieldUnitPerSqm')}
                    </Typography>
                  </Box>
                )}
                {getCropValue('expected_yield', selectedCrop.expected_yield) && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('form.expectedYield')}
                    </Typography>
                    <Typography variant="body1" sx={getOwnValueSx('expected_yield')}>
                      {formatNumber(getCropValue('expected_yield', selectedCrop.expected_yield), t, locale)} {t('detail.units.kilograms')}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>

            <Divider sx={{ mb: 3 }} />

            {/* Notes Section */}
            <Box component="section">
              <Typography variant="h6" gutterBottom>
                {t('detail.sections.notes')}
              </Typography>
              <Box sx={{ p: { xs: 1.5, sm: 2.5 }, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: { xs: '100%', xl: 1180 } }}>
                  {selectedCrop.notes && (
                    <Box>
                      {descriptionFallbackNotice ? (
                        <AppTooltip title={descriptionFallbackNotice.tooltip}>
                          <Chip
                            size="small"
                            icon={<TranslateOutlinedIcon fontSize="small" />}
                            label={descriptionFallbackNotice.label}
                            variant="outlined"
                            color="warning"
                            sx={{ mb: 1 }}
                          />
                        </AppTooltip>
                      ) : null}
                      <Box
                        sx={{
                          '& h3': { mt: 2, mb: 1, fontSize: '1.05rem' },
                          '& p': { mb: 1, maxWidth: '95ch' },
                          '& ul': { pl: 3, mb: 1 },
                          '& li': { mb: 0.5 },
                          '& a': { color: 'primary.main' },
                          '& em': { color: 'text.secondary' },
                        }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {stripCitationMarkers(selectedCrop.notes)}
                        </ReactMarkdown>
                      </Box>
                    </Box>
                  )}
                </Box>
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
