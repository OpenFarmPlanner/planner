import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, useMediaQuery } from '@mui/material';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import FieldsBedsHierarchy from './FieldsBedsHierarchy';
import FieldsBedsHierarchyMobile from './FieldsBedsHierarchyMobile';
import GraphicalFields from './GraphicalFields';
import { GraphicalSpacingControl } from './GraphicalSpacingControl';
import { GraphicalWorkspaceAction } from './GraphicalWorkspaceAction';
import { GraphicalDisplayControls } from './GraphicalDisplayControls';
import {
  GRAPHICAL_DISPLAY_MODES, getCropReference, type CropDateSelection, type GraphicalDisplayMode,
} from './graphicalCultivation';
import { AddBedIcon } from '../components/hierarchy/AddBedIcon';
import { HierarchyAddIcon } from '../components/hierarchy/HierarchyAddIcon';
import { useCommandContextTag, useRegisterCommands, useRegisterCreateActions } from '../commands/useCommandContext';
import type { CommandSpec } from '../commands/types';
import { useTranslation } from '../i18n';
import PageContainer from '../components/layout/PageContainer';
import { locationAPI } from '../api/api';
import type { LocationPathSpacing } from '../api/types';
import { useParcelRotationGroups } from '../components/hierarchy/rotation/useParcelRotationGroups';
import { getEntityDetailPath, type HierarchyEntityType } from '../components/hierarchy/details/hierarchyDetailRoutes';
import { ParcelRotationContext } from '../components/hierarchy/rotation/parcelRotationContext';
import { getLocationPathSpacing } from '../components/hierarchy/utils/locationPathSpacing';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import { useTopbarContextActions } from '../hooks/useTopbarContextActions';
import { useTopbarTitleActions } from '../hooks/useTopbarTitleActions';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import EmptyStateCard, { type EmptyStateAction } from '../components/project/EmptyStateCard';
import { getProjectSetupAction } from './requirementFlow';
import type { RootLayoutOutletContext, TopbarContextAction } from '../navigation/topbarTypes';
import { type SxProps, type Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useHierarchyData } from '../components/hierarchy/hooks/useHierarchyData';
import { useIsMobileHierarchyLayout } from '../components/hierarchy/hooks/useIsMobileHierarchyLayout';
import { hasPersistedEntityId } from '../components/hierarchy/utils/hierarchyUtils';
import { keywordList } from '../commands/keywordList';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTopbarWorkspaceControls } from '../hooks/useTopbarWorkspaceControls';
import type { GraphicalCameraState } from './graphicalFieldsGeometry';
import { TruncatedTextWithTooltip } from '../components/TruncatedTextWithTooltip';

const VIEW_MODE_STORAGE_KEY = 'fieldsBedsViewMode';
const ADD_PARCEL_ACTION = 'add-parcel';

function savedDisplayMode(key: string): GraphicalDisplayMode {
  try {
    const value = localStorage.getItem(key);
    return GRAPHICAL_DISPLAY_MODES.find(mode => mode === value) ?? 'cropsAndTasks';
  } catch {
    return 'cropsAndTasks';
  }
}

const CONTENT_ALIGNED_EMPTY_STATE_SX: SxProps<Theme> = {
  maxWidth: 560,
  my: { xs: 3, md: 5 },
  p: { xs: 2.5, sm: 3 },
  textAlign: 'center',
  '& > .MuiBox-root:first-of-type': {
    justifyContent: 'center',
  },
  '& > .MuiBox-root:last-of-type': {
    justifyContent: 'center',
  },
};

type ViewMode = 'table' | 'graphical';

export default function FieldsBedsPage() {
  const { activeProjectId } = useProjectRequirement();
  return <FieldsBedsWorkspace key={activeProjectId ?? 'no-project'} projectId={activeProjectId} />;
}

function FieldsBedsWorkspace({ projectId }: { projectId: number | null }) {
  const { t } = useTranslation(['fields', 'hierarchy', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const requestedIndividualPlan = Number(query.get('individualPlan')) || undefined;
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return requestedIndividualPlan || stored === 'graphical' ? 'graphical' : 'table';
  });
  // A `?highlight=` deep link (e.g. "Beet/Parzelle/Standort öffnen" from the
  // Gantt calendar) only has scroll-to/flash support in the table view
  // (FieldsBedsHierarchy). Keep the list visible until the user explicitly
  // changes view. The hierarchy removes the parameter as the highlight starts.
  const [forceTableViewForDeepLink, setForceTableViewForDeepLink] = useState(
    () => new URLSearchParams(window.location.search).has('highlight'),
  );
  const effectiveViewMode: ViewMode = forceTableViewForDeepLink ? 'table' : viewMode;
  const showGraphicalView = useCallback(() => {
    setForceTableViewForDeepLink(false);
    setViewMode('graphical');
  }, []);
  const [globalActionError, setGlobalActionError] = useState<string>('');
  const [globalActionSuccess, setGlobalActionSuccess] = useState<string>('');
  const [createFieldRequest, setCreateFieldRequest] = useState(0);
  const [pendingHierarchyDeletionCount, setPendingHierarchyDeletionCount] = useState(0);
  const [addLocationDialogOpen, setAddLocationDialogOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const isTouchDevice = useMediaQuery('(pointer: coarse)');
  // Below `sm`, or in short-viewport phone landscape, the hierarchy grid is
  // replaced by a touch-friendly indented list + bottom sheet (see
  // docs/datagrid-architecture.md, "Mobile layout (< sm)"); the DataGrid in
  // FieldsBedsHierarchy is never mounted there.
  const isMobileHierarchyLayout = useIsMobileHierarchyLayout();
  const { shouldShowProjectRequiredState, missingProjectReason, userId, activeProjectMembership } = useProjectRequirement();
  const defaultBedLength = activeProjectMembership?.project_default_bed_length_m;
  const defaultBedWidth = activeProjectMembership?.project_default_bed_width_m;
  const bedDefaults = useMemo(() => ({
    length_m: defaultBedLength,
    width_m: defaultBedWidth,
  }), [defaultBedLength, defaultBedWidth]);
  const hierarchyData = useHierarchyData(!shouldShowProjectRequiredState);
  const {
    loading: isAreaDataLoading,
    hasLoaded: hasAreaDataLoaded,
    error: areaDataError,
    locations,
    setLocations,
    fields,
    beds,
  } = hierarchyData;
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const activeSeason = outletContext?.activeSeason ?? undefined;
  const preferenceKey = `growingAreas.graphic.displayMode:user:${userId ?? 'guest'}`;
  const [displayPreference, setDisplayPreference] = useState(() => ({
    key: preferenceKey, mode: savedDisplayMode(preferenceKey),
  }));
  const displayMode = displayPreference.key === preferenceKey ? displayPreference.mode : savedDisplayMode(preferenceKey);
  const setDisplayMode = useCallback((mode: GraphicalDisplayMode) => {
    setDisplayPreference({ key: preferenceKey, mode });
    try { localStorage.setItem(preferenceKey, mode); } catch { /* Storage may be disabled. */ }
  }, [preferenceKey]);
  const [cropDate, setCropDate] = useState<CropDateSelection | null>(null);
  const cropReference = useMemo(() => activeSeason ? getCropReference(cropDate, activeSeason) : undefined,
    [activeSeason, cropDate]);
  const [graphicFullscreen, setGraphicFullscreen] = useState(false);
  const [displayLegendAnchor, setDisplayLegendAnchor] = useState<HTMLButtonElement | null>(null);
  const displayControls = useMemo(() => <GraphicalDisplayControls mode={displayMode} onMode={setDisplayMode}
    season={activeSeason} reference={cropReference} onDate={setCropDate} onOpenLegend={setDisplayLegendAnchor} />,
  [activeSeason, cropReference, displayMode, setDisplayMode]);
  const reloadActiveSeason = outletContext?.reloadActiveSeason;
  const rotation = useParcelRotationGroups({
    enabled: projectId != null, fields, beds, onChanged: () => { void reloadActiveSeason?.(); },
  });
  const {
    memberships: rotationMemberships, status: rotationStatus, open: openRotationGroups, dialog: rotationDialog,
  } = rotation;
  const rotationControls = useMemo(() => ({
    memberships: rotationMemberships,
    status: rotationStatus,
    manage: activeProjectMembership ? () => openRotationGroups() : undefined,
  }), [activeProjectMembership, openRotationGroups, rotationMemberships, rotationStatus]);
  const setTopbarContextActions = outletContext?.setTopbarContextActions;
  const setTopbarTitleActions = outletContext?.setTopbarTitleActions;
  const [locationSelection, setLocationSelection] = useState(() => {
    let id: number | null = requestedIndividualPlan ? Number(query.get('locationId')) || null : null;
    try { const stored = Number(sessionStorage.getItem(`graphicalLocation.${projectId}`)); id ??= stored > 0 ? stored : null; }
    catch { /* Storage may be disabled. */ }
    return { locations, id };
  });
  const cameraKey = `graphicalCamera.${projectId}`;
  const [cameraState, setCameraState] = useState<GraphicalCameraState>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(cameraKey) ?? 'null') as GraphicalCameraState | null;
      if (stored?.viewports && stored.rotations) return stored;
    } catch { /* Storage may be disabled. */ }
    return { viewports: {}, rotations: {} };
  });
  const openGraphicalDetails = (type: HierarchyEntityType, id: number): void => {
    try { sessionStorage.setItem(cameraKey, JSON.stringify(cameraState)); } catch { /* Storage may be disabled. */ }
    void navigate(getEntityDetailPath(type, id), { state: { fromGrowingAreaGraphic: true } });
  };
  const [isEditingGraphic, setIsEditingGraphic] = useState(false);
  const graphicalLocations = useMemo(() => locations.filter(item => typeof item.id === 'number' && item.id > 0), [locations]);
  const selectedLocation = graphicalLocations.find(item => item.id === locationSelection.id) ?? graphicalLocations[0];
  // Retain the actual selected ID when new/renamed/removed locations change order.
  if (locationSelection.locations !== locations) {
    setLocationSelection({ locations, id: selectedLocation?.id ?? null });
    if (locationSelection.id !== selectedLocation?.id) setIsEditingGraphic(false);
  }
  const selectLocation = useCallback((id: number) => {
    setLocationSelection(current => ({ ...current, id }));
    setIsEditingGraphic(false);
    try { sessionStorage.setItem(`graphicalLocation.${projectId}`, String(id)); } catch { /* Storage may be disabled. */ }
  }, [projectId]);
  const saveLocationPathSpacing = useCallback(async (id: number, spacing: LocationPathSpacing): Promise<void> => {
    const { data } = await locationAPI.updatePathSpacing(id, spacing);
    setLocations(current => current.map(item => item.id === id
      ? { ...item, ...getLocationPathSpacing(data) }
      : item));
  }, [setLocations]);


  useCommandContextTag('areas');

  const commands = useMemo<CommandSpec[]>(() => [
    {
      id: 'areas.showListView',
      label: t('fields:commands.showList'),
      group: 'navigation',
      keywords: keywordList(t, 'fields:commands.keywords.showList'),
      shortcutHint: 'L',
      keys: { key: 'l' },
      contextTags: ['areas'],
      isEnabled: () => effectiveViewMode !== 'table',
      action: () => {
        setIsEditingGraphic(false);
        setViewMode('table');
      },
    },
    {
      id: 'areas.showGraphicalView',
      label: t('fields:commands.showGraphical'),
      group: 'navigation',
      keywords: keywordList(t, 'fields:commands.keywords.showGraphical'),
      shortcutHint: 'G',
      keys: { key: 'g' },
      contextTags: ['areas'],
      isEnabled: () => effectiveViewMode !== 'graphical',
      action: showGraphicalView,
    },
  ], [t, effectiveViewMode, showGraphicalView]);

  useRegisterCommands('areas-view-switch', commands);

  const hasAddFieldTarget = locations.some((item) => item.id !== undefined);
  const isSingleLocationMode = locations.length === 1 && locations[0]?.id !== undefined;
  const canUseGlobalAddField = isSingleLocationMode;
  const hasActiveFieldDraft = fields.some((field) => !hasPersistedEntityId(field.id));

  const requestInlineFieldCreation = useCallback((): void => {
    if (!hasAddFieldTarget) {
      setGlobalActionError(t('hierarchy:messages.createLocationError'));
      return;
    }

    setViewMode('table');
    if (hasActiveFieldDraft || createFieldRequest > 0) {
      return;
    }
    setCreateFieldRequest((currentRequest) => currentRequest + 1);
  }, [createFieldRequest, hasActiveFieldDraft, hasAddFieldTarget, t]);

  const openAddLocationDialog = useCallback((): void => {
    setNewLocationName('');
    setAddLocationDialogOpen(true);
  }, []);

  const handleCreateAdditionalLocation = useCallback(async (): Promise<void> => {
    const trimmedName = newLocationName.trim();
    if (!trimmedName) {
      return;
    }
    try {
      const wasSingleLocationMode = locations.length === 1;
      const response = await locationAPI.create({ name: trimmedName });
      // Prepend locally (like new fields/beds) instead of a full reload —
      // a reload would immediately re-sort the table to the current sort
      // order, which can push the new location far from the "Standort
      // hinzufügen" action that just created it. It stays in this
      // insertion position (first in the list) until an explicit sort or
      // an actual reload, same as inline row creation elsewhere in the
      // hierarchy.
      setLocations((previousLocations) => [response.data, ...previousLocations]);
      setAddLocationDialogOpen(false);
      setNewLocationName('');
      setGlobalActionError('');
      setGlobalActionSuccess(wasSingleLocationMode
        ? t('hierarchy:messages.locationsNowVisible')
        : t('hierarchy:messages.locationCreated'));
    } catch (error) {
      console.error('Error creating additional location:', error);
      setGlobalActionError(t('hierarchy:messages.createLocationError'));
    }
  }, [locations.length, newLocationName, setLocations, t]);

  const handleAdditionalLocationSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!newLocationName.trim()) {
      return;
    }
    void handleCreateAdditionalLocation();
  };

  useEffect(() => {
    if (!location.pathname.startsWith('/app/fields-beds')) {
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    const shouldAddParcel =
      searchParams.get('action') === ADD_PARCEL_ACTION ||
      searchParams.get('create') === 'true';
    if (!shouldAddParcel) {
      return;
    }

    if (shouldShowProjectRequiredState || !hasAreaDataLoaded || isAreaDataLoading) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      requestInlineFieldCreation();

      searchParams.delete('action');
      searchParams.delete('create');
      const nextSearch = searchParams.toString();
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: true },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    hasAreaDataLoaded,
    isAreaDataLoading,
    location.pathname,
    location.search,
    navigate,
    requestInlineFieldCreation,
    shouldShowProjectRequiredState,
  ]);


  useEffect(() => {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const hasLocations = locations.length > 0;
  const persistedFieldIds = useMemo(
    () => new Set(fields.map((field) => field.id).filter(hasPersistedEntityId)),
    [fields],
  );
  const hasFields = persistedFieldIds.size > 0;
  const hasUnsavedFields = fields.some((field) => !hasPersistedEntityId(field.id));
  const hasUnsavedBeds = beds.some((bed) => !hasPersistedEntityId(bed.id));
  const hasBeds = beds.some((bed) => hasPersistedEntityId(bed.id) && persistedFieldIds.has(bed.field));
  // Every location has a row, even the only one without plots: its add
  // action is how plots are added.
  const hasHierarchyRows = locations.length > 0 || fields.length > 0 || beds.length > 0;
  const effectivePendingHierarchyDeletionCount = shouldShowProjectRequiredState
    ? 0
    : pendingHierarchyDeletionCount;
  const shouldShowAreasEmptyState = hasAreaDataLoaded && !isAreaDataLoading && !areaDataError && !hasLocations;
  const hasSelectedGraphicalFields = fields.some(field => field.location === selectedLocation?.id && hasPersistedEntityId(field.id));
  const shouldShowMissingFieldsState = hasLocations
    && (effectiveViewMode === 'graphical' ? !hasSelectedGraphicalFields : !hasFields)
    && !hasUnsavedFields && createFieldRequest <= 0;
  const showEmptyGraphicalLocation = shouldShowMissingFieldsState && effectiveViewMode === 'graphical'
    && Boolean(selectedLocation);
  const shouldShowMissingBedsHint = hasFields && !hasBeds && !hasUnsavedBeds;
  const shouldRenderHierarchy = hasHierarchyRows || createFieldRequest > 0 || effectivePendingHierarchyDeletionCount > 0;
  const createBedAction = getProjectSetupAction('beds');
  const emptyAreasDescription = shouldShowMissingFieldsState
    ? (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
          {t('hierarchy:emptyAreas.missingFieldMultipleLocationsBeforeIcon')}
          <HierarchyAddIcon interactive={false} ariaHidden sx={{ bgcolor: 'transparent' }} />
          {t('hierarchy:emptyAreas.missingFieldMultipleLocationsAfterIcon')}
        </Box>
      )
    : t('hierarchy:emptyAreas.missingLocationDescription');
  // Plots are added from the location row's add action, so the card only
  // points there; it offers a button only while no location exists.
  const emptyAreaActions = useMemo<EmptyStateAction[]>(() => (
    shouldShowMissingFieldsState
      ? []
      : [{ label: t('hierarchy:actions.createLocation'), onClick: openAddLocationDialog, icon: <AddIcon fontSize="small" /> }]
  ), [openAddLocationDialog, shouldShowMissingFieldsState, t]);

  const viewModeActions = useMemo<TopbarContextAction[]>(() => ([
    {
      id: 'fields-view-mode-list',
      label: t('fields:representation.table'),
      onClick: () => { setIsEditingGraphic(false); setViewMode('table'); },
      active: effectiveViewMode === 'table',
      groupId: 'fields-view-mode',
    },
    {
      id: 'fields-view-mode-graphical',
      label: t('fields:representation.graphical'),
      onClick: showGraphicalView,
      active: effectiveViewMode === 'graphical',
      groupId: 'fields-view-mode',
    },
  ]), [effectiveViewMode, showGraphicalView, t]);

  const contextActions = useMemo<TopbarContextAction[]>(() => (
    shouldShowProjectRequiredState
      ? []
      : [
        // Plots are added from their location's row, so the topbar only
        // adds locations.
        {
          id: 'fields-global-add-location',
          label: t('hierarchy:actions.createLocation'),
          onClick: openAddLocationDialog,
          ariaLabel: t('hierarchy:actions.createLocation'),
        },
      ]
  ), [openAddLocationDialog, shouldShowProjectRequiredState, t]);

  useTopbarContextActions(setTopbarContextActions, contextActions);
  useTopbarTitleActions(setTopbarTitleActions, viewModeActions);
  const workspaceControls = useMemo(() => !shouldShowProjectRequiredState ? (
    <>{effectiveViewMode === 'graphical' && selectedLocation ? <>
      {graphicalLocations.length > 1 ? (
        <TextField select label={t('fields:graphical.locationSelector')} value={selectedLocation.id}
          onChange={event => selectLocation(Number(event.target.value))}
          slotProps={{ select: { renderValue: () => <TruncatedTextWithTooltip text={selectedLocation.name} /> } }}
          sx={{ width: { xs: 220, sm: 180, md: 220 }, maxWidth: '100%', flexShrink: 0 }}>
          {graphicalLocations.map(item => (
            <MenuItem key={item.id} value={item.id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{item.name}</MenuItem>
          ))}
        </TextField>
      ) : (
        <Box sx={{ minWidth: 0, maxWidth: 260, typography: 'body2', fontWeight: 600 }}>
          <TruncatedTextWithTooltip text={t('fields:graphical.locationTitle', { name: selectedLocation.name })} focusable />
        </Box>
      )}
      {!graphicFullscreen && displayControls}
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, maxWidth: '100%' }}>
        <GraphicalWorkspaceAction
          label={t('fields:graphical.locationEditModeAction')}
          icon={<EditOutlinedIcon fontSize="small" />}
          help={t('fields:graphical.locationEditModeHelp')}
          disabled={!hasSelectedGraphicalFields}
          disabledReason={t('fields:graphical.noFields')}
          variant={isEditingGraphic ? 'contained' : 'outlined'}
          color="success"
          aria-pressed={isEditingGraphic}
          onClick={() => setIsEditingGraphic(value => !value)}
        />
        {activeProjectMembership ? (
          <GraphicalSpacingControl key={selectedLocation.id} location={selectedLocation} onSave={saveLocationPathSpacing} />
        ) : null}
      </Box>
    </> : null}
    </>
  ) : null, [activeProjectMembership, effectiveViewMode, isEditingGraphic, hasSelectedGraphicalFields,
    displayControls, graphicFullscreen, graphicalLocations, saveLocationPathSpacing, selectLocation, selectedLocation, shouldShowProjectRequiredState, t]);
  useTopbarWorkspaceControls(outletContext?.setTopbarWorkspaceControls, workspaceControls);


  const createActions = useMemo(() => {
    if (shouldShowProjectRequiredState) {
      return [];
    }
    if (canUseGlobalAddField) {
      return [
        {
          id: 'create-field',
          label: t('hierarchy:actions.addFieldDropdown'),
          shortcut: 'Alt+Shift+N',
          handler: requestInlineFieldCreation,
        },
      ];
    }
    return [
      {
        id: 'create-location',
        label: t('hierarchy:actions.createLocation'),
        shortcut: 'Alt+Shift+N',
        handler: openAddLocationDialog,
      },
    ];
  }, [
    canUseGlobalAddField,
    openAddLocationDialog,
    requestInlineFieldCreation,
    shouldShowProjectRequiredState,
    t,
  ]);

  useRegisterCreateActions('areas-page', createActions);

  return (
    <ParcelRotationContext.Provider value={rotationControls}>
      {/*
        Wrapped in one Box instead of leaving these as two separate
        PageContainer siblings: <main> (in App.tsx) lays its direct children
        out with a flex `gap`, which applied unconditionally between these
        two - even when the alerts/empty-state container below has nothing
        to show and renders as an empty, zero-height div. That left a bigger
        gap above the table here than pages with only one top-level
        container. Nesting them removes that outer gap; the alerts/hints
        keep their own mb spacing for when they do render something.
      */}
      <Box>
      <PageContainer variant="standard">
        {globalActionError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {globalActionError}
          </Alert>
        ) : null}
        {globalActionSuccess ? (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setGlobalActionSuccess('')}>
            {globalActionSuccess}
          </Alert>
        ) : null}
        {!shouldShowProjectRequiredState && areaDataError ? (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={<LoadRetryButton disabled={isAreaDataLoading} onClick={() => void hierarchyData.fetchData()} />}
          >
            {areaDataError}
          </Alert>
        ) : null}
        {shouldShowProjectRequiredState && missingProjectReason ? (
          <ProjectRequiredState reason={missingProjectReason} />
        ) : null}
        {!shouldShowProjectRequiredState && isAreaDataLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : null}
        {!shouldShowProjectRequiredState && !isAreaDataLoading && shouldShowMissingBedsHint && effectiveViewMode !== 'graphical' ? (
          <EmptyStateCard
            title={t('hierarchy:messages.noBedsHintTitle')}
            description={(
              isTouchDevice ? t('hierarchy:messages.noBedsHintMobile') : (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {t('hierarchy:messages.noBedsHintBeforeIcon')}
                  <AddBedIcon interactive={false} ariaHidden />
                  {t('hierarchy:messages.noBedsHintAfterIcon')}
                </Box>
              )
            )}
            actions={[{ label: t(createBedAction.labelKey), to: createBedAction.to }]}
            containerSx={CONTENT_ALIGNED_EMPTY_STATE_SX}
          />
        ) : null}
        {!shouldShowProjectRequiredState && !isAreaDataLoading && showEmptyGraphicalLocation ? (
          <Alert severity="info" sx={{ mb: 1 }}>{t('fields:graphical.noFields')}</Alert>
        ) : null}
        {!shouldShowProjectRequiredState && !isAreaDataLoading
          && (shouldShowAreasEmptyState || (shouldShowMissingFieldsState && !showEmptyGraphicalLocation)) ? (
          <EmptyStateCard
            title={shouldShowMissingFieldsState ? t('hierarchy:emptyAreas.missingFieldTitle') : t('hierarchy:emptyAreas.missingLocationTitle')}
            description={effectiveViewMode === 'graphical' && hasLocations ? t('fields:graphical.noFields') : emptyAreasDescription}
            actions={effectiveViewMode === 'graphical' && hasLocations
              ? [{ label: t('fields:representation.table'), onClick: () => setViewMode('table') }] : emptyAreaActions}
            containerSx={CONTENT_ALIGNED_EMPTY_STATE_SX}
          />
        ) : null}
      </PageContainer>

      <Box>
        {!shouldShowProjectRequiredState && !isAreaDataLoading && shouldRenderHierarchy
          && selectedLocation && effectiveViewMode === 'graphical' ? (
          <GraphicalFields
            selectedLocationId={selectedLocation?.id}
            cameraState={cameraState}
            onCameraStateChange={setCameraState}
            interactionMode={isEditingGraphic ? 'edit' : 'view'}
            onInteractionModeChange={mode => setIsEditingGraphic(mode === 'edit')}
            showTitle={false}
            showModeToggle={false}
            activeSeasonId={activeSeason?.id}
            individualSeason={activeSeason}
            displayMode={displayMode}
            cropReference={cropReference}
            fullscreenDisplayControls={displayControls}
            onFullscreenChange={setGraphicFullscreen}
            displayLegendAnchor={displayLegendAnchor}
            closeDisplayLegend={() => setDisplayLegendAnchor(null)}
            canEditIndividualPlants={Boolean(activeProjectMembership)}
            requestedIndividualPlan={requestedIndividualPlan}
            onOpenBed={id => navigate(getEntityDetailPath('bed', id))}
            onOpenDetails={openGraphicalDetails}
            canCompleteTasks={Boolean(activeProjectMembership)}
            hierarchyData={hierarchyData}
          />
        ) : null}
        {!shouldShowProjectRequiredState && !isAreaDataLoading && shouldRenderHierarchy && effectiveViewMode !== 'graphical' ? (
          <PageContainer variant="standard">{isMobileHierarchyLayout ? (
            <FieldsBedsHierarchyMobile
              showTitle={false}
              createFieldRequest={createFieldRequest}
              onCreateFieldRequestHandled={() => setCreateFieldRequest(0)}
              hierarchyData={hierarchyData}
              onPendingDeletionCountChange={setPendingHierarchyDeletionCount}
              projectId={projectId}
              bedDefaults={bedDefaults}
              graphicalRotations={cameraState.rotations}
            />
          ) : (
            <FieldsBedsHierarchy
              showTitle={false}
              createFieldRequest={createFieldRequest}
              onCreateFieldRequestHandled={() => setCreateFieldRequest(0)}
              hierarchyData={hierarchyData}
              onPendingDeletionCountChange={setPendingHierarchyDeletionCount}
              suppressContextMenuHint={shouldShowMissingBedsHint}
              projectId={projectId}
              bedDefaults={bedDefaults}
              graphicalRotations={cameraState.rotations}
              userId={userId}
            />
          )}</PageContainer>
        ) : null}
      </Box>
      </Box>
      <Dialog open={addLocationDialogOpen} onClose={() => setAddLocationDialogOpen(false)} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={handleAdditionalLocationSubmit}>
          <DialogTitle>{t('hierarchy:dialogs.addAdditionalLocation.title')}</DialogTitle>
          <DialogContent>
            <Box sx={{ color: 'text.secondary', mb: 2, mt: 1 }}>
              {t('hierarchy:dialogs.addAdditionalLocation.description')}
            </Box>
            <TextField
              margin="dense"
              fullWidth
              label={t('hierarchy:dialogs.addAdditionalLocation.nameLabel')}
              value={newLocationName}
              onChange={(event) => setNewLocationName(event.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button type="button" onClick={() => setAddLocationDialogOpen(false)}>{t('common:actions.cancel')}</Button>
            <DisabledActionTooltip title={!newLocationName.trim() ? t('common:disabledReasons.requiredFields') : ''}>
              <Button type="submit" variant="contained" color="success" disabled={!newLocationName.trim()}>
                {t('hierarchy:dialogs.addAdditionalLocation.submit')}
              </Button>
            </DisabledActionTooltip>
          </DialogActions>
        </Box>
      </Dialog>
      {rotationDialog}
    </ParcelRotationContext.Provider>
  );
}
