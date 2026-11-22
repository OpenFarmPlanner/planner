import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { Link as RouterLink, useOutletContext } from 'react-router';
import { isAxiosError } from 'axios';
import { noteAttachmentAPI, plantingPlanAPI } from '../api/api';
import type { NoteAttachment, PlantingPlanDetail } from '../api/types';
import { NotesDrawer } from '../components/data-grid/NotesDrawer';
import { RichTextViewer } from '../components/data-grid/RichTextViewer';
import { getEntityDetailPath } from '../components/hierarchy/details/hierarchyDetailRoutes';
import { DetailPageActions } from '../components/layout/DetailPageActions';
import { DetailGrid, DetailRow, DetailSection } from '../components/layout/DetailPrimitives';
import { detailHeaderRowSx, detailHeaderTitleColumnSx, detailHeaderTitleTextSx } from '../components/layout/detailHeaderStyles';
import LoadRetryButton from '../components/LoadRetryButton';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { HarvestRecords } from '../harvests/HarvestRecords';
import { useNavigationBlocker } from '../hooks/useNavigationBlocker';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import { useTranslation } from '../i18n';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';
import {
  DIRECT_SOWING, getPlanPropagationInfo, PRE_CULTIVATION, PURCHASED_TRANSPLANT,
} from '../pages/planSowingDate';
import { hasEarlyRecordedOccupancy } from '../pages/plantingPlansUtils';
import { formatSeasonDate, initialSeasonRecordDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { PlantingPlanExecutionDates } from './PlantingPlanExecutionDates';
import { PerennialPlanDates } from './PerennialPlanDates';
import { CropLosses } from './CropLosses';
import { PreviousSeasonReference } from './PreviousSeasonReference';
import { PlantingPlanTasks } from './PlantingPlanTasks';

interface PlantingPlanDetailsProps {
  planId: number | null;
  onBack: () => void;
  onChanged: () => void;
  onExpand?: () => void;
}

type PlanLoad = { plan: PlantingPlanDetail } | { error: 'not-found' | 'load' };

export function PlantingPlanDetails({ planId, onBack, onChanged, onExpand }: PlantingPlanDetailsProps) {
  const { t, i18n } = useTranslation(['plantingPlans', 'common', 'harvests']);
  const { activeProjectId, isAuthLoading, missingProjectReason } = useProjectRequirement();
  const context = useOutletContext<RootLayoutOutletContext | null>();
  const [result, setResult] = useState<PlanLoad>();
  const [attempt, setAttempt] = useState(0);
  const [attachments, setAttachments] = useState<NoteAttachment[]>();
  const [attachmentLoadFailed, setAttachmentLoadFailed] = useState(false);
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [datesDirty, setDatesDirty] = useState(false);
  const [clearingDateDirty, setClearingDateDirty] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const loadedPlan = result && 'plan' in result ? result.plan : undefined;
  const loadedPlanId = loadedPlan?.id;
  const hasPhotos = Boolean(loadedPlan?.note_attachment_count) || attachmentRevision > 0;
  const hasUnsavedNotes = editorOpen && draft !== (loadedPlan?.notes ?? '');

  useNavigationBlocker(hasUnsavedNotes || datesDirty || clearingDateDirty, hasUnsavedNotes
    ? t('common:notesDrawer.unsavedDialog.message')
    : t(clearingDateDirty ? 'perennial.unsaved' : 'actualDates.unsaved'));

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (planId === null || activeProjectId === null) return;

    const controller = new AbortController();
    void plantingPlanAPI.getAcrossSeasons(planId, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setResult({ plan: data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setResult({ error: status === 404 || status === 403 ? 'not-found' : 'load' });
    });
    return () => controller.abort();
  }, [activeProjectId, attempt, context?.activeSeason?.id, planId]);

  useEffect(() => {
    if (loadedPlanId === undefined || !hasPhotos) return;
    let current = true;
    void noteAttachmentAPI.list(loadedPlanId).then(({ data }) => {
      if (current) {
        setAttachments(data);
        setAttachmentLoadFailed(false);
      }
    }).catch(() => {
      if (current) setAttachmentLoadFailed(true);
    });
    return () => { current = false; };
  }, [attachmentRevision, hasPhotos, loadedPlanId]);

  const locale = resolveSeasonDateLocale(i18n);
  const date = (value: string | null | undefined) => value ? formatSeasonDate(value, locale) : '';
  const season = context?.projectSeasons?.find(item => item.id === loadedPlan?.season) ?? (
    context?.activeSeason?.id === loadedPlan?.season ? context?.activeSeason : undefined
  );
  const otherSeason = Boolean(loadedPlan && (loadedPlan.season ?? null) !== (context?.activeSeason?.id ?? null));
  const canEditNotes = Boolean(loadedPlan && !otherSeason);
  const cropName = loadedPlan ? formatCropDisplayName(loadedPlan) : '';
  const recordSeason = context?.activeSeason ?? season;
  const seasonalHarvest = loadedPlan?.seasonal_harvest;
  let recordDate = initialSeasonRecordDate(
    recordSeason, seasonalHarvest ? seasonalHarvest.periods[0]?.start_date : loadedPlan?.harvest_date,
  );
  const firstOccupiedDay = seasonalHarvest?.occupancy_start_date;
  const lastOccupiedDay = loadedPlan?.occupancy_end_date;
  if (loadedPlan?.carried_over) {
    if (firstOccupiedDay && recordDate < firstOccupiedDay) recordDate = firstOccupiedDay;
    if (lastOccupiedDay && recordDate > lastOccupiedDay) recordDate = lastOccupiedDay;
  }
  const recordScope = `${activeProjectId ?? ''}:${recordSeason?.id ?? ''}:${loadedPlanId ?? ''}`;
  const propagation = loadedPlan && getPlanPropagationInfo(loadedPlan, undefined);
  const cultivation = loadedPlan?.cultivation_type || (propagation?.isPreCultivation
    ? PRE_CULTIVATION : loadedPlan?.crop_cultivation_type);
  const cultivationLabel = cultivation === PRE_CULTIVATION ? t('cultivationTypesLong.preCultivation')
    : cultivation === PURCHASED_TRANSPLANT ? t('cultivationTypesLong.purchasedTransplant')
      : cultivation === DIRECT_SOWING ? t('cultivationTypesLong.directSowing') : '';
  const area = loadedPlan?.area_usage_sqm;
  const contextRows = loadedPlan ? [
    { label: t('details.season'), value: season?.label },
    { label: t('columns.location'), value: loadedPlan.location_name },
    { label: t('columns.field'), value: loadedPlan.field_name },
    { label: t('columns.bed'), value: loadedPlan.bed_name },
    { label: t('columns.areaM2'), value: area == null ? '' : formatLocalizedNumber(Number(area), locale) },
    { label: t('columns.cultivationType'), value: cultivationLabel },
  ].filter(row => row.value) : [];

  const saveNotes = async () => {
    if (!loadedPlan || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const { data } = await plantingPlanAPI.patch(loadedPlan.id, { notes: draft });
      setResult({ plan: { ...loadedPlan, notes: data.notes } });
      setEditorOpen(false);
      onChanged();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const error = result && 'error' in result ? result.error : undefined;
  const unavailable = !isAuthLoading && (error === 'not-found' || planId === null || activeProjectId === null);

  return (
    <Stack spacing={{ xs: 2, sm: 3 }} sx={{ maxWidth: 1000, minWidth: 0, pb: 2 }}>
      <Box sx={{ ...detailHeaderRowSx, gap: 1.5 }}>
        <Box sx={detailHeaderTitleColumnSx}>
          {cropName && <Typography variant="overline" component="div">{t('details.title')}</Typography>}
          <Typography component="h1" variant="h4" ref={titleRef} tabIndex={-1} sx={detailHeaderTitleTextSx}>
            {cropName || t('details.title')}
          </Typography>
        </Box>
        <DetailPageActions primaryActions={[
          { label: onExpand ? t('common:actions.close') : t('details.back'),
            icon: onExpand ? <CloseIcon fontSize="small" /> : <ArrowBackIcon fontSize="small" />, onClick: onBack },
          ...(onExpand ? [{ label: t('details.expand'), icon: <OpenInFullIcon fontSize="small" />, onClick: onExpand }] : []),
        ]} />
      </Box>

      {missingProjectReason ? <ProjectRequiredState reason={missingProjectReason} /> :
        unavailable ? <Alert severity="info">{t('details.notFound')}</Alert> :
        error === 'load' ? <Alert severity="error" action={<LoadRetryButton onClick={() => {
          setResult(undefined);
          setAttempt(value => value + 1);
        }} />}>{t('errors.load')}</Alert> :
          !loadedPlan ? <CircularProgress size={28} aria-label={t('loadingPlans')} /> : <>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {loadedPlan.crop_available && loadedPlan.crop !== null && (
                <Button component={RouterLink} to={`/app/crops?cropId=${loadedPlan.crop}`}>{t('details.openCrop')}</Button>
              )}
              {loadedPlan.bed !== null && (
                <Button component={RouterLink} to={getEntityDetailPath('bed', loadedPlan.bed)}>{t('details.openBed')}</Button>
              )}
              {otherSeason && season && context?.switchActiveSeason && (
                <Button onClick={() => context.switchActiveSeason?.(season.id)}>
                  {t(loadedPlan.carried_over ? 'carriedOver.openOrigin' : 'details.openSeason')}
                </Button>
              )}
            </Stack>
            {loadedPlan.carried_over && (
              <Alert severity="info">
                {loadedPlan.origin_season_label
                  ? t(hasEarlyRecordedOccupancy(loadedPlan) ? 'carriedOver.otherSeasonDescription' : 'carriedOver.description',
                    { season: loadedPlan.origin_season_label })
                  : t('carriedOver.unknownDescription')}
              </Alert>
            )}
            {contextRows.length > 0 && <DetailSection title={t('details.context')} outlined>
              <DetailGrid>{contextRows.map(row => <DetailRow key={row.label} label={row.label} value={row.value!} />)}</DetailGrid>
            </DetailSection>}
            {loadedPlan.previous_season_reference && <PreviousSeasonReference
              reference={loadedPlan.previous_season_reference} activeSeasonId={context?.activeSeason?.id}
              switchSeason={context?.switchActiveSeason} />}
            <PerennialPlanDates key={loadedPlan.id} plan={loadedPlan} editable={canEditNotes}
              onDirtyChange={setClearingDateDirty} onSaved={updated => {
                setResult(current => current && 'plan' in current ? { plan: { ...current.plan, ...updated } } : current);
                onChanged();
              }} />
            <PlantingPlanExecutionDates plan={loadedPlan} editable={canEditNotes} onDirtyChange={setDatesDirty}
              onSaved={dates => {
                setResult(current => current && 'plan' in current ? { plan: { ...current.plan, ...dates } } : current);
                onChanged();
              }} />
            <DetailSection title={t('harvests:title')} outlined>
              <HarvestRecords key={recordScope} scope={recordScope} planId={loadedPlan.id}
                initialDate={recordDate} planTotals={loadedPlan.actual_harvest}
                plan={loadedPlan.crop_available && loadedPlan.crop !== null ? {
                  id: loadedPlan.id, crop: loadedPlan.crop, cropLabel: cropName,
                  label: [loadedPlan.bed_name, season?.label, date(loadedPlan.planting_date)].filter(Boolean).join(' · '),
                } : undefined}
                onChanged={() => { setAttempt(value => value + 1); onChanged(); }} />
            </DetailSection>
            <CropLosses key={recordScope} planId={loadedPlan.id} onChanged={onChanged}
              initialDate={initialSeasonRecordDate(loadedPlan.carried_over ? recordSeason : season, loadedPlan.planting_date)} />
            {(canEditNotes || loadedPlan.notes?.trim() || hasPhotos) && (
              <DetailSection title={t('details.notesAndPhotos')} outlined>
                <Stack spacing={1.5} sx={{ alignItems: 'flex-start', minWidth: 0, overflowWrap: 'anywhere' }}>
                  {loadedPlan.notes?.trim() && <RichTextViewer value={loadedPlan.notes} />}
                  {attachments && attachments.length > 0 && <Box sx={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 1, width: '100%',
                  }}>
                    {attachments.map(attachment => {
                      const src = attachment.image_url || attachment.image;
                      return <Link key={attachment.id} href={src} target="_blank" rel="noopener noreferrer">
                        <Box component="img" src={src} alt={attachment.caption || t('common:notesDrawer.attachmentAlt')}
                          loading="lazy" sx={{ width: '100%', height: 84, objectFit: 'cover', borderRadius: 1 }} />
                      </Link>;
                    })}
                  </Box>}
                  {attachmentLoadFailed && <Alert severity="error" action={<LoadRetryButton onClick={() => {
                    setAttachmentLoadFailed(false);
                    setAttachmentRevision(value => value + 1);
                  }} />}>{t('details.photosLoadFailed')}</Alert>}
                  {canEditNotes && <Button onClick={() => {
                    setDraft(loadedPlan.notes ?? '');
                    setSaveFailed(false);
                    setEditorOpen(true);
                  }}>
                    {loadedPlan.notes?.trim() || (attachments?.length ?? loadedPlan.note_attachment_count ?? 0) > 0
                      ? t('details.editNotesAndPhotos') : t('details.addNoteOrPhoto')}
                  </Button>}
                </Stack>
              </DetailSection>
            )}
            {activeProjectId !== null && <PlantingPlanTasks key={`tasks:${recordScope}`} plan={loadedPlan}
              projectId={activeProjectId} editableSeasonLabel={canEditNotes ? season?.label : undefined} />}
            <NotesDrawer open={editorOpen} title={t('details.notesAndPhotos')} value={draft} onChange={setDraft}
              onSave={saveNotes} onClose={() => setEditorOpen(false)} hasUnsavedChanges={hasUnsavedNotes}
              loading={saving} noteId={loadedPlan.id} saveError={saveFailed ? t('errors.save') : undefined}
              onAttachmentsChanged={() => {
                setAttachmentRevision(value => value + 1);
                onChanged();
              }} />
          </>}
    </Stack>
  );
}
