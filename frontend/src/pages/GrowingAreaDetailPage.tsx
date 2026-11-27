import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useNavigationType, useOutletContext, useParams } from 'react-router';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  CircularProgress,
  Link,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';

import { useTranslation } from '../i18n';
import PageContainer from '../components/layout/PageContainer';
import { DetailGrid, DetailRow, DetailSection } from '../components/layout/DetailPrimitives';
import { DetailPageActions, type DetailPagePrimaryAction } from '../components/layout/DetailPageActions';
import {
  detailHeaderRowSx,
  detailHeaderTitleColumnSx,
  detailHeaderTitleTextSx,
} from '../components/layout/detailHeaderStyles';
import { RichTextViewer } from '../components/data-grid/RichTextViewer';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import EmptyStateCard from '../components/project/EmptyStateCard';
import LoadRetryButton from '../components/LoadRetryButton';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import { useNavigationBlocker } from '../hooks/autosave';
import { useHierarchyData } from '../components/hierarchy/hooks/useHierarchyData';
import { bedAPI, fieldAPI, locationAPI, plantingPlanAPI } from '../api/api';
import type { Bed, Field, Location, PlantingPlan } from '../api/types';
import { extractApiErrorMessage } from '../api/errors';
import { resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { GrowingAreaPlanLinks } from '../planting-plans/GrowingAreaPlanLinks';
import { GrowingAreaTaskSection } from '../components/tasks/GrowingAreaTaskSection';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';
import { parseDimensionValue } from '../components/hierarchy/utils/hierarchyAreaParsing';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { GrowingAreaCoverageRows } from './GrowingAreaCoverageRows';
import { getMeasuredArea } from './graphicalAreaGeometry';
import {
  DETAIL_ROUTE_SEGMENTS,
  growingAreaPlanTarget,
  planBelongsToGrowingArea,
  resolveGrowingAreaEntity,
  type ResolvedGrowingAreaEntity,
} from '../components/hierarchy/details/growingAreaEntity';
import {
  getEntityDetailPath,
  getGrowingAreaListPath,
  GROWING_AREAS_PATH,
  type HierarchyEntityType,
} from '../components/hierarchy/details/hierarchyDetailRoutes';
import { getGrowingAreaDetailOrigin, relatedGrowingAreaDetail } from '../components/hierarchy/details/growingAreaWorkspaceNavigation';
import {
  GrowingAreaDetailForm,
  type GrowingAreaDetailDraft,
} from '../components/hierarchy/details/GrowingAreaDetailForm';
import { isIndividualPlacement } from './individualPlantGeometry';
import { INHERITED_SITE_CONDITION_FIELDS } from '../components/hierarchy/utils/siteConditions';
import { ParcelRotationDetailSection } from '../components/hierarchy/rotation/ParcelRotationDetailSection';
import {
  getInheritedSourceLabel,
  getSiteConditionFieldHelp,
  getSiteConditionFieldLabel,
  getSiteConditionValueLabel,
} from '../components/hierarchy/siteConditionLabels';

const formatNumber = (value: number | null | undefined, locale: string): string | null => (
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(locale) : null
);

const knownArea = (area: Location | Field | Bed): number | null =>
  getMeasuredArea(area) ?? (Number(area.area_sqm) > 0 ? Number(area.area_sqm) : null);

const toDraft = (resolved: ResolvedGrowingAreaEntity): GrowingAreaDetailDraft => {
  const entity = resolved.entity as Location & Field & Bed;
  return {
    name: entity.name ?? '',
    length_m: entity.length_m == null ? '' : String(entity.length_m),
    width_m: entity.width_m == null ? '' : String(entity.width_m),
    light_condition: entity.light_condition ?? '',
    soil_moisture: entity.soil_moisture ?? '',
    irrigation: entity.irrigation ?? '',
    soil_type: entity.soil_type ?? '',
    soil_description: entity.soil_description ?? '',
    wind_exposure: entity.wind_exposure ?? '',
    water_supply: entity.water_supply ?? '',
    notes: entity.notes ?? '',
    description: entity.description ?? '',
    address: entity.address ?? '',
    exposure: entity.exposure ?? '',
    cultivation_environment: entity.cultivation_environment ?? '',
  };
};

const sameDraft = (a: GrowingAreaDetailDraft, b: GrowingAreaDetailDraft): boolean =>
  (Object.keys(a) as Array<keyof GrowingAreaDetailDraft>).every((key) => a[key] === b[key]);

export default function GrowingAreaDetailPage() {
  const { activeProjectId, shouldShowProjectRequiredState, missingProjectReason } = useProjectRequirement();
  const params = useParams();
  const type = DETAIL_ROUTE_SEGMENTS[params.entityType ?? ''];
  const id = Number(params.entityId);

  if (shouldShowProjectRequiredState && missingProjectReason) {
    return <PageContainer variant="standard" mobileInset><ProjectRequiredState reason={missingProjectReason} /></PageContainer>;
  }
  return (
    <GrowingAreaDetail
      key={`${activeProjectId ?? 'none'}:${type ?? ''}:${id}`}
      type={type}
      id={Number.isInteger(id) && id > 0 ? id : null}
    />
  );
}

function GrowingAreaDetail({ type, id }: { type: HierarchyEntityType | undefined; id: number | null }) {
  const { activeProjectId, activeProjectMembership } = useProjectRequirement();
  const { t, i18n } = useTranslation(['hierarchy', 'locations', 'common', 'fields']);
  const locale = resolveSeasonDateLocale(i18n);
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType === 'PUSH') window.scrollTo({ top: 0, behavior: 'instant' });
  }, [navigationType]);
  const origin = getGrowingAreaDetailOrigin(location.state, activeProjectId);
  const fromGraphic = origin ? origin.view === 'graphic' : location.state?.fromGrowingAreaGraphic === true;
  const relatedState = relatedGrowingAreaDetail(origin);
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const seasonId = outletContext?.activeSeason?.id;
  const reloadActiveSeason = outletContext?.reloadActiveSeason;
  const hierarchy = useHierarchyData(true);
  const { locations, fields, beds, setLocations, setFields, setBeds, loading, hasLoaded, error, fetchData } = hierarchy;
  const refreshHierarchy = useCallback(() => fetchData({ showLoading: false }), [fetchData]);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<GrowingAreaDetailDraft | null>(null);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const resolved = useMemo(
    () => (type && id !== null ? resolveGrowingAreaEntity(type, id, { locations, fields, beds }) : null),
    [beds, fields, id, locations, type],
  );

  const savedDraft = useMemo(() => (resolved ? toDraft(resolved) : null), [resolved]);
  const isDirty = Boolean(isEditing && draft && savedDraft && !sameDraft(draft, savedDraft));
  useNavigationBlocker(isDirty, t('hierarchy:details.unsavedChanges'));

  const startEditing = useCallback((): void => {
    if (!savedDraft) return;
    setDraft(savedDraft);
    setSaveError('');
    setIsEditing(true);
  }, [savedDraft]);

  const cancelEditing = useCallback((): void => {
    setIsEditing(false);
    setDraft(null);
    setSaveError('');
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (!resolved || !draft || !type || !activeProjectMembership) return;
    if (!draft.name.trim()) {
      setSaveError(t('hierarchy:validation.nameRequired'));
      return;
    }
    const lengthM = parseDimensionValue(draft.length_m);
    const widthM = parseDimensionValue(draft.width_m);
    if (lengthM === undefined || widthM === undefined) {
      setSaveError(t('hierarchy:validation.lengthNotANumber'));
      return;
    }
    const common = {
      name: draft.name.trim(),
      length_m: lengthM,
      width_m: widthM,
      light_condition: (draft.light_condition || null) as Location['light_condition'],
      soil_moisture: (draft.soil_moisture || null) as Location['soil_moisture'],
      irrigation: (draft.irrigation || null) as Location['irrigation'],
      soil_type: (draft.soil_type || null) as Location['soil_type'],
      soil_description: draft.soil_description,
      wind_exposure: draft.wind_exposure,
      water_supply: draft.water_supply,
      notes: draft.notes,
    };
    setIsSaving(true);
    setSaveError('');
    try {
      if (type === 'location') {
        const location = resolved.entity as Location;
        const response = await locationAPI.update(location.id!, {
          ...location,
          ...common,
          description: draft.description,
          address: draft.address,
          exposure: (draft.exposure || null) as Location['exposure'],
        });
        setLocations((previous) => previous.map((item) => (item.id === location.id ? response.data : item)));
      } else if (type === 'field') {
        const field = resolved.entity as Field;
        const response = await fieldAPI.update(field.id!, {
          ...field,
          ...common,
          cultivation_environment: (draft.cultivation_environment || null) as Field['cultivation_environment'],
        });
        setFields((previous) => previous.map((item) => (item.id === field.id ? response.data : item)));
      } else {
        const bed = resolved.entity as Bed;
        const response = await bedAPI.update(bed.id!, { ...bed, ...common });
        setBeds((previous) => previous.map((item) => (item.id === bed.id ? response.data : item)));
      }
      setIsEditing(false);
      setDraft(null);
    } catch (err) {
      setSaveError(extractApiErrorMessage(err, t, t('hierarchy:errors.save')));
    } finally {
      setIsSaving(false);
    }
  }, [activeProjectMembership, draft, resolved, setBeds, setFields, setLocations, t, type]);

  const backPath = !fromGraphic && resolved && type && id !== null ? getGrowingAreaListPath(type, id) : GROWING_AREAS_PATH;
  const backLabel = t(fromGraphic ? 'fields:graphical.objects.backToGraphic' : 'hierarchy:details.backToAreaList');
  const goBack = (): void => {
    if (origin) void navigate(-origin.steps);
    else void navigate(backPath);
  };

  if (!hasLoaded && loading) {
    return (
      <PageContainer variant="standard" mobileInset>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
      </PageContainer>
    );
  }
  if (error && !resolved) {
    return (
      <PageContainer variant="standard" mobileInset>
        <Alert severity="error" action={<LoadRetryButton disabled={loading} onClick={() => void hierarchy.fetchData()} />}>
          {error}
        </Alert>
      </PageContainer>
    );
  }
  if (!resolved || !type) {
    return (
      <PageContainer variant="standard" mobileInset>
        <EmptyStateCard
          title={t('hierarchy:details.notFound.title')}
          description={t('hierarchy:details.notFound.description')}
          actions={[{ label: t('hierarchy:details.backToList'), to: GROWING_AREAS_PATH }]}
        />
      </PageContainer>
    );
  }

  const primaryActions: DetailPagePrimaryAction[] = isEditing
    ? [
      { label: t('common:actions.cancel'), icon: <CloseIcon fontSize="small" />, onClick: cancelEditing, disabled: isSaving },
      {
        label: t('common:actions.save'),
        icon: <SaveIcon fontSize="small" />,
        onClick: () => { void save(); },
        disabled: isSaving || !isDirty,
        variant: 'contained',
      },
    ]
    : activeProjectMembership ? [{ label: t('common:actions.edit'), icon: <EditIcon fontSize="small" />, onClick: startEditing }] : [];

  return (
    <PageContainer variant="standard" mobileInset>
      <Stack spacing={2} data-testid="growing-area-detail">
        <Breadcrumbs aria-label={t('hierarchy:details.breadcrumbAria')} sx={{ overflowWrap: 'anywhere' }}>
          <Link component={RouterLink} to={backPath} underline="hover" color="inherit" onClick={event => {
            if (isSaving || (origin && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)) {
              event.preventDefault();
              if (!isSaving) goBack();
            }
          }}>
            {t('hierarchy:title')}
          </Link>
          {resolved.location && type !== 'location' ? (
            <Link component={RouterLink} to={getEntityDetailPath('location', resolved.location.id!)} state={relatedState}
              underline="hover" color="inherit">
              {resolved.location.name}
            </Link>
          ) : null}
          {resolved.field && type === 'bed' ? (
            <Link component={RouterLink} to={getEntityDetailPath('field', resolved.field.id!)} state={relatedState}
              underline="hover" color="inherit">
              {resolved.field.name}
            </Link>
          ) : null}
          <Typography color="text.primary" aria-current="page">{resolved.entity.name}</Typography>
        </Breadcrumbs>

        <Box>
          <Button variant="outlined" startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={goBack} disabled={isSaving} sx={{ minHeight: 44 }}>
            {backLabel}
          </Button>
        </Box>

        <Box sx={detailHeaderRowSx}>
          <Box sx={detailHeaderTitleColumnSx}>
            <Typography variant="overline" color="text.secondary" component="p">
              {t(`hierarchy:details.entityType.${type}`)}
            </Typography>
            <Typography variant="h4" component="h1" sx={detailHeaderTitleTextSx}>
              {resolved.entity.name}
            </Typography>
          </Box>
          <DetailPageActions primaryActions={primaryActions} />
        </Box>

        {saveError ? <Alert severity="error">{saveError}</Alert> : null}

        <Stack spacing={3}>
          {isEditing && draft ? (
            <GrowingAreaDetailForm
              type={type}
              draft={draft}
              onChange={setDraft}
              inherited={resolved.inherited}
              nameError={!draft.name.trim() ? t('hierarchy:validation.nameRequired') : undefined}
            />
          ) : (
            <GrowingAreaReadView resolved={resolved} locale={locale} refreshHierarchy={refreshHierarchy} beds={beds}
              relatedState={relatedState} />
          )}
          {!isEditing && type === 'field' && id !== null ? (
            <ParcelRotationDetailSection fieldId={id} fields={fields} beds={beds}
              canManage={Boolean(activeProjectMembership)} onChanged={() => { void reloadActiveSeason?.(); }} />
          ) : null}
          <GrowingAreaRelatedWork key={seasonId} area={resolved} projectId={activeProjectId} seasonId={seasonId}
            fields={fields} beds={beds} canComplete={Boolean(activeProjectMembership)} />
          {!isEditing && resolved.entity.notes?.trim() ? (
            <Box data-testid="detail-section-notes">
              <DetailSection title={t('common:fields.notes')}>
                <RichTextViewer value={resolved.entity.notes} />
              </DetailSection>
            </Box>
          ) : null}
        </Stack>
      </Stack>
    </PageContainer>
  );
}

function GrowingAreaRelatedWork({ area, projectId, seasonId, fields, beds, canComplete }: {
  area: ResolvedGrowingAreaEntity;
  projectId: number | null;
  seasonId?: number;
  fields: Field[];
  beds: Bed[];
  canComplete: boolean;
}) {
  const { t } = useTranslation(['hierarchy', 'plantingPlans', 'fields']);
  const [request, setRequest] = useState<{ status: 'loading' | 'ready' | 'error'; plans: PlantingPlan[] }>({
    status: 'loading',
    plans: [],
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    plantingPlanAPI.listAll(controller.signal)
      .then(({ results }) => {
        if (!controller.signal.aborted) setRequest({ status: 'ready', plans: results });
      })
      .catch(() => {
        if (!controller.signal.aborted) setRequest(previous => ({ ...previous, status: 'error' }));
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = () => {
    setRequest(previous => ({ ...previous, status: 'loading' }));
    setAttempt(previous => previous + 1);
  };
  const relatedPlans = useMemo(() => request.plans.filter(plan => planBelongsToGrowingArea(plan, area)), [request.plans, area]);
  const { directIndividuals, otherPlans } = useMemo(() => {
    const directIndividuals: PlantingPlan[] = [];
    const otherPlans: PlantingPlan[] = [];
    for (const plan of relatedPlans) {
      const target = growingAreaPlanTarget(plan);
      if (isIndividualPlacement(plan) && target?.kind === area.type && target.id === area.entity.id) directIndividuals.push(plan);
      else otherPlans.push(plan);
    }
    return { directIndividuals, otherPlans };
  }, [area.entity.id, area.type, relatedPlans]);
  const loading = request.status === 'loading';
  const failed = request.status === 'error';
  const showRetry = request.status === 'error' || (loading && attempt > 0);

  return (
    <>
      {(request.status !== 'ready' || otherPlans.length > 0) && (
        <Box data-testid="detail-section-plans">
          <DetailSection title={t('hierarchy:details.sections.plantingPlans')}>
            {showRetry ? (
              <Alert severity={loading ? 'info' : 'error'} role={loading ? 'status' : 'alert'}
                action={<LoadRetryButton disabled={loading} onClick={retry} />}>
                {loading ? t('plantingPlans:loadingPlans') : t('plantingPlans:errors.load')}
              </Alert>
            ) : loading ? <CircularProgress size={20} aria-label={t('plantingPlans:loadingPlans')} /> : null}
            {otherPlans.length > 0 && <GrowingAreaPlanLinks plans={otherPlans} showBed={area.type !== 'bed'}
              keepTableLinks showIndividualCounts />}
          </DetailSection>
        </Box>
      )}
      {directIndividuals.length > 0 && (
        <Box data-testid="detail-section-individual-plans">
          <DetailSection title={t('fields:individualPlants.title')}>
            <GrowingAreaPlanLinks plans={directIndividuals} showBed={false} keepTableLinks showIndividualCounts />
          </DetailSection>
        </Box>
      )}
      <GrowingAreaTaskSection area={area} projectId={projectId} seasonId={seasonId} fields={fields} beds={beds}
        plans={relatedPlans} plansLoading={loading} plansFailed={failed} retryPlans={retry} canComplete={canComplete} />
    </>
  );
}

function OptionalSection({ title, rows, testId, mobileColumns }: {
  title: string;
  rows: ReactNode[];
  testId: string;
  mobileColumns?: 1 | 2;
}) {
  const visible = rows.filter(Boolean);
  if (visible.length === 0) return null;
  return (
    <Box data-testid={testId}>
      <DetailSection title={title}>
        <DetailGrid mobileColumns={mobileColumns}>{visible}</DetailGrid>
      </DetailSection>
    </Box>
  );
}

function GrowingAreaReadView({
  resolved,
  locale,
  refreshHierarchy,
  beds,
  relatedState,
}: {
  resolved: ResolvedGrowingAreaEntity;
  locale: string;
  refreshHierarchy: () => Promise<void>;
  beds: Bed[];
  relatedState: ReturnType<typeof relatedGrowingAreaDetail>;
}) {
  const { t } = useTranslation(['hierarchy', 'locations', 'common']);
  const { type } = resolved;
  const entity = resolved.entity as Location & Field & Bed;
  const measuredArea = getMeasuredArea(entity);
  const area = type === 'location' ? measuredArea : knownArea(entity);
  const text = (key: string, label: string, value: string | null | undefined): ReactNode => (
    value && value.trim() ? <DetailRow key={key} label={label} value={value} testId={`detail-${key}`} /> : null
  );

  const bedsByField = new Map<number, number>();
  for (const bed of beds) {
    if (bed.id != null && resolved.bedIds.has(bed.id)) bedsByField.set(bed.field, (bedsByField.get(bed.field) ?? 0) + 1);
  }
  const count = (value: number) => formatLocalizedNumber(value, locale);
  const areaText = (value: number) => `${formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 })} ${t('common:units.squareMeters')}`;

  const conditionRows = INHERITED_SITE_CONDITION_FIELDS.map((field) => {
    const condition = resolved.effective[field];
    if (!condition.value) return null;
    return (
      <DetailRow
        key={field}
        testId={`detail-${field}`}
        label={getSiteConditionFieldLabel(t, field)}
        info={getSiteConditionFieldHelp(t, field)}
        value={getSiteConditionValueLabel(t, field, condition.value)}
        caption={getInheritedSourceLabel(t, condition, type)}
      />
    );
  });

  return (
    <>
      <OptionalSection
        testId="detail-section-general"
        title={t('hierarchy:details.sections.general')}
        rows={[
          type === 'location' ? text('description', t('hierarchy:details.fields.description'), entity.description) : null,
          type === 'location' ? text('address', t('hierarchy:details.fields.address'), entity.address) : null,
        ]}
      />
      <OptionalSection
        testId="detail-section-geometry"
        title={t('hierarchy:details.sections.geometry')}
        mobileColumns={2}
        rows={[
          text('length_m', t('hierarchy:columns.length'), formatNumber(entity.length_m, locale)),
          text('width_m', t('hierarchy:columns.width'), formatNumber(entity.width_m, locale)),
          type !== 'bed' && measuredArea !== null
            ? text('area', t('hierarchy:details.coverage.gross'),
              areaText(measuredArea))
            : text('area', t('hierarchy:columns.area'), area === null ? null : areaText(area)),
          type === 'location' ? text('parcel-count', t('hierarchy:details.sections.children.location'), count(resolved.fieldIds.size)) : null,
          type !== 'bed' ? text('bed-count', t('hierarchy:details.sections.children.field'), count(resolved.bedIds.size)) : null,
          type !== 'bed' ? <GrowingAreaCoverageRows key="coverage" resolved={resolved} locale={locale} refreshHierarchy={refreshHierarchy} /> : null,
        ]}
      />
      <OptionalSection
        testId="detail-section-site-conditions"
        title={t('hierarchy:details.sections.siteConditions')}
        rows={conditionRows}
      />
      <OptionalSection
        testId="detail-section-site-details"
        title={t('hierarchy:details.sections.siteDetails')}
        rows={[
          type === 'location' && entity.exposure
            ? text('exposure', t('hierarchy:siteConditions.labels.exposure'), t(`locations:exposure.${entity.exposure}`))
            : null,
          type === 'field' && entity.cultivation_environment
            ? text('cultivation_environment', t('hierarchy:siteConditions.labels.cultivation_environment'),
              getSiteConditionValueLabel(t, 'cultivation_environment', entity.cultivation_environment))
            : null,
          text('soil_description', t('hierarchy:siteConditions.labels.soil_description'), entity.soil_description),
          text('wind_exposure', t('hierarchy:siteConditions.labels.wind_exposure'), entity.wind_exposure),
          text('water_supply', t('hierarchy:siteConditions.labels.water_supply'), entity.water_supply),
        ]}
      />

      {type !== 'bed' && (
        <Box data-testid="detail-section-children">
          <DetailSection title={t(`hierarchy:details.sections.children.${type}`)}>
            {resolved.children.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t(`hierarchy:details.emptyChildren.${type}`)}</Typography>
            ) : (
              <List dense disablePadding>
                {resolved.children.map(child => {
                  const childArea = knownArea(child);
                  const bedCount = type === 'location' ? bedsByField.get(child.id!) ?? 0 : null;
                  return (
                    <ListItem key={child.id} disableGutters sx={{ gap: 1, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
                      <Link component={RouterLink} to={getEntityDetailPath(type === 'location' ? 'field' : 'bed', child.id!)} state={relatedState}
                        underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                        {child.name}
                      </Link>
                      <Typography variant="body2" color="text.secondary">
                        {[
                          childArea === null ? null : areaText(childArea),
                          bedCount === null ? null : t('hierarchy:details.childBedCount', { count: bedCount, formatted: count(bedCount) }),
                        ].filter(Boolean).join(' · ')}
                      </Typography>
                    </ListItem>
                  );
                })}
              </List>
            )}
          </DetailSection>
        </Box>
      )}

    </>
  );
}
