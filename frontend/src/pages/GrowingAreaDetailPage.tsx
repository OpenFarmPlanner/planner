import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
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
import { formatCropDisplayName } from '../crops/cropDisplay';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { parseDimensionValue } from '../components/hierarchy/utils/hierarchyAreaParsing';
import {
  DETAIL_ROUTE_SEGMENTS,
  resolveGrowingAreaEntity,
  type ResolvedGrowingAreaEntity,
} from '../components/hierarchy/details/growingAreaEntity';
import {
  getEntityDetailPath,
  getGrowingAreaListPath,
  GROWING_AREAS_PATH,
  type HierarchyEntityType,
} from '../components/hierarchy/details/hierarchyDetailRoutes';
import {
  GrowingAreaDetailForm,
  type GrowingAreaDetailDraft,
} from '../components/hierarchy/details/GrowingAreaDetailForm';
import { INHERITED_SITE_CONDITION_FIELDS } from '../components/hierarchy/utils/siteConditions';
import {
  getInheritedSourceLabel,
  getSiteConditionFieldHelp,
  getSiteConditionFieldLabel,
  getSiteConditionValueLabel,
} from '../components/hierarchy/siteConditionLabels';

const formatNumber = (value: number | null | undefined, locale: string): string | null => (
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(locale) : null
);

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
    return <PageContainer variant="standard"><ProjectRequiredState reason={missingProjectReason} /></PageContainer>;
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
  const { t, i18n } = useTranslation(['hierarchy', 'locations', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const navigate = useNavigate();
  const hierarchy = useHierarchyData(true);
  const { locations, fields, beds, setLocations, setFields, setBeds, loading, hasLoaded, error } = hierarchy;
  const [plans, setPlans] = useState<PlantingPlan[] | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<GrowingAreaDetailDraft | null>(null);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const resolved = useMemo(
    () => (type && id !== null ? resolveGrowingAreaEntity(type, id, { locations, fields, beds }) : null),
    [beds, fields, id, locations, type],
  );

  useEffect(() => {
    let cancelled = false;
    plantingPlanAPI.listAll()
      .then((loaded) => { if (!cancelled) setPlans(loaded.results); })
      .catch(() => { if (!cancelled) setPlans([]); });
    return () => { cancelled = true; };
  }, []);

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
    if (!resolved || !draft || !type) return;
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
  }, [draft, resolved, setBeds, setFields, setLocations, t, type]);

  const backPath = resolved && type && id !== null ? getGrowingAreaListPath(type, id) : GROWING_AREAS_PATH;

  if (!hasLoaded && loading) {
    return (
      <PageContainer variant="standard">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
      </PageContainer>
    );
  }
  if (error && !resolved) {
    return (
      <PageContainer variant="standard">
        <Alert severity="error" action={<LoadRetryButton disabled={loading} onClick={() => void hierarchy.fetchData()} />}>
          {error}
        </Alert>
      </PageContainer>
    );
  }
  if (!resolved || !type) {
    return (
      <PageContainer variant="standard">
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
    : [{ label: t('common:actions.edit'), icon: <EditIcon fontSize="small" />, onClick: startEditing }];

  return (
    <PageContainer variant="standard">
      <Stack spacing={2} data-testid="growing-area-detail">
        <Breadcrumbs aria-label={t('hierarchy:details.breadcrumbAria')} sx={{ overflowWrap: 'anywhere' }}>
          <Link component={RouterLink} to={backPath} underline="hover" color="inherit">
            {t('hierarchy:title')}
          </Link>
          {resolved.location && type !== 'location' ? (
            <Link component={RouterLink} to={getEntityDetailPath('location', resolved.location.id!)} underline="hover" color="inherit">
              {resolved.location.name}
            </Link>
          ) : null}
          {resolved.field && type === 'bed' ? (
            <Link component={RouterLink} to={getEntityDetailPath('field', resolved.field.id!)} underline="hover" color="inherit">
              {resolved.field.name}
            </Link>
          ) : null}
          <Typography color="text.primary" aria-current="page">{resolved.entity.name}</Typography>
        </Breadcrumbs>

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

        <Box>
          <Button
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={() => navigate(backPath)}
            disabled={isSaving}
          >
            {t('hierarchy:details.backToList')}
          </Button>
        </Box>

        {saveError ? <Alert severity="error">{saveError}</Alert> : null}

        {isEditing && draft ? (
          <GrowingAreaDetailForm
            type={type}
            draft={draft}
            onChange={setDraft}
            inherited={resolved.inherited}
            nameError={!draft.name.trim() ? t('hierarchy:validation.nameRequired') : undefined}
          />
        ) : (
          <GrowingAreaReadView resolved={resolved} plans={plans} locale={locale} />
        )}
      </Stack>
    </PageContainer>
  );
}

function OptionalSection({ title, rows, testId }: { title: string; rows: ReactNode[]; testId: string }) {
  const visible = rows.filter(Boolean);
  if (visible.length === 0) return null;
  return (
    <Box data-testid={testId}>
      <DetailSection title={title}>
        <DetailGrid>{visible}</DetailGrid>
      </DetailSection>
    </Box>
  );
}

function GrowingAreaReadView({
  resolved,
  plans,
  locale,
}: {
  resolved: ResolvedGrowingAreaEntity;
  plans: PlantingPlan[] | null;
  locale: string;
}) {
  const { t } = useTranslation(['hierarchy', 'locations', 'common']);
  const { type } = resolved;
  const entity = resolved.entity as Location & Field & Bed;
  const area = type === 'location'
    ? (entity.length_m && entity.width_m ? entity.length_m * entity.width_m : null)
    : (entity.length_m && entity.width_m ? entity.length_m * entity.width_m : Number(entity.area_sqm) || null);
  const text = (key: string, label: string, value: string | null | undefined): ReactNode => (
    value && value.trim() ? <DetailRow key={key} label={label} value={value} testId={`detail-${key}`} /> : null
  );

  const parentRow = type === 'bed' && resolved.field
    ? <DetailRow key="parent" label={t('hierarchy:columns.field')} value={resolved.field.name} />
    : type === 'field' && resolved.location
      ? <DetailRow key="parent" label={t('hierarchy:columns.location')} value={resolved.location.name} />
      : null;

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

  const relatedPlans = (plans ?? []).filter((plan) => plan.bed !== null && resolved.bedIds.has(plan.bed));

  return (
    <Stack spacing={3}>
      <OptionalSection
        testId="detail-section-general"
        title={t('hierarchy:details.sections.general')}
        rows={[
          parentRow,
          type === 'location' ? text('description', t('hierarchy:details.fields.description'), entity.description) : null,
          type === 'location' ? text('address', t('hierarchy:details.fields.address'), entity.address) : null,
        ]}
      />
      <OptionalSection
        testId="detail-section-geometry"
        title={t('hierarchy:details.sections.geometry')}
        rows={[
          text('length_m', t('hierarchy:columns.length'), formatNumber(entity.length_m, locale)),
          text('width_m', t('hierarchy:columns.width'), formatNumber(entity.width_m, locale)),
          text('area', t('hierarchy:columns.area'), formatNumber(area === null ? null : Math.round(area * 10) / 10, locale)),
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

      {resolved.children.length > 0 ? (
        <Box data-testid="detail-section-children">
          <DetailSection title={t(`hierarchy:details.sections.children.${type}`)}>
            <List dense disablePadding>
              {resolved.children.map((child) => (
                <ListItem key={child.id} disableGutters>
                  <Link
                    component={RouterLink}
                    to={getEntityDetailPath(type === 'location' ? 'field' : 'bed', child.id!)}
                    underline="hover"
                  >
                    {child.name}
                  </Link>
                </ListItem>
              ))}
            </List>
          </DetailSection>
        </Box>
      ) : null}

      {relatedPlans.length > 0 ? (
        <Box data-testid="detail-section-plans">
          <DetailSection title={t('hierarchy:details.sections.plantingPlans')}>
            <List dense disablePadding>
              {relatedPlans.map((plan) => (
                <ListItem key={plan.id} disableGutters sx={{ flexWrap: 'wrap', columnGap: 1 }}>
                  <Link component={RouterLink} to={`/app/planting-plans?planId=${plan.id}`} underline="hover">
                    {formatCropDisplayName(plan) || t('hierarchy:details.unnamedPlan')}
                  </Link>
                  <Typography variant="body2" color="text.secondary" component="span">
                    {[
                      type !== 'bed' ? plan.bed_name : null,
                      plan.planting_date ? formatSeasonDate(plan.planting_date, locale) : null,
                    ].filter(Boolean).join(' · ')}
                  </Typography>
                </ListItem>
              ))}
            </List>
          </DetailSection>
        </Box>
      ) : null}

      {entity.notes && entity.notes.trim() ? (
        <Box data-testid="detail-section-notes">
          <DetailSection title={t('common:fields.notes')}>
            <RichTextViewer value={entity.notes} />
          </DetailSection>
        </Box>
      ) : null}
    </Stack>
  );
}
