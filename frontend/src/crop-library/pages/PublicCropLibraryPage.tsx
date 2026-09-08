import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';
import axios from 'axios';
import { hasCropIdParam, readCropIdParam } from '../../compat/legacyCropNames';
import TranslateOutlinedIcon from '@mui/icons-material/TranslateOutlined';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  ListItemButton,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import SpaOutlinedIcon from '@mui/icons-material/SpaOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import { cropSpeciesAPI, publicCropAPI, publicLibraryModeratorRequestAPI } from '../../api/api';
import type {
  CultivationType,
  Crop,
  ImportPublicCropConfirmationRequiredError,
  PublicCrop,
  PublicCropDiscussionComment,
  PublicCropDiscussionTopic,
  PublicCropRemovalReason,
  PublicCropRevision,
} from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import PageContainer from '../../components/layout/PageContainer';
import { DetailPageActions } from '../../components/layout/DetailPageActions';
import { useTranslation } from '../../i18n';
import { getLanguageDisplayName, normalizeLanguageTag } from '../../i18n/languages';
import { showGlobalSnackbar } from '../../utils/globalSnackbar';
import { stripCitationMarkers } from '../../components/data-grid/markdown';
import { markdownComponents } from '../../components/data-grid/markdownComponents';
import { buildCropHierarchy, findSpeciesCrop, getCropSpeciesKey, type CropHierarchyItemKind } from '../../crops/cropHierarchy';
import { filterCropGroupsForSearch } from '../../crops/cropGroupSearch';
import { CropForm } from '../../crops/CropForm';
import { CropTitleSelectorButton } from '../../crops/CropTitleSelectorButton';
import { CropVarietiesOverview } from '../../crops/CropVarietiesOverview';
import {
  buildPublicCropUpdatePayload,
  publicCropToCropFormData,
} from '../../crops/publicCropFormAdapter';
import { useCommandContextTag, useRegisterCommands } from '../../commands/useCommandContext';
import type { RootLayoutOutletContext, TopbarContextAction } from '../../navigation/topbarTypes';
import { useTopbarContextActions } from '../../hooks/useTopbarContextActions';
import { useWebSocket, type WebSocketEvent } from '../../realtime/useWebSocket';
import { createPublicCropLibraryCommandSpecs } from '../publicCropLibraryCommandSpecs';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import {
  getDescriptionFallbackNotice,
  getPublicCropDescription,
  getPublicCropName,
} from '../publicCropDisplay';
import { applySavedCrops, withCreatedTopic } from '../publicCropListMerge';
import { MultilingualTextFieldSection } from '../components/MultilingualTextFieldSection';
import { AppTooltip } from '../../components/AppTooltip';
import { CropSeedDetails, type CropSeedRateRow, type ValueSource } from '../../crops/CropSeedDetails';
import { VarietyValueLegend } from '../../crops/VarietyValueLegend';
import { PublicCropHierarchyList } from '../../crops/PublicCropHierarchyList';
import { CropSpeciesPendingChip } from '../../crops/CropSpeciesPendingChip';
import { isCropSpeciesPending } from '../../crops/cropSpeciesPending';
import {
  normalizePublicCropSearchQuery,
  publicCropMatchesSearchQuery,
} from '../../crops/publicCropSearchMatch';
import { PublicCropFiltersPopover } from '../components/PublicCropFiltersPopover';
import {
  EMPTY_PUBLIC_CROP_FILTERS,
  countActivePublicCropFilters,
  getPublicCropFilterOptions,
  matchesPublicCropFilters,
  type PublicCropFilterState,
} from '../publicCropFilters';
import { DetailGrid, DetailRow, DetailSection } from '../components/publicCropLibrary/DetailPrimitives';
import { VersionCard } from '../components/publicCropLibrary/VersionCard';
import { CommentForm } from '../components/publicCropLibrary/CommentForm';
import { ThreadCommentBranch } from '../components/publicCropLibrary/DiscussionComment';
import { PublicCropMobileSelectorDialog } from '../components/publicCropLibrary/PublicCropMobileSelectorDialog';
import { ImportConflictDialog } from '../components/publicCropLibrary/ImportConflictDialog';
import { PublicCropTranslationDialog } from '../components/PublicCropTranslationDialog';
import {
  PUBLIC_CROP_TAB_BY_INDEX,
  PUBLIC_CROP_TAB_INDEX_BY_PARAM,
  SELECTED_PUBLIC_CROP_STORAGE_KEY,
  arePublicValuesEqual,
  buildPublicCropDescriptionDrafts,
  buildThreadCommentTree,
  formatDays,
  formatDiscussionPreview,
  formatLocalizedNumber,
  formatMetersAsCentimeters,
  getCultivationTypesLabel,
  getCropTitle,
  getHarvestMethodLabel,
  getLanguageLabel,
  getNutrientDemandLabel,
  getPublicCropOriginalLanguageCode,
  getPublicCropTabIndex,
  getStoredPublicCropLibraryViewState,
  getStoredPublicCropId,
  isEmptyPublicValue,
  parsePublicCropId,
  storePublicCropLibraryViewState,
  type PublicCropLibraryViewState,
} from '../components/publicCropLibrary/formatters';

type CollaborationLoadStatus = 'idle' | 'loading' | 'success' | 'error';
type PublicCropLoadStatus = 'loading' | 'success' | 'error';
export default function PublicCropLibraryPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation('crops');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const setTopbarContextActions = outletContext?.setTopbarContextActions;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedCropParam = readCropIdParam(searchParams);
  const selectedCropIdFromUrl = parsePublicCropId(selectedCropParam);
  const selectedTopicIdFromUrl = parsePublicCropId(searchParams.get('discussionId'));
  const hasExplicitLibraryState = hasCropIdParam(searchParams) || searchParams.has('tab') || searchParams.has('discussionId');
  const storedViewState = hasExplicitLibraryState ? null : getStoredPublicCropLibraryViewState();
  const activeTab = getPublicCropTabIndex(searchParams.get('tab'), selectedTopicIdFromUrl);
  const selectedTopicId = activeTab === PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion ? selectedTopicIdFromUrl : null;
  const [query, setQuery] = useState(() => storedViewState?.query ?? '');
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false);
  const [crops, setCrops] = useState<PublicCrop[]>([]);
  const [selectedCropId, setSelectedCropId] = useState<number | null>(() => (
    selectedCropIdFromUrl ?? storedViewState?.cropId ?? getStoredPublicCropId()
  ));
  const selectedCropIdRef = useRef<number | null>(selectedCropId);
  // Tracks the cropId our own updateSelectedCropId last navigated to,
  // while that navigate() is still in flight (cleared once the URL catches
  // up, or once an external navigation is detected). See updateSelectedCropId.
  const pendingNavigationCropIdRef = useRef<number | null>(selectedCropId);
  const [loadStatus, setLoadStatus] = useState<PublicCropLoadStatus>('loading');
  const [loadError, setLoadError] = useState('');
  const [topics, setTopics] = useState<PublicCropDiscussionTopic[]>([]);
  const [comments, setComments] = useState<PublicCropDiscussionComment[]>([]);
  const [versions, setVersions] = useState<PublicCropRevision[]>([]);
  const [collaborationStatus, setCollaborationStatus] = useState<CollaborationLoadStatus>('idle');
  const [commentsStatus, setCommentsStatus] = useState<CollaborationLoadStatus>('idle');
  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [topicTitle, setTopicTitle] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [topicRevision, setTopicRevision] = useState<number | undefined>();
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [importConflict, setImportConflict] = useState<{
    publicCropId: number;
    name: string;
    varietyChange: { from: string; to: string } | null;
  } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [translationDialogOpen, setTranslationDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeReason, setRemoveReason] = useState<PublicCropRemovalReason | ''>('');
  const [removing, setRemoving] = useState(false);
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({});
  const [mobileSelectorOpen, setMobileSelectorOpen] = useState(false);
  const [selectedSpeciesViewKey, setSelectedSpeciesViewKey] = useState<string | null>(null);
  const [revertingVersion, setRevertingVersion] = useState<number | null>(null);
  const [libraryFilters, setLibraryFilters] = useState<PublicCropFilterState>(EMPTY_PUBLIC_CROP_FILTERS);
  const [libraryFilterAnchorEl, setLibraryFilterAnchorEl] = useState<HTMLElement | null>(null);
  const isLibraryFilterPopoverOpen = Boolean(libraryFilterAnchorEl);
  const activeLibraryFilterCount = countActivePublicCropFilters(libraryFilters);
  const isMobile = useMediaQuery('(max-width:600px)');
  const useCompactLibraryLayout = useMediaQuery('(max-width:899.95px)');
  const libraryAreaRef = useRef<HTMLDivElement>(null);
  // How tall the two-pane area is allowed to be, measured directly from where it
  // actually starts in the viewport rather than guessed via a hardcoded "chrome
  // height" offset (which drifts whenever the surrounding header/layout changes
  // and silently leaves the panes shorter than the available space).
  const [libraryAreaMaxHeight, setLibraryAreaMaxHeight] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cropListRef = useRef<HTMLUListElement>(null);
  const cropListScrollTopRef = useRef<number>(storedViewState?.listScrollTop ?? 0);
  const cropListRequestIdRef = useRef(0);
  const collaborationLoadRequestIdRef = useRef(0);
  // Crops this client has saved, kept until a list response catches up with
  // them. Bumping cropListRequestIdRef on save only discards list requests
  // that are already in flight; one started right after the save (the search
  // box refreshes on a debounce) still carries pre-save data and would
  // otherwise write the old values straight back over the saved ones.
  const savedCropsRef = useRef<Map<number, PublicCrop>>(new Map());
  const newTopicButtonRef = useRef<HTMLButtonElement>(null);
  const newTopicTitleInputRef = useRef<HTMLInputElement>(null);
  const activeCommentFormInputRef = useRef<HTMLInputElement>(null);
  const replyActionRefs = useRef(new Map<number, HTMLButtonElement>());
  const commentRefs = useRef(new Map<number, HTMLDivElement>());
  const [commentActionMenu, setCommentActionMenu] = useState<{ commentId: number; anchorElement: HTMLElement } | null>(null);
  const [pendingFocusCommentId, setPendingFocusCommentId] = useState<number | null>(null);
  const isCropLoading = loadStatus === 'loading';
  useLayoutEffect(() => {
    if (useCompactLibraryLayout) {
      return undefined;
    }
    const element = libraryAreaRef.current;
    if (!element) {
      return undefined;
    }
    const BOTTOM_MARGIN_PX = 24;
    const updateMaxHeight = () => {
      const top = element.getBoundingClientRect().top;
      setLibraryAreaMaxHeight(Math.max(0, window.innerHeight - top - BOTTOM_MARGIN_PX));
    };
    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateMaxHeight) : undefined;
    resizeObserver?.observe(document.body);
    return () => {
      window.removeEventListener('resize', updateMaxHeight);
      resizeObserver?.disconnect();
    };
  }, [useCompactLibraryLayout, loadError, isCropLoading]);
  const canEditPublicCrop = Boolean(user);
  const canModeratePublicLibrary = Boolean(user?.is_public_library_moderator || user?.is_staff || user?.is_superuser);
  const canManageModeratorRequests = Boolean(user?.is_staff || user?.is_superuser);
  const [pendingModerationCount, setPendingModerationCount] = useState(0);

  useEffect(() => {
    if (!canModeratePublicLibrary) {
      setPendingModerationCount(0);
      return undefined;
    }
    let cancelled = false;
    // Same queues the moderation page itself reads (proposed species + pending
    // moderator requests) — page_size:1 keeps this to a cheap count-only call.
    const countRequests: Array<Promise<{ data: { count: number } }>> = [
      cropSpeciesAPI.list({ status: 'proposed', page_size: 1 }),
    ];
    if (canManageModeratorRequests) {
      countRequests.push(publicLibraryModeratorRequestAPI.list({ status: 'pending', page_size: 1 }));
    }
    Promise.all(countRequests)
      .then((responses) => {
        if (cancelled) return;
        setPendingModerationCount(responses.reduce((total, response) => total + response.data.count, 0));
      })
      .catch(() => {
        if (!cancelled) setPendingModerationCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [canManageModeratorRequests, canModeratePublicLibrary]);

  const focusSearch = useCallback(() => {
    if (useCompactLibraryLayout) {
      setMobileSelectorOpen(true);
      return;
    }
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [useCompactLibraryLayout]);

  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage);
  const anonymousLabel = t('library.anonymousAuthor');

  const navigateToLibraryState = useCallback(({
    cropId,
    tab,
    discussionId,
    replace = false,
  }: {
    cropId: number | null;
    tab?: number;
    discussionId?: number | null;
    replace?: boolean;
  }): void => {
    // Built from scratch (never read back from the current URL) so this is a
    // pure function of its own arguments: this page only ever owns cropId,
    // tab and discussionId, so there is nothing to preserve from "the current
    // search" — and nothing to go stale. A previous version rebuilt the next
    // URL on top of a ref mirroring `location`, refreshed only by an effect
    // running one render behind; selecting several crops in quick
    // succession (fast clicks, arrow-key repeat) called that version before
    // the ref had caught up, so a later call could build its URL from an
    // already-superseded base and even skip navigating entirely — read as
    // the crop list (and the import/update button) jumping back to an
    // earlier selection after a fast pick. Not reading any "current" state
    // here removes that failure mode structurally instead of papering over it.
    const nextParams = new URLSearchParams();
    if (cropId !== null) {
      nextParams.set('cropId', String(cropId));

      const nextTab = tab ?? activeTab;
      const tabParam = PUBLIC_CROP_TAB_BY_INDEX[nextTab] ?? 'details';
      if (tabParam !== 'details') {
        nextParams.set('tab', tabParam);
      }

      const nextDiscussionId = tabParam === 'discussion' ? (discussionId ?? null) : null;
      if (nextDiscussionId !== null) {
        nextParams.set('discussionId', String(nextDiscussionId));
        nextParams.set('tab', 'discussion');
      }
    }

    const nextSearch = nextParams.toString();
    navigate(nextSearch ? `?${nextSearch}` : '', { replace });
  }, [activeTab, navigate]);

  const updateSelectedCropId = useCallback((cropId: number | null, options: { replace?: boolean; speciesViewKey?: string | null } = {}): void => {
    setSelectedSpeciesViewKey(options.speciesViewKey ?? null);
    setSelectedCropId(cropId);
    selectedCropIdRef.current = cropId;
    // navigate() (called below via navigateToLibraryState) is asynchronous —
    // searchParams won't reflect `cropId` until it resolves, some renders
    // later. Recorded here so the URL-to-state sync effect can tell "the URL
    // just hasn't caught up with our own pick yet" apart from a genuine
    // external navigation, instead of reading the still-stale URL as more
    // authoritative and snapping selectedCropId back to the previous
    // value in the meantime (see pendingNavigationCropIdRef below).
    pendingNavigationCropIdRef.current = cropId;
    if (cropId === null) {
      window.localStorage.removeItem(SELECTED_PUBLIC_CROP_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SELECTED_PUBLIC_CROP_STORAGE_KEY, String(cropId));
    }
    navigateToLibraryState({
      cropId,
      tab: activeTab,
      discussionId: null,
      replace: options.replace ?? true,
    });
  }, [activeTab, navigateToLibraryState]);

  const selectMobileCrop = useCallback((crop: PublicCrop, itemKind: CropHierarchyItemKind, speciesKey: string): void => {
    updateSelectedCropId(crop.id, { replace: false, speciesViewKey: itemKind === 'species' ? speciesKey : null });
    setMobileSelectorOpen(false);
  }, [updateSelectedCropId]);

  const persistViewState = useCallback((overrides: Partial<PublicCropLibraryViewState> = {}): void => {
    if (selectedCropId === null) {
      return;
    }

    const tab = PUBLIC_CROP_TAB_BY_INDEX[activeTab] ?? 'details';
    storePublicCropLibraryViewState({
      cropId: selectedCropId,
      tab,
      discussionId: tab === 'discussion' ? selectedTopicId : null,
      query,
      listScrollTop: cropListScrollTopRef.current,
      ...overrides,
    });
  }, [activeTab, query, selectedCropId, selectedTopicId]);

  const handleCropListScroll = useCallback((event: UIEvent<HTMLUListElement>): void => {
    cropListScrollTopRef.current = event.currentTarget.scrollTop;
    persistViewState({ listScrollTop: event.currentTarget.scrollTop });
  }, [persistViewState]);

  const formatDate = useCallback((value?: string | null): string => {
    if (!value) {
      return t('library.page.unknownDate');
    }
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
  }, [locale, t]);

  const selectedCrop = useMemo(
    () => crops.find((crop) => crop.id === selectedCropId) ?? null,
    [crops, selectedCropId],
  );
  const libraryFilterOptions = useMemo(() => getPublicCropFilterOptions(crops), [crops]);
  const normalizedSearchQuery = normalizePublicCropSearchQuery(query);
  const filterMatchingLibraryCrops = useMemo(
    () => crops.filter((crop) => matchesPublicCropFilters(crop, libraryFilters)),
    [crops, libraryFilters],
  );
  const filteredLibraryCrops = useMemo(
    () => filterCropGroupsForSearch({
      crops,
      filterMatchingCrops: filterMatchingLibraryCrops,
      normalizedSearchQuery,
      matchesSearchQuery: publicCropMatchesSearchQuery,
    }).filteredCrops,
    [crops, filterMatchingLibraryCrops, normalizedSearchQuery],
  );
  const selectedCropSpeciesKey = selectedCrop ? getCropSpeciesKey(selectedCrop) : null;
  const isSelectedSpeciesEntry = Boolean(selectedCrop && !(selectedCrop.variety || '').trim());
  const isSpeciesView = Boolean(
    selectedCrop
    && (
      isSelectedSpeciesEntry
      || (selectedSpeciesViewKey !== null && selectedSpeciesViewKey === selectedCropSpeciesKey)
    ),
  );
  // Converted to the project `Crop` shape (matching units/field names) so the edit
  // form can reuse the same crop/variety inheritance highlighting as the project side.
  const editFormCrops = useMemo(
    () => crops.map(publicCropToCropFormData),
    [crops],
  );
  // Memoized so this stays referentially stable across re-renders that don't
  // actually change the selected crop (e.g. the notes-draft state update
  // that runs while the edit dialog is open). CropForm resets its draft
  // whenever this reference changes, so an unmemoized object literal here
  // would silently discard in-progress edits (e.g. a variety rename) the
  // moment any unrelated state in this component updates.
  const editFormCrop = useMemo(
    () => (selectedCrop ? publicCropToCropFormData(selectedCrop) : undefined),
    [selectedCrop],
  );
  const publicCropHierarchyItems = useMemo(
    () => buildCropHierarchy(crops),
    [crops],
  );
  const publicVarietySiblings = useMemo(
    () => (
      selectedCropSpeciesKey
        ? publicCropHierarchyItems.filter((item) => (
          item.kind === 'variety'
          && item.speciesKey === selectedCropSpeciesKey
          && item.crop?.id !== selectedCrop?.id
        ))
        : []
    ),
    [publicCropHierarchyItems, selectedCrop, selectedCropSpeciesKey],
  );
  const publicVarietyRows = useMemo(
    () => publicVarietySiblings
      .filter((variety): variety is typeof variety & { crop: PublicCrop } => Boolean(variety.crop))
      .map((variety) => ({
        crop: publicCropToCropFormData(variety.crop),
        label: variety.label,
      })),
    [publicVarietySiblings],
  );
  const selectedSpeciesCrop = useMemo(
    () => findSpeciesCrop(selectedCrop, crops),
    [crops, selectedCrop],
  );
  const getPublicFieldValue = useCallback(<TValue,>(field: keyof PublicCrop, value: TValue): TValue => {
    if (
      selectedCrop?.variety
      && !isSpeciesView
      && selectedSpeciesCrop
      && isEmptyPublicValue(value)
    ) {
      return selectedSpeciesCrop[field] as TValue;
    }
    return value;
  }, [isSpeciesView, selectedCrop?.variety, selectedSpeciesCrop]);
  const getPublicFieldSource = useCallback((field: keyof PublicCrop): ValueSource | null => {
    if (isSpeciesView || !selectedCrop?.variety || !selectedSpeciesCrop) {
      return null;
    }
    const ownValue = selectedCrop[field];
    if (isEmptyPublicValue(ownValue)) {
      return null;
    }
    const cropValue = selectedSpeciesCrop[field];
    return arePublicValuesEqual(ownValue, cropValue) ? null : 'ownValue';
  }, [isSpeciesView, selectedCrop, selectedSpeciesCrop]);
  const showVarietyValueLegend = Boolean(!isSpeciesView && selectedCrop?.variety && selectedSpeciesCrop);
  const isSelectedSpeciesPending = isCropSpeciesPending(selectedCrop);
  const publicActiveCultivationTypes: CultivationType[] = useMemo(() => (selectedCrop
    ? (
      selectedCrop.cultivation_types && selectedCrop.cultivation_types.length > 0
        ? selectedCrop.cultivation_types
        : (
          !isSpeciesView
          && selectedCrop.variety
          && selectedSpeciesCrop?.cultivation_types
          && selectedSpeciesCrop.cultivation_types.length > 0
            ? selectedSpeciesCrop.cultivation_types
            : (
              getPublicFieldValue('cultivation_type', selectedCrop.cultivation_type)
                ? [getPublicFieldValue('cultivation_type', selectedCrop.cultivation_type)]
                : []
            )
        )
    ).filter((item): item is CultivationType => item === 'direct_sowing' || item === 'pre_cultivation')
    : []), [getPublicFieldValue, isSpeciesView, selectedCrop, selectedSpeciesCrop]);
  const publicSeedRateRows: CropSeedRateRow[] = useMemo(() => (selectedCrop
    ? (() => {
      const isDirectActive = publicActiveCultivationTypes.includes('direct_sowing');
      const isPreCultivationActive = publicActiveCultivationTypes.includes('pre_cultivation');
      const directValue = getPublicFieldValue('seed_rate_direct_value', selectedCrop.seed_rate_direct_value);
      const directUnit = getPublicFieldValue('seed_rate_direct_unit', selectedCrop.seed_rate_direct_unit);
      const preCultivationValue = getPublicFieldValue('seed_rate_pre_cultivation_value', selectedCrop.seed_rate_pre_cultivation_value);
      const preCultivationUnit = getPublicFieldValue('seed_rate_pre_cultivation_unit', selectedCrop.seed_rate_pre_cultivation_unit);
      const rows: CropSeedRateRow[] = [];

      if (isDirectActive && directValue !== null && directValue !== undefined && directUnit) {
        rows.push({
          method: 'direct_sowing',
          value: directValue,
          unit: directUnit,
          valueSource: getPublicFieldSource('seed_rate_direct_value') ?? getPublicFieldSource('seed_rate_direct_unit'),
        });
      }
      if (isPreCultivationActive && preCultivationValue !== null && preCultivationValue !== undefined && preCultivationUnit) {
        rows.push({
          method: 'pre_cultivation',
          value: preCultivationValue,
          unit: preCultivationUnit,
          valueSource: getPublicFieldSource('seed_rate_pre_cultivation_value') ?? getPublicFieldSource('seed_rate_pre_cultivation_unit'),
        });
      }

      if (rows.length > 0) {
        return rows;
      }

      const seedRateByCultivation = getPublicFieldValue('seed_rate_by_cultivation', selectedCrop.seed_rate_by_cultivation);
      if (seedRateByCultivation && Object.keys(seedRateByCultivation).length > 0) {
        return Object.entries(seedRateByCultivation)
          .filter(([method, payload]) => (
            publicActiveCultivationTypes.includes(method as CultivationType)
            && (method === 'direct_sowing' || method === 'pre_cultivation')
            && payload
            && typeof payload.value === 'number'
            && typeof payload.unit === 'string'
          ))
          .map(([method, payload]) => ({
            method: method as CultivationType,
            value: payload.value,
            unit: payload.unit,
            valueSource: getPublicFieldSource('seed_rate_by_cultivation'),
          }));
      }

      const generalSeedRateValue = getPublicFieldValue('seed_rate_value', selectedCrop.seed_rate_value);
      const generalSeedRateUnit = getPublicFieldValue('seed_rate_unit', selectedCrop.seed_rate_unit);
      if (
        publicActiveCultivationTypes.length > 0
        && generalSeedRateValue !== null
        && generalSeedRateValue !== undefined
        && generalSeedRateUnit
      ) {
        return [{
          method: publicActiveCultivationTypes.includes('direct_sowing') ? 'direct_sowing' : 'pre_cultivation',
          value: generalSeedRateValue,
          unit: generalSeedRateUnit,
          valueSource: getPublicFieldSource('seed_rate_value') ?? getPublicFieldSource('seed_rate_unit'),
        }];
      }

      return [];
    })()
    : []), [getPublicFieldSource, getPublicFieldValue, publicActiveCultivationTypes, selectedCrop]);
  // Localized species name for the selected entry.
  const selectedCropName = useMemo(
    () => (selectedCrop
      ? getPublicCropName(selectedCrop, language, t('library.translation.missingName'))
      : { text: '', languageCode: null, isFallback: false }),
    [language, selectedCrop, t],
  );
  const selectedCropDescription = useMemo(
    () => (selectedCrop
      ? getPublicCropDescription(selectedCrop, language)
      : { text: '', languageCode: null, isFallback: false }),
    [language, selectedCrop],
  );
  const descriptionFallbackNotice = useMemo(
    () => getDescriptionFallbackNotice(selectedCropDescription, t, language),
    [selectedCropDescription, t, language],
  );
  const currentLanguageCode = normalizeLanguageTag(language) ?? 'de';
  const selectedCropOriginalLanguageCode = selectedCrop
    ? getPublicCropOriginalLanguageCode(selectedCrop, currentLanguageCode)
    : currentLanguageCode;
  const originalDescriptionDraft = selectedCrop
    ? descriptionDrafts[selectedCropOriginalLanguageCode] ?? ''
    : '';
  const currentDescriptionDraft = selectedCrop
    ? descriptionDrafts[currentLanguageCode] ?? ''
    : '';
  const hasDescriptionDraftChanges = useMemo(() => {
    if (!selectedCrop) {
      return false;
    }
    const initialDrafts = buildPublicCropDescriptionDrafts(selectedCrop);
    const originalChanged = (descriptionDrafts[selectedCropOriginalLanguageCode] ?? '')
      !== (initialDrafts[selectedCropOriginalLanguageCode] ?? '');
    const currentChanged = currentLanguageCode !== selectedCropOriginalLanguageCode
      && (descriptionDrafts[currentLanguageCode] ?? '') !== (initialDrafts[currentLanguageCode] ?? '');
    return originalChanged || currentChanged;
  }, [currentLanguageCode, descriptionDrafts, selectedCrop, selectedCropOriginalLanguageCode]);
  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId) ?? null,
    [selectedTopicId, topics],
  );
  const threadCommentTree = useMemo(() => buildThreadCommentTree(comments), [comments]);

  const registerReplyActionRef = useCallback((commentId: number, element: HTMLButtonElement | null): void => {
    if (element) {
      replyActionRefs.current.set(commentId, element);
      return;
    }
    replyActionRefs.current.delete(commentId);
  }, []);

  const registerCommentRef = useCallback((commentId: number, element: HTMLDivElement | null): void => {
    if (element) {
      commentRefs.current.set(commentId, element);
      return;
    }
    commentRefs.current.delete(commentId);
  }, []);

  const focusReplyAction = useCallback((commentId: number): void => {
    window.setTimeout(() => {
      replyActionRefs.current.get(commentId)?.focus();
    }, 0);
  }, []);

  const ensureDiscardableCommentDraft = useCallback((nextCommentId: number | null): boolean => {
    const hasActiveDraft = (replyTo !== null || editingCommentId !== null) && commentBody.trim().length > 0;
    const keepsCurrentTarget = nextCommentId !== null && (replyTo === nextCommentId || editingCommentId === nextCommentId);
    if (!hasActiveDraft || keepsCurrentTarget) {
      return true;
    }
    return window.confirm(t('library.page.discussion.discardDraftConfirm'));
  }, [commentBody, editingCommentId, replyTo, t]);

  const focusActiveCommentForm = useCallback((): void => {
    window.setTimeout(() => {
      activeCommentFormInputRef.current?.focus();
    }, 0);
  }, []);

  const goToRelativeCrop = useCallback((direction: 'next' | 'previous') => {
    if (selectedCropId === null || crops.length === 0) {
      return;
    }

    const currentIndex = crops.findIndex((crop) => crop.id === selectedCropId);
    if (currentIndex === -1) {
      return;
    }

    const delta = direction === 'next' ? 1 : -1;
    const nextIndex = (currentIndex + delta + crops.length) % crops.length;
    const nextCrop = crops[nextIndex];
    if (nextCrop) {
      updateSelectedCropId(nextCrop.id);
    }
  }, [crops, selectedCropId, updateSelectedCropId]);

  useCommandContextTag('publicCropLibrary');

  useEffect(() => {
    selectedCropIdRef.current = selectedCropId;
  }, [selectedCropId]);

  useEffect(() => {
    if (selectedCropIdFromUrl !== null) {
      if (pendingNavigationCropIdRef.current === selectedCropIdFromUrl) {
        // Our own navigate() just landed — selectedCropId was already set
        // optimistically when it was issued, so there's nothing left to sync.
        pendingNavigationCropIdRef.current = null;
        return;
      }
      if (pendingNavigationCropIdRef.current !== null) {
        // Our own navigate() is still resolving; the URL hasn't caught up
        // with it yet. Leave selectedCropId alone instead of reading this
        // stale URL as authoritative and snapping the selection back to
        // whatever it said before we picked something new — that snap-back
        // (followed by the correction once the URL does catch up) is what
        // made the crop list, and the import/update button that follows
        // selectedCrop, look like they were toggling after every pick.
        return;
      }
      if (selectedCropId !== selectedCropIdFromUrl) {
        setSelectedCropId(selectedCropIdFromUrl);
        selectedCropIdRef.current = selectedCropIdFromUrl;
        window.localStorage.setItem(SELECTED_PUBLIC_CROP_STORAGE_KEY, String(selectedCropIdFromUrl));
      }
      return;
    }

    if (!hasExplicitLibraryState) {
      const savedViewState = getStoredPublicCropLibraryViewState();
      if (savedViewState) {
        if (selectedCropId !== savedViewState.cropId) {
          setSelectedCropId(savedViewState.cropId);
          selectedCropIdRef.current = savedViewState.cropId;
          window.localStorage.setItem(SELECTED_PUBLIC_CROP_STORAGE_KEY, String(savedViewState.cropId));
        }
        if (query !== savedViewState.query) {
          setQuery(savedViewState.query);
        }
        cropListScrollTopRef.current = savedViewState.listScrollTop;
        navigateToLibraryState({
          cropId: savedViewState.cropId,
          tab: PUBLIC_CROP_TAB_INDEX_BY_PARAM[savedViewState.tab],
          discussionId: savedViewState.tab === 'discussion' ? savedViewState.discussionId : null,
          replace: true,
        });
        return;
      }
    }

    const storedCropId = getStoredPublicCropId();
    if (storedCropId !== null) {
      if (selectedCropId !== storedCropId) {
        setSelectedCropId(storedCropId);
        selectedCropIdRef.current = storedCropId;
      }
      navigateToLibraryState({
        cropId: storedCropId,
        tab: activeTab,
        discussionId: null,
        replace: true,
      });
    }
  }, [activeTab, hasExplicitLibraryState, navigateToLibraryState, query, selectedCropId, selectedCropIdFromUrl]);

  useEffect(() => {
    if (!hasExplicitLibraryState || selectedCropId === null) {
      return;
    }
    persistViewState();
  }, [hasExplicitLibraryState, persistViewState, selectedCropId]);

  useEffect(() => {
    if (loadStatus !== 'success' || selectedCropId === null || crops.length === 0) {
      return;
    }

    const savedViewState = getStoredPublicCropLibraryViewState();
    if (!savedViewState || savedViewState.cropId !== selectedCropId) {
      return;
    }

    cropListScrollTopRef.current = savedViewState.listScrollTop;
    window.setTimeout(() => {
      if (cropListRef.current) {
        cropListRef.current.scrollTop = savedViewState.listScrollTop;
      }
    }, 0);
  }, [crops.length, loadStatus, selectedCropId]);

  const loadCrops = useCallback(async (): Promise<void> => {
    const requestId = cropListRequestIdRef.current + 1;
    cropListRequestIdRef.current = requestId;
    setLoadStatus('loading');
    setLoadError('');
    try {
      const response = await publicCropAPI.listAll();
      let results = response.results;
      const currentSelectedCropId = selectedCropIdRef.current;
      if (currentSelectedCropId !== null && !results.some((crop) => crop.id === currentSelectedCropId)) {
        try {
          const selectedCropResponse = await publicCropAPI.get(currentSelectedCropId);
          results = [selectedCropResponse.data, ...results];
        } catch {
          if (requestId !== cropListRequestIdRef.current) {
            return;
          }
          updateSelectedCropId(null);
        }
      }
      if (requestId !== cropListRequestIdRef.current) {
        return;
      }
      setCrops(applySavedCrops(results, savedCropsRef.current));
      setLoadStatus('success');
    } catch {
      if (requestId !== cropListRequestIdRef.current) {
        return;
      }
      setLoadError(t('library.loadError'));
      setCrops([]);
      updateSelectedCropId(null);
      setLoadStatus('error');
    }
  }, [t, updateSelectedCropId]);

  const loadCollaboration = useCallback(async (cropId: number): Promise<void> => {
    const requestId = collaborationLoadRequestIdRef.current + 1;
    collaborationLoadRequestIdRef.current = requestId;
    setCollaborationStatus('loading');
    try {
      const [topicsResponse, versionsResponse] = await Promise.all([
        publicCropAPI.discussionTopics(cropId),
        publicCropAPI.versions(cropId),
      ]);
      if (requestId !== collaborationLoadRequestIdRef.current) {
        return;
      }
      setTopics(topicsResponse.data);
      setComments([]);
      setVersions(versionsResponse.data);
      setCollaborationStatus('success');
    } catch {
      if (requestId !== collaborationLoadRequestIdRef.current) {
        return;
      }
      setComments([]);
      setTopics([]);
      setVersions([]);
      setCollaborationStatus('error');
    }
  }, []);

  const refreshDiscussions = useCallback(async (): Promise<void> => {
    if (selectedCropId === null) return;
    try {
      const topicsResponse = await publicCropAPI.discussionTopics(selectedCropId);
      setTopics(topicsResponse.data);
      if (selectedTopicId !== null) {
        const commentsResponse = await publicCropAPI.discussionComments(
          selectedCropId,
          selectedTopicId,
        );
        setComments(commentsResponse.data);
        setCommentsStatus('success');
      }
    } catch {
      // Keep the last usable REST state; the socket and fallback poll retry.
    }
  }, [selectedCropId, selectedTopicId]);

  const handleDiscussionEvent = useCallback((event: WebSocketEvent): void => {
    if (
      event.type === 'discussion.updated'
      && event.public_crop_id === selectedCropId
    ) {
      void refreshDiscussions();
    }
  }, [refreshDiscussions, selectedCropId]);

  useWebSocket({
    path: user && selectedCropId !== null
      ? `ws/public-crops/${selectedCropId}/discussions/`
      : null,
    onEvent: handleDiscussionEvent,
    onFallbackPoll: () => { void refreshDiscussions(); },
  });

  useEffect(() => {
    void loadCrops();
  }, [loadCrops]);

  useEffect(() => {
    if (selectedCropId === null) {
      setComments([]);
      setVersions([]);
      setCollaborationStatus('idle');
      setCommentsStatus('idle');
      return;
    }
    void loadCollaboration(selectedCropId);
  }, [loadCollaboration, selectedCropId]);

  useEffect(() => {
    if (selectedCropId === null || selectedTopicId === null) {
      setComments([]);
      setCommentsStatus('idle');
      return;
    }
    if (collaborationStatus !== 'success') {
      return;
    }
    const topicExists = topics.some((topic) => topic.id === selectedTopicId);
    if (!topicExists) {
      navigateToLibraryState({
        cropId: selectedCropId,
        tab: PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion,
        discussionId: null,
        replace: true,
      });
      setComments([]);
      setCommentsStatus('idle');
      return;
    }

    let cancelled = false;
    setCommentsStatus('loading');
    publicCropAPI.discussionComments(selectedCropId, selectedTopicId)
      .then((response) => {
        if (!cancelled) {
          setComments(response.data);
          setCommentsStatus('success');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComments([]);
          setCommentsStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [collaborationStatus, navigateToLibraryState, selectedCropId, selectedTopicId, topics]);

  useEffect(() => {
    setCommentBody('');
    setTopicTitle('');
    setNewTopicOpen(false);
    setEditDialogOpen(false);
    setTranslationDialogOpen(false);
    setReplyTo(null);
    setEditingCommentId(null);
    setCommentBody('');
    setCommentActionMenu(null);
  }, [selectedCropId]);

  useEffect(() => {
    if (!selectedCrop) {
      setDescriptionDrafts({});
      return;
    }
    setDescriptionDrafts(buildPublicCropDescriptionDrafts(selectedCrop));
  }, [selectedCrop]);

  useEffect(() => {
    setReplyTo(null);
    setEditingCommentId(null);
    setCommentActionMenu(null);
    if (selectedTopicId !== null) {
      setNewTopicOpen(false);
      setTopicTitle('');
      setTopicRevision(undefined);
    }
  }, [selectedTopicId]);

  useEffect(() => {
    if (replyTo !== null || editingCommentId !== null) {
      focusActiveCommentForm();
    }
  }, [editingCommentId, focusActiveCommentForm, replyTo]);

  useEffect(() => {
    if (newTopicOpen) {
      window.setTimeout(() => {
        newTopicTitleInputRef.current?.focus();
      }, 0);
    }
  }, [newTopicOpen]);

  useEffect(() => {
    if (pendingFocusCommentId === null) {
      return;
    }
    const commentElement = commentRefs.current.get(pendingFocusCommentId);
    if (commentElement) {
      commentElement.focus();
      setPendingFocusCommentId(null);
    }
  }, [comments, pendingFocusCommentId]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
  };

  const performImport = useCallback(async (
    publicCropId: number,
    name: string,
    mode?: 'update' | 'new',
  ): Promise<void> => {
    setImportingId(publicCropId);
    try {
      const response = await publicCropAPI.importToProject(publicCropId, mode);
      const importedCrop = response.data.crop;
      // Bump the request id and record the merged row in savedCropsRef, the
      // same guards upsertCropInList uses below: without them, a crop
      // list request already in flight (or one the search debounce fires right
      // after) can land after this and overwrite project_import_status with
      // its pre-import snapshot, which reads as the import/update button
      // flickering back to its old label.
      cropListRequestIdRef.current += 1;
      setCrops((current) => current.map((crop) => {
        if (crop.id !== publicCropId) {
          return crop;
        }
        const updated = {
          ...crop,
          project_import_status: {
            crop_id: importedCrop.id as number,
            crop_name: importedCrop.crop_display_name || importedCrop.name,
            is_modified_from_source: Boolean(importedCrop.is_modified_from_source),
          },
        };
        savedCropsRef.current.set(crop.id, updated);
        return updated;
      }));
      if (mode === 'update') {
        showGlobalSnackbar({ message: t('library.importUpdatedForced', { name }), severity: 'success' });
      } else if (mode === 'new') {
        showGlobalSnackbar({ message: t('library.importedAsNew', { name }), severity: 'success' });
      } else if (response.data.operation === 'unchanged') {
        showGlobalSnackbar({ message: t('library.importUnchanged', { name }), severity: 'info' });
      } else if (response.data.operation === 'updated') {
        showGlobalSnackbar({ message: t('library.importUpdated', { name }), severity: 'success' });
      } else {
        showGlobalSnackbar({ message: t('library.importSuccess', { name }), severity: 'success' });
      }
      setImportConflict(null);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const conflict = error.response.data as ImportPublicCropConfirmationRequiredError | undefined;
        if (conflict?.code === 'import_requires_confirmation') {
          setImportConflict({
            publicCropId,
            name,
            varietyChange: conflict.variety_changed
              ? { from: conflict.existing_variety ?? '', to: conflict.public_variety ?? '' }
              : null,
          });
          return;
        }
      }
      showGlobalSnackbar({ message: t('library.importError'), severity: 'error' });
    } finally {
      setImportingId(null);
    }
  }, [t]);

  const handleImport = useCallback(async (): Promise<void> => {
    if (!selectedCrop) {
      return;
    }
    await performImport(selectedCrop.id, getCropTitle(selectedCrop, t, language));
  }, [language, performImport, selectedCrop, t]);

  const closeImportConflictDialog = useCallback((): void => {
    if (importingId !== null) {
      return;
    }
    setImportConflict(null);
  }, [importingId]);

  const handleImportConflictUpdate = useCallback((): void => {
    if (!importConflict) {
      return;
    }
    void performImport(importConflict.publicCropId, importConflict.name, 'update');
  }, [importConflict, performImport]);

  const handleImportConflictNew = useCallback((): void => {
    if (!importConflict) {
      return;
    }
    void performImport(importConflict.publicCropId, importConflict.name, 'new');
  }, [importConflict, performImport]);

  const openEditDialog = useCallback((): void => {
    if (!selectedCrop) {
      return;
    }
    setEditDialogOpen(true);
  }, [selectedCrop]);

  const closeEditDialog = (): void => {
    setEditDialogOpen(false);
  };

  const openTranslationDialog = useCallback((): void => {
    if (!selectedCrop) {
      return;
    }
    setTranslationDialogOpen(true);
  }, [selectedCrop]);

  const closeTranslationDialog = (): void => {
    setTranslationDialogOpen(false);
  };

  const openRemoveDialog = useCallback((): void => {
    if (!selectedCrop) {
      return;
    }
    setRemoveReason('');
    setRemoveDialogOpen(true);
  }, [selectedCrop]);

  const closeRemoveDialog = (): void => {
    if (removing) {
      return;
    }
    setRemoveDialogOpen(false);
    setRemoveReason('');
  };

  const handleConfirmRemove = async (): Promise<void> => {
    if (!selectedCrop || !removeReason) {
      return;
    }
    setRemoving(true);
    try {
      await publicCropAPI.remove(selectedCrop.id, removeReason);
      showGlobalSnackbar({
        message: t('library.removeSuccess', { name: getCropTitle(selectedCrop, t, language) }),
        severity: 'success',
      });
      setRemoveDialogOpen(false);
      setRemoveReason('');
      updateSelectedCropId(null);
      await loadCrops();
    } catch {
      showGlobalSnackbar({ message: t('library.removeError'), severity: 'error' });
    } finally {
      setRemoving(false);
    }
  };

  const openModeration = useCallback((): void => {
    navigate('/app/public-library-moderation');
  }, [navigate]);

  const topbarContextActions = useMemo<TopbarContextAction[]>(() => (
    canModeratePublicLibrary
      ? [
        {
          id: 'public-crop-library-moderation',
          label: t('library.page.moderation.open'),
          ariaLabel: pendingModerationCount > 0
            ? t('library.page.moderation.openWithPending', { count: pendingModerationCount })
            : t('library.page.moderation.open'),
          onClick: openModeration,
          appearance: 'standard' as const,
          badgeContent: pendingModerationCount,
          menuActions: [
            {
              id: 'public-crop-library-moderation-queue',
              label: t('library.moderation.title'),
              onClick: openModeration,
            },
            ...(selectedCrop ? [{
              id: 'public-crop-library-remove',
              label: t('library.removeAction'),
              onClick: openRemoveDialog,
              destructive: true,
            }] : []),
          ],
        },
      ]
      : []
  ), [canModeratePublicLibrary, openModeration, openRemoveDialog, pendingModerationCount, selectedCrop, t]);

  useTopbarContextActions(setTopbarContextActions, topbarContextActions);

  // `focusSearch` reads searchInputRef.current in its body, and the rule cannot
  // see into the imported spec factory to know the callback is only stored, not
  // invoked, so it assumes the ref could be read during render. The ref is only
  // ever touched when the command runs.
  const commandSpecs = useMemo(() => (
    // eslint-disable-next-line react-hooks/refs
    createPublicCropLibraryCommandSpecs({
      t,
      crops,
      focusSearch,
      goToRelativeCrop,
      handleImport: () => void handleImport(),
      openEditDialog,
      selectedCrop,
      importing: importingId !== null,
    })
  ), [crops, focusSearch, goToRelativeCrop, handleImport, importingId, openEditDialog, selectedCrop, t]);

  useRegisterCommands('public-crop-library-page', commandSpecs);

  const upsertCropInList = (updatedCrop: PublicCrop): void => {
    cropListRequestIdRef.current += 1;
    savedCropsRef.current.set(updatedCrop.id, updatedCrop);
    setLoadError('');
    setLoadStatus('success');
    setCrops((current) => {
      const existingIndex = current.findIndex((crop) => crop.id === updatedCrop.id);
      if (existingIndex === -1) {
        return [updatedCrop, ...current];
      }
      const next = [...current];
      next[existingIndex] = updatedCrop;
      return next;
    });
  };

  const handleTranslationDialogSaved = async (): Promise<void> => {
    if (!selectedCrop) {
      return;
    }
    const response = await publicCropAPI.get(selectedCrop.id);
    upsertCropInList(response.data);
    showGlobalSnackbar({ message: t('library.translation.saveSuccess'), severity: 'success' });
  };

  const handleEditSave = async (draft: Crop): Promise<void> => {
    if (!selectedCrop) {
      return;
    }
    try {
      const draftWithOriginalNotes = {
        ...draft,
        notes: descriptionDrafts[selectedCropOriginalLanguageCode] ?? '',
      };
      const response = await publicCropAPI.update(
        selectedCrop.id,
        buildPublicCropUpdatePayload(draftWithOriginalNotes, selectedCrop.version),
      );

      let updatedCrop = response.data;
      const initialDrafts = buildPublicCropDescriptionDrafts(selectedCrop);
      const currentTranslationChanged = currentLanguageCode !== selectedCropOriginalLanguageCode
        && (descriptionDrafts[currentLanguageCode] ?? '') !== (initialDrafts[currentLanguageCode] ?? '');
      if (currentTranslationChanged) {
        await publicCropAPI.updateTranslations(selectedCrop.id, {
          [currentLanguageCode]: descriptionDrafts[currentLanguageCode] ?? '',
        });
        const refreshedResponse = await publicCropAPI.get(selectedCrop.id);
        updatedCrop = refreshedResponse.data;
      }

      upsertCropInList(updatedCrop);
      setEditDialogOpen(false);
      await loadCollaboration(updatedCrop.id);
      showGlobalSnackbar({ message: t('library.page.edit.success'), severity: 'success' });
    } catch (error) {
      if (
        axios.isAxiosError(error)
        && error.response?.status === 409
        && (error.response.data as { code?: string } | undefined)?.code === 'public_crop_variety_conflict'
      ) {
        showGlobalSnackbar({ message: t('form.varietyConflict'), severity: 'error' });
        return;
      }
      showGlobalSnackbar({ message: t('library.page.edit.error'), severity: 'error' });
    }
  };

  const handleRevertVersion = async (version: number): Promise<void> => {
    if (!selectedCrop) {
      return;
    }
    setRevertingVersion(version);
    try {
      const response = await publicCropAPI.revert(selectedCrop.id, {
        version,
        base_version: selectedCrop.version,
      });
      upsertCropInList(response.data);
      await loadCollaboration(response.data.id);
      showGlobalSnackbar({ message: t('library.page.versions.revertSuccess'), severity: 'success' });
    } catch {
      showGlobalSnackbar({ message: t('library.page.versions.revertError'), severity: 'error' });
    } finally {
      setRevertingVersion(null);
    }
  };

  const handleCommentSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedCrop || !commentBody.trim() || (!selectedTopicId && !topicTitle.trim())) {
      return;
    }
    setSubmittingComment(true);
    try {
      if (selectedTopicId) {
        if (editingCommentId) {
          const updatedComment = await publicCropAPI.updateDiscussionComment(selectedCrop.id, editingCommentId, commentBody.trim());
          setPendingFocusCommentId(updatedComment.data.id);
        } else {
          const createdComment = await publicCropAPI.createDiscussionComment(selectedCrop.id, selectedTopicId, commentBody.trim(), replyTo ?? undefined);
          setPendingFocusCommentId(createdComment.data.id);
        }
        const response = await publicCropAPI.discussionComments(selectedCrop.id, selectedTopicId);
        setComments(response.data);
      } else {
        const createdTopic = await publicCropAPI.createDiscussionTopic(selectedCrop.id, { title: topicTitle.trim(), body: commentBody.trim(), revision: topicRevision });
        collaborationLoadRequestIdRef.current += 1;
        const [topicsResponse, commentsResponse] = await Promise.all([
          publicCropAPI.discussionTopics(selectedCrop.id),
          publicCropAPI.discussionComments(selectedCrop.id, createdTopic.data.id),
        ]);
        setTopics(withCreatedTopic(topicsResponse.data, createdTopic.data));
        setComments(commentsResponse.data);
        setCommentsStatus('success');
        setCollaborationStatus('success');
        navigateToLibraryState({
          cropId: selectedCrop.id,
          tab: PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion,
          discussionId: createdTopic.data.id,
          replace: false,
        });
        setNewTopicOpen(false);
        setTopicTitle('');
        setTopicRevision(undefined);
      }
      setCommentBody('');
      setReplyTo(null);
      setEditingCommentId(null);
      showGlobalSnackbar({ message: t('library.page.discussion.commentSuccess'), severity: 'success' });
    } catch {
      showGlobalSnackbar({ message: t('library.page.discussion.commentError'), severity: 'error' });
    } finally {
      setSubmittingComment(false);
    }
  };

  const openTopic = (topicId: number): void => {
    if (!selectedCrop) return;
    if (!ensureDiscardableCommentDraft(null)) {
      return;
    }
    setReplyTo(null);
    setEditingCommentId(null);
    setCommentBody('');
    navigateToLibraryState({
      cropId: selectedCrop.id,
      tab: PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion,
      discussionId: topicId,
      replace: false,
    });
  };

  const startDiscussionForVersion = (revision: PublicCropRevision): void => {
    if (selectedCrop) {
      navigateToLibraryState({
        cropId: selectedCrop.id,
        tab: PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion,
        discussionId: null,
        replace: false,
      });
    }
    setNewTopicOpen(true);
    setTopicRevision(revision.id);
  };

  const openNewTopicForm = (): void => {
    setNewTopicOpen(true);
    setTopicRevision(undefined);
  };

  const handleTabChange = (_event: unknown, value: number): void => {
    if (!selectedCrop) {
      return;
    }
    navigateToLibraryState({
      cropId: selectedCrop.id,
      tab: value,
      discussionId: null,
      replace: false,
    });
    setReplyTo(null);
    setEditingCommentId(null);
    setCommentBody('');
    setCommentActionMenu(null);
    if (value !== PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion) {
      setNewTopicOpen(false);
      setTopicTitle('');
      setTopicRevision(undefined);
    }
  };

  const cancelNewTopicForm = (): void => {
    setNewTopicOpen(false);
    setTopicTitle('');
    setCommentBody('');
    setTopicRevision(undefined);
    window.setTimeout(() => {
      newTopicButtonRef.current?.focus();
    }, 0);
  };

  const deleteComment = async (commentId: number): Promise<void> => {
    if (!selectedCrop || !selectedTopicId) return;
    try {
      await publicCropAPI.deleteDiscussionComment(selectedCrop.id, commentId);
      const [topicsResponse, commentsResponse] = await Promise.all([
        publicCropAPI.discussionTopics(selectedCrop.id),
        publicCropAPI.discussionComments(selectedCrop.id, selectedTopicId),
      ]);
      setTopics(topicsResponse.data);
      setComments(commentsResponse.data);
      if (!topicsResponse.data.some((topic) => topic.id === selectedTopicId)) {
        navigateToLibraryState({
          cropId: selectedCrop.id,
          tab: PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion,
          discussionId: null,
          replace: true,
        });
      }
    } catch {
      showGlobalSnackbar({ message: t('library.page.discussion.commentError'), severity: 'error' });
    }
  };

  const showRootDeleteBlockedMessage = (): void => {
    showGlobalSnackbar({ message: t('library.page.discussion.rootDeleteBlocked'), severity: 'error' });
  };

  const startReply = (commentId: number): void => {
    if (!ensureDiscardableCommentDraft(commentId)) {
      return;
    }
    setReplyTo(commentId);
    setEditingCommentId(null);
    setCommentBody('');
  };

  const startEdit = (comment: PublicCropDiscussionComment): void => {
    if (!ensureDiscardableCommentDraft(comment.id)) {
      return;
    }
    setEditingCommentId(comment.id);
    setReplyTo(null);
    setCommentBody(comment.body);
  };

  const cancelActiveCommentForm = (): void => {
    const focusCommentId = replyTo ?? editingCommentId;
    setReplyTo(null);
    setEditingCommentId(null);
    setCommentBody('');
    if (focusCommentId !== null) {
      focusReplyAction(focusCommentId);
    }
  };

  const closeSelectedTopic = (): void => {
    if (!ensureDiscardableCommentDraft(null)) {
      return;
    }
    setComments([]);
    setCommentsStatus('idle');
    setReplyTo(null);
    setEditingCommentId(null);
    setCommentBody('');
    navigateToLibraryState({
      cropId: selectedCropId,
      tab: PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion,
      discussionId: null,
      replace: false,
    });
  };

  const libraryCardSx = {
    borderRadius: 1,
    border: '1px solid',
    borderColor: 'divider',
    boxShadow: 3,
    overflow: 'hidden',
    bgcolor: 'background.paper',
  } as const;

  // Memoized so unrelated re-renders elsewhere on this page (typing in the
  // search box, opening a discussion, etc.) don't force DetailPageActions —
  // and every MUI Button/Emotion style inside it — to re-render from a fresh
  // primaryActions array on every keystroke. DetailPageActions is wrapped in
  // React.memo, so this only re-renders when one of the values below
  // actually changes.
  const cropActions = useMemo(() => (selectedCrop ? (
    <DetailPageActions
      compact={useCompactLibraryLayout}
      primaryActions={[
        {
          label: t('library.page.edit.open'),
          icon: <EditOutlinedIcon fontSize="small" />,
          onClick: openEditDialog,
        },
        {
          label: importingId
            ? t('library.importing')
            : selectedCrop.project_import_status
              ? t('library.importUpdateButton')
              : t('library.importButton'),
          icon: selectedCrop.project_import_status
            ? <SyncOutlinedIcon fontSize="small" />
            : <DownloadOutlinedIcon fontSize="small" />,
          onClick: () => void handleImport(),
          // Import and the library-update sync both copy an entry whose
          // species is not settled yet; they wait for the moderator.
          disabled: importingId !== null || isSelectedSpeciesPending,
          tooltip: isSelectedSpeciesPending ? t('library.badges.speciesPendingTooltip') : undefined,
          variant: 'contained',
        },
      ]}
    />
  ) : null), [
    handleImport,
    importingId,
    isSelectedSpeciesPending,
    openEditDialog,
    selectedCrop,
    t,
    useCompactLibraryLayout,
  ]);
  return (
    <PageContainer variant="xwide">
      <Box sx={{ width: '100%' }}>
        <Stack spacing={2}>
          {loadError ? <Alert severity="error">{loadError}</Alert> : null}

          <Box
            ref={libraryAreaRef}
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', md: 'row' },
              gap: { xs: 1.25, lg: 1.1, xl: 1.25 },
              height: { md: libraryAreaMaxHeight !== null ? `${libraryAreaMaxHeight}px` : 'calc(100vh - 210px)' },
            }}
          >
            {!useCompactLibraryLayout ? (
            <Card
              variant="outlined"
              sx={{
                ...libraryCardSx,
                width: { md: 230, lg: 300, xl: 330 },
                flexShrink: 0,
                height: { md: '100%' },
                // Flex items default to `min-height: auto`, which ignores the
                // parent's bounded height and lets content push the card taller
                // than its 100% instead of letting the inner list scroll.
                minHeight: { xs: 280, md: 0 },
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box component="form" onSubmit={handleSearchSubmit} sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
                <TextField
                  inputRef={searchInputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => setIsSearchInputFocused(true)}
                  onBlur={() => setIsSearchInputFocused(false)}
                  label={t('library.searchLabel')}
                  size="small"
                  fullWidth
                    slotProps={{
                      input: {
                        endAdornment: (
                          <>
                            {query ? (
                              <AppTooltip title={t('clearSearch')}>
                                <IconButton
                                  size="small"
                                  aria-label={t('clearSearch')}
                                  onClick={() => {
                                    setQuery('');
                                    searchInputRef.current?.focus();
                                  }}
                                >
                                  <CloseIcon fontSize="small" />
                                </IconButton>
                              </AppTooltip>
                            ) : null}
                            <IconButton
                              size="small"
                              onClick={(event) => setLibraryFilterAnchorEl(event.currentTarget)}
                              aria-expanded={isLibraryFilterPopoverOpen}
                              aria-haspopup="dialog"
                              aria-controls={isLibraryFilterPopoverOpen ? 'public-crop-filters-popover' : undefined}
                              aria-label={t('filters.openAdvanced')}
                              sx={{ bgcolor: activeLibraryFilterCount > 0 ? 'action.selected' : 'transparent' }}
                            >
                              <Badge color="primary" badgeContent={activeLibraryFilterCount > 0 ? activeLibraryFilterCount : null}>
                                <TuneIcon fontSize="small" />
                              </Badge>
                            </IconButton>
                          </>
                        ),
                      }
                    }}
                />
              </Box>
              <PublicCropFiltersPopover
                anchorEl={libraryFilterAnchorEl}
                onClose={() => setLibraryFilterAnchorEl(null)}
                filters={libraryFilters}
                onFilterChange={(key, value) => setLibraryFilters((prev) => ({ ...prev, [key]: value }))}
                options={libraryFilterOptions}
                onReset={() => {
                  setLibraryFilters(EMPTY_PUBLIC_CROP_FILTERS);
                  setLibraryFilterAnchorEl(null);
                }}
              />
              {isCropLoading ? (
                <Box sx={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Stack spacing={1} sx={{ alignItems: "center", }} >
                    <CircularProgress size={28} />
                    <Typography variant="body2" color="text.secondary">{t('messages.loadingCrops')}</Typography>
                  </Stack>
                </Box>
              ) : loadStatus === 'error' ? (
                <Box sx={{ p: 2 }}>
                  <Alert severity="error">{loadError}</Alert>
                </Box>
              ) : filteredLibraryCrops.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t('library.emptyState.noResultsTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                    {t('library.empty')}
                  </Typography>
                </Box>
              ) : (
                <PublicCropHierarchyList
                  listRef={cropListRef}
                  crops={filteredLibraryCrops}
                  selectedCropId={selectedCropId}
                  isSpeciesView={isSpeciesView}
                  storageKey="publicCropLibrary"
                  searchQuery={query}
                  autoFocusSelected={!useCompactLibraryLayout && !isSearchInputFocused}
                  dense
                  ariaLabel={t('library.page.title')}
                  onScroll={handleCropListScroll}
                  onSelect={(crop, { kind, speciesKey }) => {
                    updateSelectedCropId(crop.id, {
                      replace: false,
                      speciesViewKey: kind === 'species' ? speciesKey : null,
                    });
                  }}
                  // MUI breakpoint values cascade upward when not overridden, so the
                  // mobile-only 280px cap must be explicitly cleared at md+ or it
                  // silently caps the list there too, leaving the flex-grown space
                  // below it blank no matter how tall the surrounding card is.
                  sx={{
                    py: { xs: 0.5, lg: 0.75 },
                    px: { xs: 0.5, lg: 0.75 },
                    maxHeight: { xs: 280, md: 'none' },
                    flex: { md: 1 },
                    minHeight: 0,
                    overflow: 'auto',
                  }}
                />
              )}
            </Card>
            ) : null}

            <Box
              sx={{
                minWidth: 0,
                width: '100%',
                flex: { md: 1 },
                display: 'flex',
                justifyContent: 'flex-start',
                height: { md: '100%' },
              }}
            >
              <Card
                variant="outlined"
                sx={{
                  ...libraryCardSx,
                  width: '100%',
                  maxWidth: { sm: 920, lg: 980, xl: 1040 },
                  minHeight: 420,
                  // The card itself (not a wider wrapper spanning the full column) owns
                  // the bounded height and scroll, so its own scrollbar hugs the card's
                  // right edge instead of sitting far away at the wrapper's full width.
                  height: { md: '100%' },
                  overflowY: { md: 'auto' },
                }}
              >
                {isCropLoading && !selectedCrop ? (
                  <Box sx={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
                    <Stack spacing={1} sx={{ alignItems: "center", }} >
                      <CircularProgress size={28} />
                      <Typography variant="body2" color="text.secondary">{t('messages.loadingCrops')}</Typography>
                    </Stack>
                  </Box>
                ) : loadStatus === 'error' && !selectedCrop ? (
                  <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
                    <Alert severity="error">{loadError}</Alert>
                  </Box>
                ) : !selectedCrop ? (
                <Box sx={{ p: { xs: 3, sm: 4 }, display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 3.5 } }}>
                  <Stack spacing={1} sx={{ textAlign: 'center', maxWidth: 480, mx: 'auto',
                    alignItems: "center", }}  >
                    <Box
                      sx={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        bgcolor: 'success.50',
                        color: 'success.main',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <SpaOutlinedIcon sx={{ fontSize: 30 }} />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 700, textWrap: 'balance' }}>
                      {t('library.emptyState.noSelectionTitle')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('library.emptyState.noSelectionDescription')}
                    </Typography>
                    {useCompactLibraryLayout && crops.length > 0 ? (
                      <Button variant="outlined" onClick={() => setMobileSelectorOpen(true)}>
                        {t('selectCrop')}
                      </Button>
                    ) : null}
                  </Stack>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: { xs: 2.5, sm: 3 } }}>
                    <Stack spacing={0.75} sx={{ textAlign: 'center',
                      alignItems: "center", }}  >
                      <SearchOutlinedIcon sx={{ color: 'success.main', fontSize: 28 }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        {t('library.emptyState.discoverTitle')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                        {t('library.emptyState.discoverDescription')}
                      </Typography>
                    </Stack>
                    <Stack spacing={0.75} sx={{ textAlign: 'center',
                      alignItems: "center", }}  >
                      <DownloadOutlinedIcon sx={{ color: 'success.main', fontSize: 28 }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        {t('library.emptyState.importTitle')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                        {t('library.emptyState.importDescription')}
                      </Typography>
                    </Stack>
                    <Stack spacing={0.75} sx={{ textAlign: 'center',
                      alignItems: "center", }}  >
                      <HistoryOutlinedIcon sx={{ color: 'success.main', fontSize: 28 }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        {t('library.emptyState.improveTitle')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                        {t('library.emptyState.improveDescription')}
                      </Typography>
                    </Stack>
                  </Box>
                </Box>
                ) : (
                <Stack sx={{ minHeight: '100%' }}>
                  <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
                    <Stack
                      data-testid="public-crop-detail-header"
                      direction="row"
                      spacing={1.5}
                      useFlexGap
                      // Never wraps: the actions stay pinned top-right and the
                      // title column shrinks (and wraps to a second line) instead,
                      // so a long crop name can't push them onto their own row.
                      sx={{ flexWrap: "nowrap",
                    alignItems: "flex-start",
                    justifyContent: "space-between", }}
                    >
                      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'stretch', gap: 1.75 }}>
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
                            aria-label={t('library.page.fields.displayColor')}
                            title={selectedCrop.display_color}
                          />
                        ) : null}
                        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', py: 0.25 }}>
                          {useCompactLibraryLayout ? (
                            <CropTitleSelectorButton
                              title={selectedCropName.text}
                              ariaLabel={t('selectCrop')}
                              onClick={() => setMobileSelectorOpen(true)}
                              titleSx={{ fontSize: '1.5rem' }}
                            />
                          ) : (
                            <Typography variant="h5" component="h2" sx={{ fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.2 }}>
                              {selectedCropName.text}
                            </Typography>
                          )}
                          {selectedCrop.variety ? (
                            !isSpeciesView ? (
                              <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase' }}>
                                  {t('hierarchy.varietyLabel')}
                                </Typography>
                                <Typography variant="body2" color="text.primary" sx={{ fontWeight: 600 }}>
                                  {selectedCrop.variety}
                                </Typography>
                              </Stack>
                            ) : null
                          ) : null}
                          <Stack direction="row" spacing={0.75} sx={{ mt: 1,
                            flexWrap: "wrap", }}  useFlexGap >
                            {isSelectedSpeciesPending ? <CropSpeciesPendingChip /> : null}
                            <Chip size="small" label={t('library.page.byAuthor', { author: selectedCrop.created_by_label || anonymousLabel })} variant="outlined" />
                          </Stack>
                        </Box>
                      </Box>
                      {cropActions ? (
                        <Box sx={{ flexShrink: 0, ml: 'auto' }}>
                          {cropActions}
                        </Box>
                      ) : null}
                    </Stack>
                  </CardContent>
                  <Divider />
                  <Tabs
                    value={activeTab}
                    onChange={handleTabChange}
                    variant={isMobile ? 'fullWidth' : 'scrollable'}
                    allowScrollButtonsMobile
                    sx={{ px: { xs: 1, sm: 2 } }}
                  >
                    <Tab icon={isMobile ? undefined : <SpaOutlinedIcon />} iconPosition="start" label={t('library.page.tabs.details')} />
                    <Tab icon={isMobile ? undefined : <HistoryOutlinedIcon />} iconPosition="start" label={t('library.page.tabs.versions')} />
                    <Tab
                      icon={isMobile ? undefined : <ForumOutlinedIcon />}
                      iconPosition="start"
                      label={t('library.page.tabs.discussion')}
                      onClick={() => {
                        if (selectedTopicId !== null) {
                          closeSelectedTopic();
                        }
                      }}
                    />
                  </Tabs>
                  <Divider />

                    {activeTab === 0 ? (
                      <Stack spacing={2.5} sx={{ p: { xs: 2, sm: 2.5 } }}>
                        {showVarietyValueLegend ? (
                          <VarietyValueLegend
                            sampleLabel={t('hierarchy.ownValueLegendSample')}
                            description={t('hierarchy.ownValueLegendDescription')}
                          />
                        ) : null}

                        {isSpeciesView && editFormCrop ? (
                          <>
                            <CropVarietiesOverview
                              varieties={publicVarietyRows}
                              cropCrop={editFormCrop}
                              onSelect={(crop) => {
                                if (crop.id !== undefined) {
                                  updateSelectedCropId(crop.id, { replace: false });
                                }
                              }}
                            />
                            <Divider />
                          </>
                        ) : null}

                        <DetailSection title={t('library.page.sections.general')} outlined>
                        <DetailGrid>
                          <DetailRow label={t('library.page.fields.cropSpecies')} value={selectedCropName.text || t('library.page.notSpecified')} />
                          {!isSpeciesView ? (
                            <DetailRow label={t('library.page.fields.variety')} value={selectedCrop.variety || t('library.page.notSpecified')} />
                          ) : null}
                          <DetailRow label={t('library.page.fields.cropFamily')} value={getPublicFieldValue('crop_family', selectedCrop.crop_family) || t('library.page.notSpecified')} source={getPublicFieldSource('crop_family')} />
                          <DetailRow
                            label={t('library.page.fields.nutrientDemand')}
                            value={getNutrientDemandLabel(getPublicFieldValue('nutrient_demand', selectedCrop.nutrient_demand), t, t('library.page.notSpecified'))}
                            source={getPublicFieldSource('nutrient_demand')}
                          />
                          <DetailRow
                            label={t('library.page.fields.cultivationType')}
                            value={getCultivationTypesLabel({
                              ...selectedCrop,
                              cultivation_types: getPublicFieldValue('cultivation_types', selectedCrop.cultivation_types),
                              cultivation_type: getPublicFieldValue('cultivation_type', selectedCrop.cultivation_type),
                            }, t, t('library.page.notSpecified'))}
                            source={getPublicFieldSource('cultivation_types') ?? getPublicFieldSource('cultivation_type')}
                          />
                        </DetailGrid>
                      </DetailSection>

                      <Divider />

                      <DetailSection title={t('library.page.sections.timing')}>
                        <DetailGrid>
                          <DetailRow label={t('library.page.fields.growthDurationDays')} value={formatDays(getPublicFieldValue('growth_duration_days', selectedCrop.growth_duration_days), locale, t('library.page.notSpecified'), t('library.page.units.days'))} source={getPublicFieldSource('growth_duration_days')} />
                          <DetailRow label={t('library.page.fields.harvestDurationDays')} value={formatDays(getPublicFieldValue('harvest_duration_days', selectedCrop.harvest_duration_days), locale, t('library.page.notSpecified'), t('library.page.units.days'))} source={getPublicFieldSource('harvest_duration_days')} />
                          <DetailRow label={t('library.page.fields.propagationDurationDays')} value={formatDays(getPublicFieldValue('propagation_duration_days', selectedCrop.propagation_duration_days), locale, t('library.page.notSpecified'), t('library.page.units.days'))} source={getPublicFieldSource('propagation_duration_days')} />
                        </DetailGrid>
                      </DetailSection>

                      <Divider />

                      <DetailSection title={t('library.page.sections.spacing')}>
                        <DetailGrid>
                          <DetailRow label={t('library.page.fields.distanceWithinRow')} value={formatMetersAsCentimeters(getPublicFieldValue('distance_within_row_m', selectedCrop.distance_within_row_m), locale, t('library.page.notSpecified'))} source={getPublicFieldSource('distance_within_row_m')} />
                          <DetailRow label={t('library.page.fields.rowSpacing')} value={formatMetersAsCentimeters(getPublicFieldValue('row_spacing_m', selectedCrop.row_spacing_m), locale, t('library.page.notSpecified'))} source={getPublicFieldSource('row_spacing_m')} />
                          <DetailRow label={t('library.page.fields.sowingDepth')} value={formatMetersAsCentimeters(getPublicFieldValue('sowing_depth_m', selectedCrop.sowing_depth_m), locale, t('library.page.notSpecified'))} source={getPublicFieldSource('sowing_depth_m')} />
                        </DetailGrid>
                      </DetailSection>

                      <Divider />

                      <DetailSection title={t('library.page.sections.seed')}>
                        <CropSeedDetails
                          activeCultivationTypes={publicActiveCultivationTypes}
                          seedRateRows={publicSeedRateRows}
                          showSeedSafetyMargin={false}
                          seedingRequirement={getPublicFieldValue('seeding_requirement', selectedCrop.seeding_requirement)}
                          seedingRequirementSource={getPublicFieldSource('seeding_requirement')}
                          seedingRequirementType={getPublicFieldValue('seeding_requirement_type', selectedCrop.seeding_requirement_type)}
                          seedingRequirementTypeSource={getPublicFieldSource('seeding_requirement_type')}
                          thousandKernelWeightG={getPublicFieldValue('thousand_kernel_weight_g', selectedCrop.thousand_kernel_weight_g)}
                          thousandKernelWeightSource={getPublicFieldSource('thousand_kernel_weight_g')}
                          emptyValueLabel={t('library.page.notSpecified')}
                          locale={locale}
                          t={t}
                        />
                      </DetailSection>

                      <Divider />

                      <DetailSection title={t('library.page.sections.harvest')}>
                        <DetailGrid>
                          <DetailRow label={t('library.page.fields.harvestMethod')} value={getHarvestMethodLabel(getPublicFieldValue('harvest_method', selectedCrop.harvest_method), t, t('library.page.notSpecified'))} source={getPublicFieldSource('harvest_method')} />
                          <DetailRow label={t('library.page.fields.expectedYield')} value={getPublicFieldValue('expected_yield', selectedCrop.expected_yield) === null || getPublicFieldValue('expected_yield', selectedCrop.expected_yield) === undefined ? t('library.page.notSpecified') : `${formatLocalizedNumber(getPublicFieldValue('expected_yield', selectedCrop.expected_yield), locale, t('library.page.notSpecified'), { maximumFractionDigits: 2 })} kg`} source={getPublicFieldSource('expected_yield')} />
                        </DetailGrid>
                      </DetailSection>

                      <Divider />

                      <DetailSection title={t('library.page.sections.metadata')}>
                        <DetailGrid>
                          <DetailRow label={t('library.page.fields.originalLanguage')} value={getLanguageLabel(selectedCrop.original_language_code, i18n.resolvedLanguage ?? i18n.language, t('library.page.notSpecified'))} />
                          <DetailRow label={t('library.page.fields.publishedAt')} value={formatDate(selectedCrop.published_at)} />
                          <DetailRow label={t('library.page.fields.updatedAt')} value={formatDate(selectedCrop.updated_at)} />
                        </DetailGrid>
                      </DetailSection>

                      <Divider />

                      <DetailSection title={t('library.page.sections.notes')} outlined showHeaderDivider>
                        {/* The public description is translatable; when only
                            another language exists, say so instead of showing
                            it as if it were this language. */}
                        {descriptionFallbackNotice ? (
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{ mb: 1,
                      alignItems: { xs: 'flex-start', sm: 'center' }, }}
                          >
                            <AppTooltip title={descriptionFallbackNotice.tooltip}>
                              <Chip
                                size="small"
                                icon={<TranslateOutlinedIcon fontSize="small" />}
                                label={descriptionFallbackNotice.label}
                                variant="outlined"
                                color="warning"
                              />
                            </AppTooltip>
                            {canEditPublicCrop ? (
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<TranslateOutlinedIcon fontSize="small" />}
                                onClick={openTranslationDialog}
                              >
                                {t('library.translation.addTranslationAction', {
                                  language: getLanguageDisplayName(currentLanguageCode, language),
                                })}
                              </Button>
                            ) : null}
                          </Stack>
                        ) : null}
                        {selectedCropDescription.text ? (
                          <Box
                            sx={{
                              '& h3': { mt: 2, mb: 1, fontSize: '1.05rem' },
                              '& h3:first-of-type': { mt: 0.25 },
                              '& p': { mb: 1, maxWidth: '95ch' },
                              '& ul': { pl: 3, mb: 1 },
                              '& li': { mb: 0.5 },
                              '& a': { color: 'primary.main' },
                              '& em': { color: 'text.secondary' },
                            }}
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                              {stripCitationMarkers(selectedCropDescription.text)}
                            </ReactMarkdown>
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            {t('library.page.noNotes')}
                          </Typography>
                        )}
                      </DetailSection>
                    </Stack>
                  ) : null}

                  {activeTab === 1 ? (
                    <Stack spacing={2} sx={{ p: { xs: 2, sm: 2.5 } }}>
                      {collaborationStatus === 'loading' ? <CircularProgress size={24} /> : null}
                      {collaborationStatus === 'error' ? <Alert severity="error">{t('library.page.collaborationLoadError')}</Alert> : null}
                      {versions.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {t('library.page.versions.empty')}
                        </Typography>
                      ) : (
                        <Stack spacing={1.25}>
                          {versions.map((revision) => (
                            <VersionCard
                              key={revision.id}
                              revision={revision}
                              currentVersion={selectedCrop.version}
                              anonymousLabel={anonymousLabel}
                              formatDate={formatDate}
                              onRevert={handleRevertVersion}
                              revertingVersion={revertingVersion}
                              t={t}
                              onDiscuss={startDiscussionForVersion}
                            />
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  ) : null}

                  {activeTab === 2 ? (
                    <Stack spacing={2} sx={{ p: { xs: 2, sm: 2.5 } }}>
                      {/* Reading an existing discussion stays possible; only
                          writing waits for the species review. */}
                      {isSelectedSpeciesPending ? (
                        <Alert severity="info">{t('library.badges.speciesPendingTooltip')}</Alert>
                      ) : null}
                      {collaborationStatus === 'loading' ? <CircularProgress size={24} /> : null}
                      {collaborationStatus === 'error' ? <Alert severity="error">{t('library.page.collaborationLoadError')}</Alert> : null}
                      {selectedTopicId === null ? (
                        <Stack spacing={1.25}>
                          {!newTopicOpen && topics.length > 0 ? (
                            <Button
                              ref={newTopicButtonRef}
                              variant="outlined"
                              startIcon={<AddOutlinedIcon />}
                              sx={{ alignSelf: 'flex-start' }}
                              onClick={openNewTopicForm}
                              disabled={isSelectedSpeciesPending}
                            >
                              {t('library.page.discussion.newTopic')}
                            </Button>
                          ) : null}
                          {newTopicOpen ? (
                            <Box component="form" onSubmit={(event) => void handleCommentSubmit(event)} sx={{ display: 'grid', gap: 1, pb: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="subtitle2">{t('library.page.discussion.newTopic')}</Typography>
                              <TextField inputRef={newTopicTitleInputRef} label={t('library.page.discussion.titleLabel')} value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} />
                              <TextField label={t('library.page.discussion.commentLabel')} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} multiline minRows={2} maxRows={8} />
                              {topicRevision ? (
                                <Stack direction="row" spacing={1} sx={{ alignItems: "center", }} >
                                  <Typography variant="caption" color="text.secondary">{t('library.page.discussion.versionReference')}</Typography>
                                  <Chip size="small" label={t('library.page.versions.versionTitle', { version: versions.find((version) => version.id === topicRevision)?.version })} />
                                </Stack>
                              ) : null}
                              <Stack direction="row" spacing={1}>
                                <Button type="submit" variant="contained" disabled={submittingComment || !topicTitle.trim() || !commentBody.trim()}>{t('library.page.discussion.create')}</Button>
                                <Button onClick={cancelNewTopicForm}>{t('library.page.discussion.cancel')}</Button>
                              </Stack>
                            </Box>
                          ) : null}
                          {topics.length === 0 && !newTopicOpen ? (
                            <Box sx={{ display: 'grid', gap: 1 }}>
                              <Box>
                                <Typography variant="subtitle2">{t('library.page.discussion.emptyTitle')}</Typography>
                                <Typography variant="body2" color="text.secondary">{t('library.page.discussion.empty')}</Typography>
                              </Box>
                              <Button
                                ref={newTopicButtonRef}
                                variant="outlined"
                                startIcon={<AddOutlinedIcon />}
                                sx={{ justifySelf: 'flex-start' }}
                                onClick={openNewTopicForm}
                                disabled={isSelectedSpeciesPending}
                              >
                                {t('library.page.discussion.newTopic')}
                              </Button>
                            </Box>
                          ) : topics.map((topic) => (
                            <ListItemButton
                              key={topic.id}
                              onClick={() => void openTopic(topic.id)}
                              sx={{
                                alignItems: 'flex-start',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 0,
                                cursor: 'pointer',
                                display: 'grid',
                                gap: 0.5,
                                gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' },
                                px: 0,
                                py: 1.25,
                                '&:hover': { bgcolor: 'action.hover' },
                                '&.Mui-focusVisible': {
                                  boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
                                },
                              }}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{topic.title}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {t('library.page.discussion.topicMeta', {
                                    author: topic.created_by_label || anonymousLabel,
                                    count: topic.comment_count,
                                    date: formatDate(topic.last_activity_at || topic.created_at),
                                  })}
                                </Typography>
                                {topic.last_comment_preview ? (
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      mt: 0.25,
                                    }}
                                  >
                                    {formatDiscussionPreview(topic.last_comment_preview)}
                                  </Typography>
                                ) : null}
                              </Box>
                              {topic.version ? (
                                <Chip
                                  size="small"
                                  label={t('library.page.versions.versionTitle', { version: topic.version })}
                                  sx={{ justifySelf: { xs: 'flex-start', sm: 'flex-end' }, mt: { xs: 0.25, sm: 0 } }}
                                />
                              ) : null}
                            </ListItemButton>
                          ))}
                        </Stack>
                      ) : (
                        <Stack spacing={2}>
                          <Button
                            size="small"
                            variant="text"
                            startIcon={<ArrowBackOutlinedIcon />}
                            sx={{ alignSelf: 'flex-start' }}
                            onClick={closeSelectedTopic}
                          >
                            {t('library.page.discussion.back')}
                          </Button>
                          <Typography variant="h6" component="h2">
                            {selectedTopic?.title}
                          </Typography>
                          {commentsStatus === 'loading' || !selectedTopic ? <CircularProgress size={24} /> : null}
                          {commentsStatus === 'error' ? <Alert severity="error">{t('library.page.collaborationLoadError')}</Alert> : null}
                          {commentsStatus !== 'loading' && commentsStatus !== 'error' && selectedTopic ? (
                            <Stack spacing={2.25}>
                              {threadCommentTree.map((node) => (
                                <ThreadCommentBranch
                                  key={node.comment.id}
                                  node={node}
                                  depth={0}
                                  anonymousLabel={anonymousLabel}
                                  formatDate={formatDate}
                                  replyTo={replyTo}
                                  editingCommentId={editingCommentId}
                                  commentActionMenu={commentActionMenu}
                                  submittingComment={submittingComment}
                                  writingDisabled={isSelectedSpeciesPending}
                                  commentBody={commentBody}
                                  t={t}
                                  onReply={startReply}
                                  onEdit={startEdit}
                                  onDelete={(commentId) => void deleteComment(commentId)}
                                  onDeleteBlocked={showRootDeleteBlockedMessage}
                                  onOpenMenu={(commentId, anchorElement) => setCommentActionMenu({ commentId, anchorElement })}
                                  onCloseMenu={() => setCommentActionMenu(null)}
                                  onCancelEdit={cancelActiveCommentForm}
                                  onCommentSubmit={(event) => void handleCommentSubmit(event)}
                                  onCommentBodyChange={setCommentBody}
                                  registerReplyActionRef={registerReplyActionRef}
                                  registerCommentRef={registerCommentRef}
                                  activeFormInputRef={activeCommentFormInputRef}
                                />
                              ))}
                            </Stack>
                          ) : null}
                          {replyTo === null && editingCommentId === null && commentsStatus !== 'loading' && commentsStatus !== 'error' && selectedTopic ? (
                            <CommentForm
                              body={commentBody}
                              disabled={submittingComment || isSelectedSpeciesPending}
                              label={t('library.page.discussion.commentLabel')}
                              submitLabel={t('library.page.discussion.submit')}
                              t={t}
                              onBodyChange={setCommentBody}
                              onSubmit={(event) => void handleCommentSubmit(event)}
                            />
                          ) : null}
                        </Stack>
                      )}
                    </Stack>
                  ) : null}
                </Stack>
                )}
              </Card>
            </Box>
          </Box>
        </Stack>
      </Box>
      <PublicCropMobileSelectorDialog
          open={mobileSelectorOpen}
          query={query}
          crops={filteredLibraryCrops}
        loading={isCropLoading}
        error={loadStatus === 'error' ? loadError : ''}
        selectedCropId={selectedCropId}
        selectedSpeciesViewKey={selectedSpeciesViewKey}
        listRef={cropListRef}
        onClose={() => setMobileSelectorOpen(false)}
        onQueryChange={setQuery}
        onSearchSubmit={handleSearchSubmit}
        onSelect={selectMobileCrop}
        onListScroll={handleCropListScroll}
      />
      {editDialogOpen && selectedCrop ? (
        <CropForm
          crop={editFormCrop}
          crops={editFormCrops}
          onSave={handleEditSave}
          onCancel={closeEditDialog}
          title={t('library.page.edit.title')}
          variant="publicLibrary"
          hasExternalChanges={hasDescriptionDraftChanges}
          importedCopiesCount={selectedCrop.imported_crops_count}
          publicIdentityReadOnly={!canManageModeratorRequests}
          extraSections={(
            <MultilingualTextFieldSection
              title={t('form.notes')}
              fieldLabel={t('form.notes')}
              originalLanguageCode={selectedCropOriginalLanguageCode}
              currentLanguageCode={currentLanguageCode}
              originalValue={originalDescriptionDraft}
              translationValue={currentDescriptionDraft}
              translationPlaceholder={t('library.translation.descriptionPlaceholder')}
              onOriginalValueChange={(value) => setDescriptionDrafts((current) => ({
                ...current,
                [selectedCropOriginalLanguageCode]: value,
              }))}
              onTranslationValueChange={(value) => setDescriptionDrafts((current) => ({
                ...current,
                [currentLanguageCode]: value,
              }))}
            />
          )}
        />
      ) : null}
      {translationDialogOpen && selectedCrop ? (
        <PublicCropTranslationDialog
          open={translationDialogOpen}
          crop={selectedCrop}
          language={currentLanguageCode}
          onClose={closeTranslationDialog}
          onSaved={handleTranslationDialogSaved}
        />
      ) : null}
      <Dialog open={removeDialogOpen} onClose={closeRemoveDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library.removeDialog.title')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            {t('library.removeDialog.moderationMessage', {
              name: selectedCrop ? getCropTitle(selectedCrop, t, language) : '',
            })}
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel id="public-crop-removal-reason-label">
              {t('library.removeDialog.reasonLabel')}
            </InputLabel>
            <Select
              labelId="public-crop-removal-reason-label"
              value={removeReason}
              label={t('library.removeDialog.reasonLabel')}
              onChange={(event) => setRemoveReason(event.target.value as PublicCropRemovalReason)}
            >
              {([
                'accidental_publication',
                'test_data',
                'duplicate',
                'wrong_mapping',
                'unlawful_content',
                'other',
              ] as PublicCropRemovalReason[]).map((reason) => (
                <MenuItem key={reason} value={reason}>
                  {t(`library.removeReasons.${reason}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
          <Button variant="outlined" onClick={closeRemoveDialog} disabled={removing}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!removeReason || removing}
            onClick={() => void handleConfirmRemove()}
          >
            {removing ? t('library.moderation.saving') : t('library.removeAction')}
          </Button>
        </DialogActions>
      </Dialog>
      <ImportConflictDialog
        open={importConflict !== null}
        cropName={importConflict?.name ?? ''}
        busy={importingId !== null}
        t={t}
        onCancel={closeImportConflictDialog}
        onUpdate={handleImportConflictUpdate}
        onImportAsNew={handleImportConflictNew}
        varietyChange={importConflict?.varietyChange ?? null}
      />
    </PageContainer>
  );
}
