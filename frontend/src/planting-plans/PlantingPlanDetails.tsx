import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material';
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
import { DetailSection } from '../components/layout/DetailPrimitives';
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
import { formatSeasonDate, formatSeasonPeriod, initialSeasonRecordDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { PlantingPlanExecutionDates } from './PlantingPlanExecutionDates';
import { PerennialPlanDates } from './PerennialPlanDates';
import { PerennialHarvestWindows } from './PerennialHarvestWindows';
import { CropLosses } from './CropLosses';
import { PreviousSeasonReference } from './PreviousSeasonReference';
import { PlantingPlanTasks } from './PlantingPlanTasks';

interface PlantingPlanDetailsProps {
  planId: number | null;
  onBack: () => void;
  onChanged: () => void;
  onExpand?: () => void;
}

type PlanLoad = { plan: PlantingPlanDetail; recordSeasonId: number | undefined }
  | { error: 'not-found' | 'load' };
type HarvestWindowSelection = { seasonId: number | undefined; year?: number; dirty: boolean };

export function PlantingPlanDetails({ planId, onBack, onChanged, onExpand }: PlantingPlanDetailsProps) {
  const { t, i18n } = useTranslation(['plantingPlans', 'common', 'harvests']);
  const { activeProjectId, isAuthLoading, missingProjectReason } = useProjectRequirement();
  const context = useOutletContext<RootLayoutOutletContext | null>();
  const activeSeasonId = context?.activeSeason?.id;
  const recordSeasonControlId = useId();
  const [result, setResult] = useState<PlanLoad>();
  const [selectedRecordSeasonId, setSelectedRecordSeasonId] = useState<number>();
  const [recordLoadError, setRecordLoadError] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  const [attachments, setAttachments] = useState<NoteAttachment[]>();
  const [attachmentLoadFailed, setAttachmentLoadFailed] = useState(false);
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [plantingDatesDirty, setPlantingDatesDirty] = useState(false);
  const [harvestDatesDirty, setHarvestDatesDirty] = useState(false);
  const [clearingDateDirty, setClearingDateDirty] = useState(false);
  const [harvestSelection, setHarvestSelection] = useState<HarvestWindowSelection>({
    seasonId: activeSeasonId, dirty: false,
  });
  if (harvestSelection.seasonId !== activeSeasonId) {
    setHarvestSelection({ seasonId: activeSeasonId, dirty: false });
  }
  const { year: harvestYear, dirty: harvestWindowDirty } = harvestSelection;
  const setHarvestYear = (year?: number) => setHarvestSelection(current =>
    current.seasonId === activeSeasonId ? { ...current, year } : current);
  const setHarvestWindowDirty = (dirty: boolean) => setHarvestSelection(current =>
    current.seasonId === activeSeasonId ? { ...current, dirty } : current);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const loadedPlan = result && 'plan' in result ? result.plan : undefined;
  const loadedPlanId = loadedPlan?.id;
  const hasPhotos = Boolean(loadedPlan?.note_attachment_count) || attachmentRevision > 0;
  const hasUnsavedNotes = editorOpen && draft !== (loadedPlan?.notes ?? '');

  const datesDirty = plantingDatesDirty || harvestDatesDirty;
  useNavigationBlocker(hasUnsavedNotes || datesDirty || clearingDateDirty || harvestWindowDirty, hasUnsavedNotes
    ? t('common:notesDrawer.unsavedDialog.message')
    : t(harvestWindowDirty ? 'harvestWindows.unsaved' : clearingDateDirty ? 'perennial.unsaved' : 'actualDates.unsaved'));

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (planId === null || activeProjectId === null || context?.activeSeasonLoading) return;

    const controller = new AbortController();
    const requestedSeason = selectedRecordSeasonId ?? activeSeasonId;
    const load = (seasonId?: number) => plantingPlanAPI.getAcrossSeasons(planId, controller.signal, harvestYear, seasonId);
    void load(requestedSeason).then(async ({ data }) => {
      if (controller.signal.aborted) return;
      // A historical annual opened by a direct link still defaults to its own season.
      const useOrigin = selectedRecordSeasonId === undefined && data.season != null && (
        requestedSeason === undefined || (
          data.season !== requestedSeason && !data.carried_over && data.crop_life_cycle !== 'perennial'
        )
      );
      const recordSeasonId = useOrigin ? data.season! : requestedSeason;
      const plan = recordSeasonId === requestedSeason ? data : (await load(recordSeasonId)).data;
      if (!controller.signal.aborted) {
        setResult({ plan, recordSeasonId });
        setRecordLoadError(undefined);
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (selectedRecordSeasonId !== undefined) {
        setRecordLoadError(selectedRecordSeasonId);
        return;
      }
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setResult({ error: status === 404 || status === 403 ? 'not-found' : 'load' });
    });
    return () => controller.abort();
  }, [activeProjectId, activeSeasonId, attempt, context?.activeSeasonLoading, harvestYear, planId, selectedRecordSeasonId]);

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
    context?.activeSeason?.id === loadedPlan?.season ? context?.activeSeason ?? undefined : undefined
  );
  const otherSeason = Boolean(loadedPlan && (loadedPlan.season ?? null) !== (context?.activeSeason?.id ?? null));
  const canEditPlan = Boolean(loadedPlan && !otherSeason);
  const cropName = loadedPlan ? formatCropDisplayName(loadedPlan) : '';
  const loadedRecordSeasonId = result && 'plan' in result ? result.recordSeasonId : undefined;
  const recordSeasonId = selectedRecordSeasonId ?? loadedRecordSeasonId;
  const recordReady = loadedRecordSeasonId === recordSeasonId;
  const recordSeason = context?.projectSeasons?.find(item => item.id === recordSeasonId)
    ?? (recordSeasonId !== undefined && recordSeasonId === activeSeasonId ? context?.activeSeason ?? undefined : season);
  const harvestDatesEditable = canEditPlan && recordSeasonId === loadedPlan?.season;
  const tasksEditable = recordSeasonId !== undefined && recordSeasonId === activeSeasonId
    && (canEditPlan || loadedPlan?.carried_over);
  const seasonalHarvest = loadedPlan?.seasonal_harvest;
  let recordDate = initialSeasonRecordDate(
    recordSeason, seasonalHarvest ? seasonalHarvest.periods[0]?.start_date : loadedPlan?.harvest_date,
  );
  const firstOccupiedDay = seasonalHarvest?.occupancy_start_date;
  const lastOccupiedDay = loadedPlan?.occupancy_end_date;
  const occupancyStart = firstOccupiedDay ?? loadedPlan?.planting_date;
  const recordSeasonOptions = context?.projectSeasons?.filter(item => (
    item.id === recordSeasonId || item.id === loadedPlan?.season
    || (occupancyStart && lastOccupiedDay && occupancyStart <= item.end_date && item.start_date <= lastOccupiedDay)
  )) ?? [];
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
    { label: t('details.bedArea'), value: loadedPlan.bed_area_sqm == null ? '' : formatLocalizedNumber(loadedPlan.bed_area_sqm, locale) },
    { label: t('columns.cultivationType'), value: cultivationLabel },
  ].filter(row => row.value) : [];

  const saveNotes = async () => {
    if (!loadedPlan || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const { data } = await plantingPlanAPI.patch(loadedPlan.id, { notes: draft });
      setResult(current => current && 'plan' in current
        ? { ...current, plan: { ...current.plan, notes: data.notes } } : current);
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
    <Stack spacing={{ xs: 1.5, sm: 3 }} sx={{ maxWidth: 1000, minWidth: 0, pb: 2 }}>
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
            </Stack>
            {otherSeason && season && (
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('details.originReadOnly', { season: season.label })}
                </Typography>
                {context?.switchActiveSeason && <Button size="small" onClick={() => context.switchActiveSeason?.(season.id)}>
                  {t(loadedPlan.carried_over ? 'carriedOver.openOrigin' : 'details.openSeason')}
                </Button>}
              </Stack>
            )}
            {contextRows.length > 0 && <DetailSection title={t('details.context')} outlined>
              <Box component="dl" sx={{ display: 'grid', m: 0, gap: { xs: 0.5, sm: 1.5 },
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}>
                {contextRows.map(row => <Box key={row.label} sx={{ display: 'grid', columnGap: 1,
                  gridTemplateColumns: { xs: 'minmax(0, 1fr) minmax(0, 1.2fr)', sm: '1fr' } }}>
                  <Typography component="dt" variant="body2" color="text.secondary">{row.label}</Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{row.value}</Typography>
                </Box>)}
              </Box>
            </DetailSection>}
            {loadedPlan.previous_season_reference && <PreviousSeasonReference
              reference={loadedPlan.previous_season_reference} activeSeasonId={context?.activeSeason?.id}
              switchSeason={context?.switchActiveSeason} />}
            <PerennialPlanDates key={loadedPlan.id} plan={loadedPlan} editable={canEditPlan}
              onDirtyChange={setClearingDateDirty} onSaved={updated => {
                setResult(current => current && 'plan' in current
                  ? { ...current, plan: { ...current.plan, clearing_date: updated.clearing_date,
                    occupancy_end_date: updated.occupancy_end_date } } : current);
                setHarvestYear(undefined);
                setAttempt(value => value + 1);
                onChanged();
              }} />
            <PlantingPlanExecutionDates plan={loadedPlan} group="planting" editable={canEditPlan}
              onDirtyChange={setPlantingDatesDirty}
              onSaved={dates => {
                const { seasonal_harvest, ...actualDates } = dates;
                setResult(current => current && 'plan' in current
                  ? { ...current, plan: { ...current.plan, ...actualDates,
                    ...(current.recordSeasonId === activeSeasonId ? { seasonal_harvest } : {}) } } : current);
                setHarvestYear(undefined);
                setAttempt(value => value + 1);
                onChanged();
              }} />
            {(canEditPlan || loadedPlan.notes?.trim() || hasPhotos) && (
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
                  {canEditPlan && <Button onClick={() => {
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
            <DetailSection title={t('details.seasonalRecords')} outlined>
              <Stack spacing={2}>
                {recordSeasonOptions.length > 1 && recordSeasonId !== undefined ? (
                  <TextField id={recordSeasonControlId} select size="small" label={t('details.recordSeason')}
                    value={recordSeasonId} slotProps={{ select: { native: true } }}
                    helperText={recordSeason && formatSeasonPeriod(recordSeason.start_date, recordSeason.end_date, locale)}
                    disabled={datesDirty || harvestWindowDirty}
                    onChange={event => { setRecordLoadError(undefined); setSelectedRecordSeasonId(Number(event.target.value)); }}
                    sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
                    {recordSeasonOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </TextField>
                ) : recordSeason && <Typography variant="body2" color="text.secondary">
                  {recordSeason.label} · {formatSeasonPeriod(recordSeason.start_date, recordSeason.end_date, locale)}
                </Typography>}
                {recordLoadError === recordSeasonId && recordLoadError !== undefined ? (
                  <Alert severity="error" action={<LoadRetryButton onClick={() => {
                    setRecordLoadError(undefined);
                    setAttempt(value => value + 1);
                  }} />}>{t('errors.load')}</Alert>
                ) : !recordReady ? <CircularProgress size={24} aria-label={t('loadingPlans')} /> : <>
                  <PlantingPlanExecutionDates key={`harvest-dates:${recordScope}`} plan={loadedPlan} group="harvest"
                    season={recordSeason} observedFirstHarvest={loadedPlan.observed_first_harvest_date}
                    editable={harvestDatesEditable} onDirtyChange={setHarvestDatesDirty}
                    onSaved={dates => {
                      setResult(current => current && 'plan' in current
                        ? { ...current, plan: { ...current.plan, ...dates } } : current);
                      setAttempt(value => value + 1);
                      onChanged();
                    }} />
                  <DetailSection title={t('harvests:title')}>
                    <HarvestRecords key={recordScope} scope={recordScope} planId={loadedPlan.id} recordSeasonId={recordSeasonId}
                      initialDate={recordDate} planTotals={loadedPlan.actual_harvest}
                      plan={loadedPlan.crop_available && loadedPlan.crop !== null ? {
                        id: loadedPlan.id, crop: loadedPlan.crop, cropLabel: cropName,
                        label: [loadedPlan.bed_name, season?.label, date(loadedPlan.planting_date)].filter(Boolean).join(' · '),
                      } : undefined}
                      onChanged={() => { setAttempt(value => value + 1); onChanged(); }} />
                  </DetailSection>
                  <CropLosses key={recordScope} planId={loadedPlan.id} recordSeasonId={recordSeasonId}
                    onChanged={onChanged} initialDate={initialSeasonRecordDate(recordSeason, loadedPlan.planting_date)} />
                  {activeProjectId !== null && <PlantingPlanTasks key={`tasks:${recordScope}`} plan={loadedPlan}
                    projectId={activeProjectId} recordSeasonId={recordSeasonId}
                    editableSeasonLabel={tasksEditable ? recordSeason?.label : undefined} />}
                </>}
              </Stack>
            </DetailSection>
            {canEditPlan && loadedPlan.harvest_windows_by_year && recordReady && <PerennialHarvestWindows planId={loadedPlan.id}
              page={loadedPlan.harvest_windows_by_year} season={season} onPageChange={setHarvestYear}
              editable onDirtyChange={setHarvestWindowDirty} onSaved={(_, year) => {
                setHarvestYear(year);
                setAttempt(value => value + 1);
                onChanged();
              }} />}
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
