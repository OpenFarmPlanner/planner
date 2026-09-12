import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Link, TextField, Typography, useMediaQuery } from '@mui/material';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import FieldsBedsHierarchy from './FieldsBedsHierarchy';
import GraphicalFields from './GraphicalFields';
import { AddBedIcon } from '../components/hierarchy/AddBedIcon';
import { HierarchyAddIcon } from '../components/hierarchy/HierarchyAddIcon';
import { useCommandContextTag, useRegisterCommands, useRegisterCreateActions } from '../commands/useCommandContext';
import type { CommandSpec } from '../commands/types';
import { useTranslation } from '../i18n';
import PageContainer from '../components/layout/PageContainer';
import { locationAPI } from '../api/api';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import { useTopbarContextActions } from '../hooks/useTopbarContextActions';
import { useTopbarTitleActions } from '../hooks/useTopbarTitleActions';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import EmptyStateCard, { type EmptyStateAction } from '../components/project/EmptyStateCard';
import { getProjectSetupAction } from './requirementFlow';
import type { RootLayoutOutletContext, TopbarContextAction } from '../navigation/topbarTypes';
import { type SxProps, type Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import { useHierarchyData } from '../components/hierarchy/hooks/useHierarchyData';
import { hasPersistedEntityId } from '../components/hierarchy/utils/hierarchyUtils';
import { keywordList } from '../commands/keywordList';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';

const VIEW_MODE_STORAGE_KEY = 'fieldsBedsViewMode';
const ADD_PARCEL_ACTION = 'add-parcel';
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
  const { t } = useTranslation(['fields', 'hierarchy', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'graphical' ? 'graphical' : 'table';
  });
  // A `?highlight=` deep link (e.g. "Beet/Parzelle/Standort öffnen" from the
  // Gantt calendar) only has scroll-to/flash support in the table view
  // (FieldsBedsHierarchy). Force that view for the rest of this page visit
  // when we arrive with the param, without touching/persisting the user's
  // actual `viewMode` preference. Captured once at mount (not derived from
  // the live URL) because FieldsBedsHierarchy strips the param right after
  // starting the highlight/flash — deriving this live would flip back to
  // the user's real (possibly graphical) view mid-flash and unmount it.
  const [forceTableViewForDeepLink] = useState(
    () => new URLSearchParams(window.location.search).has('highlight'),
  );
  const effectiveViewMode: ViewMode = forceTableViewForDeepLink ? 'table' : viewMode;
  const [globalActionError, setGlobalActionError] = useState<string>('');
  const [globalActionSuccess, setGlobalActionSuccess] = useState<string>('');
  const [createFieldRequest, setCreateFieldRequest] = useState(0);
  const [pendingHierarchyDeletionCount, setPendingHierarchyDeletionCount] = useState(0);
  const [addLocationDialogOpen, setAddLocationDialogOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const isTouchDevice = useMediaQuery('(pointer: coarse)');
  const { shouldShowProjectRequiredState, missingProjectReason } = useProjectRequirement();
  const hierarchyData = useHierarchyData(!shouldShowProjectRequiredState);
  const {
    loading: isAreaDataLoading,
    hasLoaded: hasAreaDataLoaded,
    locations,
    setLocations,
    fields,
    beds,
  } = hierarchyData;

  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const setTopbarContextActions = outletContext?.setTopbarContextActions;
  const setTopbarTitleActions = outletContext?.setTopbarTitleActions;

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
      isEnabled: () => viewMode !== 'table',
      action: () => {
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
      isEnabled: () => viewMode !== 'graphical',
      action: () => {
        setViewMode('graphical');
      },
    },
  ], [t, viewMode]);

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
  const hasHierarchyRows = locations.length > 1 || fields.length > 0 || beds.length > 0;
  const effectivePendingHierarchyDeletionCount = shouldShowProjectRequiredState
    ? 0
    : pendingHierarchyDeletionCount;
  const shouldShowAreasEmptyState = hasAreaDataLoaded && !isAreaDataLoading && !hasLocations;
  const shouldShowMissingFieldsState = hasLocations && !hasFields && !hasUnsavedFields && createFieldRequest <= 0;
  const shouldShowMissingBedsHint = hasFields && !hasBeds && !hasUnsavedBeds;
  const shouldRenderHierarchy = hasHierarchyRows || createFieldRequest > 0 || effectivePendingHierarchyDeletionCount > 0;
  const createBedAction = getProjectSetupAction('beds');
  const emptyAreasDescription = shouldShowMissingFieldsState
    ? (locations.length === 1
      ? t('hierarchy:emptyAreas.missingFieldSingleLocationDescription')
      : (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
            {t('hierarchy:emptyAreas.missingFieldMultipleLocationsBeforeIcon')}
            <HierarchyAddIcon interactive={false} ariaHidden sx={{ bgcolor: 'transparent' }} />
            {t('hierarchy:emptyAreas.missingFieldMultipleLocationsAfterIcon')}
          </Box>
        ))
    : t('hierarchy:emptyAreas.missingLocationDescription');
  const emptyAreasSupplement = shouldShowMissingFieldsState && isSingleLocationMode
    ? (
        <Typography variant="body2" color="text.secondary">
          {t('hierarchy:emptyAreas.additionalLocationHint')}{' '}
          <Link
            href="#add-location"
            onClick={(event) => {
              event.preventDefault();
              openAddLocationDialog();
            }}
            underline="hover"
          >
            {t('hierarchy:emptyAreas.additionalLocationLink')}
          </Link>
          .
        </Typography>
      )
    : undefined;
  const emptyAreaActions = useMemo<EmptyStateAction[]>(() => {
    if (shouldShowMissingFieldsState) {
      return locations.length === 1
        ? [{
            label: t('hierarchy:actions.addField'),
            onClick: requestInlineFieldCreation,
            icon: <HierarchyAddIcon interactive={false} ariaHidden sx={{ bgcolor: 'transparent' }} />,
          }]
        : [];
    }
    return [{ label: t('hierarchy:actions.createLocation'), onClick: openAddLocationDialog, icon: <AddIcon fontSize="small" /> }];
  }, [locations.length, openAddLocationDialog, requestInlineFieldCreation, shouldShowMissingFieldsState, t]);

  const viewModeActions = useMemo<TopbarContextAction[]>(() => ([
    {
      id: 'fields-view-mode-list',
      label: t('fields:representation.table'),
      onClick: () => setViewMode('table'),
      active: viewMode === 'table',
      groupId: 'fields-view-mode',
    },
    {
      id: 'fields-view-mode-graphical',
      label: t('fields:representation.graphical'),
      onClick: () => setViewMode('graphical'),
      active: viewMode === 'graphical',
      groupId: 'fields-view-mode',
    },
  ]), [t, viewMode]);

  const contextActions = useMemo<TopbarContextAction[]>(() => {
    const globalActions: TopbarContextAction[] = shouldShowProjectRequiredState
      ? []
      : [
        ...(canUseGlobalAddField ? [{
          id: 'fields-global-add-field',
          label: t('hierarchy:actions.addFieldDropdown'),
          onClick: requestInlineFieldCreation,
          ariaLabel: t('hierarchy:actions.addFieldDropdown'),
          menuActions: [
            {
              id: 'fields-global-add-location-menu-item',
              label: t('hierarchy:actions.createLocation'),
              onClick: openAddLocationDialog,
            },
          ],
        }] : []),
        {
          id: 'fields-global-add-location',
          label: t('hierarchy:actions.createLocation'),
          onClick: openAddLocationDialog,
          ariaLabel: t('hierarchy:actions.createLocation'),
          hidden: isSingleLocationMode,
          menuActions: [
            {
              id: 'fields-global-add-location-menu-add-field',
              label: t('hierarchy:actions.addFieldDropdown'),
              onClick: requestInlineFieldCreation,
            },
          ],
        },
      ];
    return globalActions;
  }, [
    canUseGlobalAddField,
    requestInlineFieldCreation,
    openAddLocationDialog,
    shouldShowProjectRequiredState,
    isSingleLocationMode,
    t,
  ]);

  useTopbarContextActions(setTopbarContextActions, contextActions);
  useTopbarTitleActions(setTopbarTitleActions, viewModeActions);

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
    <>
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
        {shouldShowProjectRequiredState && missingProjectReason ? (
          <ProjectRequiredState reason={missingProjectReason} />
        ) : null}
        {!shouldShowProjectRequiredState && isAreaDataLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : null}
        {!shouldShowProjectRequiredState && !isAreaDataLoading && shouldShowMissingBedsHint ? (
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
        {!shouldShowProjectRequiredState && !isAreaDataLoading && (shouldShowAreasEmptyState || shouldShowMissingFieldsState) ? (
          <EmptyStateCard
            title={shouldShowMissingFieldsState ? t('hierarchy:emptyAreas.missingFieldTitle') : t('hierarchy:emptyAreas.missingLocationTitle')}
            description={emptyAreasDescription}
            actions={emptyAreaActions}
            supplement={emptyAreasSupplement}
            containerSx={CONTENT_ALIGNED_EMPTY_STATE_SX}
          />
        ) : null}
      </PageContainer>

      <PageContainer variant={effectiveViewMode === 'graphical' ? 'full' : 'standard'}>
        {!shouldShowProjectRequiredState && !isAreaDataLoading && shouldRenderHierarchy && effectiveViewMode === 'graphical' ? (
          <GraphicalFields
            showTitle={false}
            showModeToggle={false}
            hierarchyData={hierarchyData}
          />
        ) : null}
        {!shouldShowProjectRequiredState && !isAreaDataLoading && shouldRenderHierarchy && effectiveViewMode !== 'graphical' ? (
          <FieldsBedsHierarchy
            showTitle={false}
            createFieldRequest={createFieldRequest}
            onCreateFieldRequestHandled={() => setCreateFieldRequest(0)}
            hierarchyData={hierarchyData}
            onPendingDeletionCountChange={setPendingHierarchyDeletionCount}
            suppressContextMenuHint={shouldShowMissingBedsHint}
          />
        ) : null}
      </PageContainer>
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
            <DisabledActionTooltip title={t('common:disabledReasons.requiredFields')}>
              <Button type="submit" variant="contained" color="success" disabled={!newLocationName.trim()}>
                {t('hierarchy:dialogs.addAdditionalLocation.submit')}
              </Button>
            </DisabledActionTooltip>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
}
