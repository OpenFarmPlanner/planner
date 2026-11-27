import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert, Box, Button, Divider, IconButton, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { Link } from 'react-router';
import { cropAPI } from '../api/api';
import type { Bed, Crop, Field, Location, PlantingPlan, PlanCultivationType, Season, StemCoordinates } from '../api/types';
import { Disclosure } from '../components/Disclosure';
import { LocalizedDecimalField } from '../components/inputs/LocalizedDecimalField';
import LoadRetryButton from '../components/LoadRetryButton';
import { SiteSuitabilityHints } from '../components/planting-plans/rotation/SiteSuitabilityHints';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { getEffectiveCropValue } from '../crops/varietyValueSource';
import { useTranslation } from '../i18n';
import { IndividualPlantGenerationDialog } from '../planting-plans/IndividualPlantGenerationDialog';
import { plantingPlanDetailPath } from '../planting-plans/plantingPlanDetailRoutes';
import type { GraphicPlacementContext, GraphicPlacementResolution } from './graphicalPlantPlacement';
import type { Position } from './graphicalLayoutUtils';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { formatSeasonDate } from '../seasons/formatSeasonDate';
import { matchesPlacementParent, parcelMeters, planPlacementParent, roundMeters, shortStemSpacing, type PlacementDimensions, type PlacementParent } from './individualPlantGeometry';
import { getAllowedCultivationTypesForCrop } from './plantingPlansUtils';
import {
  collectOccupiedPlantPositions, individualCropSpacings, individualPlacementPeriod,
  MAX_INDIVIDUAL_POSITIONS,
} from './individualPlantGeneration';
import { readyForPlacement, type IndividualPlantsController } from './useIndividualPlants';

const cultivationLabels = {
  direct_sowing: 'directSowing', pre_cultivation: 'preCultivation', purchased_transplant: 'purchasedTransplant',
} as const;

function placementPlanLabel(plan: PlantingPlan, locale: string) {
  return [plan.crop_display_name || plan.crop_name, plan.crop_variety,
    plan.planting_date && formatSeasonDate(plan.planting_date, locale)].filter(Boolean).join(' · ');
}

function positive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function usePlacementCrops(source: 'all' | number | null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    source: 'all' | number; attempt: number; crops: Crop[] | null;
  } | null>(null);
  useEffect(() => {
    if (source === null) return;
    const request = new AbortController();
    const load = source === 'all'
      ? cropAPI.listAll(request.signal).then(({ results }) => results.filter(crop => crop.id != null))
      : cropAPI.get(source).then(({ data }) => [data]);
    void load.then(crops => {
      if (!request.signal.aborted) setResult({ source, attempt, crops });
    }).catch(() => {
      if (!request.signal.aborted) setResult({ source, attempt, crops: null });
    });
    return () => request.abort();
  }, [source, attempt]);
  const current = result?.source === source && result.attempt === attempt ? result : null;
  return {
    crops: current?.crops ?? null,
    failed: current?.crops === null,
    loading: source !== null && current === null,
    retry: () => setAttempt(value => value + 1),
  };
}

function CoordinateEditor({
  initial, field, onApply,
}: {
  initial: StemCoordinates | null;
  field: PlacementDimensions;
  onApply: (point: StemCoordinates) => void;
}) {
  const { t, i18n } = useTranslation('fields');
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const [x, setX] = useState<number | null>(initial?.x_m ?? null);
  const [y, setY] = useState<number | null>(initial?.y_m ?? null);
  const dimensions = parcelMeters(field);
  const within = dimensions && x !== null && y !== null
    && x >= 0 && y >= 0 && roundMeters(x) <= dimensions.width && roundMeters(y) <= dimensions.height;
  return (
    <Stack spacing={1}>
      {dimensions && <Typography variant="body2" color="text.secondary">{t('individualPlants.coordinateRanges', {
        width: formatLocalizedNumber(dimensions.width, locale, { maximumFractionDigits: 2 }),
        length: formatLocalizedNumber(dimensions.height, locale, { maximumFractionDigits: 2 }),
      })}</Typography>}
      <Stack direction="row" spacing={1}>
        <LocalizedDecimalField fullWidth size="small" label={t('individualPlants.x')} value={x}
          onValueChange={setX} onInvalidValue={() => setX(null)} />
        <LocalizedDecimalField fullWidth size="small" label={t('individualPlants.y')} value={y}
          onValueChange={setY} onInvalidValue={() => setY(null)} />
      </Stack>
      <Button variant="outlined" disabled={!within} onClick={() => {
        if (within && x !== null && y !== null) onApply({ x_m: roundMeters(x), y_m: roundMeters(y) });
      }}>{t(initial ? 'individualPlants.applyCoordinates' : 'individualPlants.addCoordinates')}</Button>
    </Stack>
  );
}

const sectionTitleSx = { fontWeight: 600 } as const;

export function GraphicalIndividualPlantsPanel({
  location, fields, beds, season, controller, placementContext, preview,
  onKeyboardPlacement, onRefreshGeometry, onFocusParent, onClose,
}: {
  location: Location;
  fields: Field[];
  beds: Bed[];
  season: Season;
  controller: IndividualPlantsController;
  placementContext: GraphicPlacementContext | null;
  preview: GraphicPlacementResolution | null;
  onKeyboardPlacement: (direction: Position | null) => void;
  onRefreshGeometry: () => void;
  onFocusParent: (parent: PlacementParent) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['fields', 'plantingPlans', 'common']);
  const tr = (key: string) => t(`fields:individualPlants.${key}`);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const number = (value: number, maxPlaces = 2) => formatLocalizedNumber(value, locale, { maximumFractionDigits: maxPlaces });
  const titleId = useId();
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const { editor, plans, canEdit, update, updateDraft, startDraft, select, changeStem, addStem } = controller;
  const { draft, placing, saving, selectedKey } = editor;
  const parent = editor.parent;
  const containerFor = (reference: PlacementParent | null) => {
    if (reference?.kind === 'location') return reference.id === location.id ? location : undefined;
    return reference?.kind === 'bed' ? beds.find(bed => bed.id === reference.id) : fields.find(field => field.id === reference?.id);
  };
  const container = containerFor(parent);
  const path = parent?.kind === 'bed' && container && 'field' in container
    ? [fields.find(field => field.id === container.field)?.name, container.name].filter(Boolean).join(' · ')
    : container?.name;
  const plan = plans.find(item => item.id === editor.planId);
  const stems = draft?.stems ?? (plan?.individual_positions ?? []).map(stem => ({ ...stem, key: stem.id }));
  const selected = stems.find(stem => stem.key === selectedKey);
  const selectedGraphic = selected && 'graphic' in selected ? selected.graphic : undefined;
  const coordinatesParent = selectedGraphic?.parent ?? parent;
  const coordinatesContainer = containerFor(coordinatesParent);
  const creating = Boolean(draft && !draft.planId);
  const [generationOpen, setGenerationOpen] = useState(false);
  const { crops, failed: cropsFailed, loading: cropsLoading, retry: retryCrops } = usePlacementCrops(
    creating ? 'all' : draft?.crop ?? null,
  );
  const crop = crops?.find(item => item.id === draft?.crop);
  const cultivationTypes = getAllowedCultivationTypesForCrop(crop);
  const spacing = creating
    ? positive(getEffectiveCropValue(crop, 'distance_within_row_cm')) ?? positive(getEffectiveCropValue(crop, 'row_spacing_cm'))
    : null;
  const recommended = spacing === null ? positive(plan?.recommended_plant_spacing_m) : spacing / 100;
  const siteParent: PlacementParent | null = location.id === undefined ? null : { kind: 'location', id: location.id };
  const metricStems = stems.map(stem => ('graphic' in stem && stem.graphic) ? stem.graphic
    : (placementContext && parent && siteParent ? placementContext.projectBetweenParents(parent, siteParent, stem) : null) ?? stem);
  const { pairs, closest } = shortStemSpacing(metricStems, recommended);
  const canopy = draft ? draft.canopy : plan?.estimated_canopy_diameter_m;
  const [invalidCanopy, setInvalidCanopy] = useState(false);
  // Shown directly when a crop suggestion or a saved value exists; otherwise behind an optional disclosure.
  const [canopyShown, setCanopyShown] = useState(false);
  // Every draft starts collapsed again, however the previous one ended (save, cancel or conflict reset).
  if (!draft && canopyShown) setCanopyShown(false);
  const validCanopy = !invalidCanopy && (canopy == null || (
    Number(canopy) >= 0.01 && Number(canopy) <= 99999.99
  ));
  const measured = container ? parcelMeters(container) : null;
  const generationGeometry = parent ? placementContext?.generationGeometry(parent) : null;
  const canAdd = Boolean(draft && placementContext && readyForPlacement(draft, season)
    && stems.length < Math.min(MAX_INDIVIDUAL_POSITIONS, draft.count ?? MAX_INDIVIDUAL_POSITIONS));
  const validCount = draft?.count == null || Number.isInteger(draft.count)
    && draft.count >= stems.length && draft.count > 0 && draft.count <= 2147483647;
  const canRecordPending = draft?.allowCountOnly && validCount && Boolean(draft.count);
  const canSave = Boolean(draft && validCount && validCanopy && !saving && (
    draft.planId ? draft.expectedUpdatedAt : draft.crop && draft.cultivation && (stems.length > 0 || canRecordPending)
      && draft.date >= season.start_date && draft.date <= season.end_date
  ));
  const pending = draft?.count == null ? plan?.pending_plants_count ?? 0 : Math.max(0, draft.count - stems.length);
  const total = draft ? draft.count ?? stems.length : plan?.plants_count ?? stems.length;
  const groups = new Map<string, { parent: PlacementParent; count: number }>();
  for (const stem of draft?.stems ?? []) {
    if (!stem.graphic) continue;
    const { parent } = stem.graphic;
    const key = `${parent.kind}:${parent.id}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { parent, count: 1 });
  }

  const selectCrop = (cropId: number) => {
    const chosen = crops?.find(item => item.id === cropId);
    const general = chosen?.variety && chosen.crop_species
      ? crops?.find(item => item.crop_species === chosen.crop_species && !item.variety) : undefined;
    const allowed = getAllowedCultivationTypesForCrop(chosen);
    setInvalidCanopy(false);
    updateDraft({
      crop: cropId,
      canopy: chosen?.estimated_canopy_diameter_m ?? general?.estimated_canopy_diameter_m,
      cultivation: allowed.includes('purchased_transplant') ? 'purchased_transplant' : allowed[0],
    });
  };

  const closeEditor = () => {
    setInvalidCanopy(false);
    setCanopyShown(false);
    update({ open: false, draft: null, error: null, placing: null });
    onClose();
  };
  const armPlacement = () => {
    update({ placing: 'add' });
    if (parent) onFocusParent(parent);
  };

  return (
    <Paper variant="outlined" component="section" aria-labelledby={titleId} ref={panel}
      tabIndex={-1} data-individual-plants-panel sx={{ minWidth: 0, p: 1.5 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography id={titleId} variant="h6" component="h2">{tr('title')}</Typography>
          <IconButton aria-label={t('common:actions.close')} onClick={closeEditor} disabled={saving}
            sx={{ width: 44, height: 44 }}><CloseIcon /></IconButton>
        </Stack>
        {controller.failed && <Alert severity="error" action={<LoadRetryButton onClick={controller.refresh} />}>{tr('loadFailed')}</Alert>}
        {controller.loading && <Typography role="status" variant="body2">{t('common:messages.loading')}</Typography>}
        {container && (
          <Box data-testid="individual-plants-parcel">
            <Typography variant="caption" color="text.secondary" component="p">
              {parent?.kind === 'location' ? t('fields:graphical.locationSelector')
                : parent?.kind === 'bed' ? t('plantingPlans:columns.bed') : tr('parcel')}
            </Typography>
            <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>{path}</Typography>
          </Box>
        )}
        {draft && !placementContext && <Alert severity="info">{tr('geometryUnknown')}</Alert>}
        {pending > 0 && <Typography role="status" variant="body2">{t('fields:individualPlants.pendingCount', { count: pending, formatted: number(pending, 0) })}</Typography>}

        <Stack component="section" aria-labelledby={`${titleId}-plan`} spacing={1.5}>
          <Typography id={`${titleId}-plan`} variant="subtitle2" component="h3" sx={sectionTitleSx}>{tr('planSection')}</Typography>
          {!draft && plans.length > 0 && (
            <TextField select size="small" label={tr('plan')} value={plan?.id ?? ''} slotProps={{ inputLabel: { shrink: true } }}
              onChange={event => {
                const next = plans.find(item => item.id === Number(event.target.value));
                if (next?.id) select(next.id, planPlacementParent(next), next.individual_positions?.[0]?.id ?? null);
              }}>
              {plans.map(item => <MenuItem key={item.id} value={item.id}>
                {[placementPlanLabel(item, locale), containerFor(planPlacementParent(item))?.name].filter(Boolean).join(' · ')}
              </MenuItem>)}
            </TextField>
          )}
          {!draft && plan && (
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
              {canEdit && parent && <Button variant="outlined" disabled={Boolean(plan.id && controller.movingPlans.has(plan.id))}
                onClick={() => startDraft(parent, plan)}>{tr('edit')}</Button>}
              {plan.id && <Button component={Link} to={plantingPlanDetailPath(plan.id)}>{tr('details')}</Button>}
            </Stack>
          )}
          {!draft && canEdit && location.id !== undefined && (
            <Button variant="outlined" disabled={controller.loading || controller.failed}
              onClick={() => startDraft({ kind: 'location', id: location.id! })}>{tr('newPlan')}</Button>
          )}
          {cropsFailed && <Alert severity="error" action={<LoadRetryButton onClick={retryCrops} />}>{tr('cropsFailed')}</Alert>}
          {creating && <>
            {crops?.length === 0 && <Alert severity="info">{tr('noCrops')}</Alert>}
            <TextField select size="small" label={t('plantingPlans:columns.crop')} disabled={saving || !crops?.length}
              value={draft?.crop ?? ''} slotProps={{ inputLabel: { shrink: true } }} onChange={event => selectCrop(Number(event.target.value))}>
              {(crops ?? []).map(item => <MenuItem key={item.id} value={item.id}>{formatCropDisplayName(item)}</MenuItem>)}
            </TextField>
            <TextField type="date" size="small" label={t('plantingPlans:columns.plantingDate')} disabled={saving}
              value={draft?.date ?? ''} onChange={event => updateDraft({ date: event.target.value })}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: season.start_date, max: season.end_date } }} />
            <TextField select size="small" label={t('plantingPlans:columns.cultivationType')} disabled={saving || !crop}
              value={draft?.cultivation || ''} onChange={event => updateDraft({ cultivation: event.target.value as PlanCultivationType })}>
              {cultivationTypes.map(type => <MenuItem key={type} value={type}>{t(`plantingPlans:cultivationTypesLong.${cultivationLabels[type]}`)}</MenuItem>)}
            </TextField>
          </>}
          {draft && (draft.allowCountOnly || draft.planId && plan?.individual_count != null) && (
            <LocalizedDecimalField size="small" label={tr('exactCount')} value={draft.count}
              error={!validCount} onValueChange={count => updateDraft({ count })}
              onInvalidValue={() => updateDraft({ count: -1 })} disabled={saving} />
          )}
          {draft && (canopyShown || canopy != null || !validCanopy ? (
            <LocalizedDecimalField size="small" label={tr('canopy')} disabled={saving}
              error={!validCanopy} helperText={!validCanopy ? tr('canopyInvalid') : undefined}
              value={canopy} onValueChange={value => {
                setCanopyShown(true);
                setInvalidCanopy(false);
                updateDraft({ canopy: value === null ? null : roundMeters(value) });
              }} onInvalidValue={() => { setCanopyShown(true); setInvalidCanopy(true); }} />
          ) : (
            <Button type="button" variant="text" size="small" sx={{ alignSelf: 'flex-start' }} disabled={saving}
              onClick={() => setCanopyShown(true)}>{tr('addCanopy')}</Button>
          ))}
          {canopy != null && !draft && <Typography variant="body2">{tr('canopy')}{' '}{number(Number(canopy))}</Typography>}
          {(plan || draft) && <SiteSuitabilityHints findings={plan?.site_suitability_findings} scope={parent?.kind} />}
        </Stack>

        {(plan || draft) && <>
          <Divider />
          <Stack component="section" aria-labelledby={`${titleId}-placement`} spacing={1.5}>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'baseline' }}>
              <Typography id={`${titleId}-placement`} variant="subtitle2" component="h3" sx={sectionTitleSx}>
                {tr('placementSection')}
              </Typography>
              <Typography role="status" variant="body2" color="text.secondary">
                {t('fields:individualPlants.count', { count: total, formatted: number(total, 0) })}
              </Typography>
            </Stack>
            {draft && placementContext && (placing ? (
              <Button variant="outlined" onClick={() => update({ placing: null })}>{tr('finishPlaceOnMap')}</Button>
            ) : (
              <Button variant="outlined" disabled={saving || !canAdd} onClick={armPlacement}>{tr('placeOnMap')}</Button>
            ))}
            {draft && measured && generationGeometry && (
              <Button variant="outlined" disabled={saving || !canAdd || cropsLoading || cropsFailed}
                onClick={() => setGenerationOpen(true)}>{tr('generation.title')}</Button>
            )}
            {placing && <Alert role="status" severity={preview && 'error' in preview ? 'warning' : 'info'}>
              {preview ? ('error' in preview ? tr(preview.error)
                : t('fields:individualPlants.predictedParent', { name: preview.frame.name }))
                : tr(!placementContext ? 'geometryUnknown' : canAdd ? 'freePlacementHint' : 'placementNeedsInputs')}
            </Alert>}
            {placing && canAdd && <Button variant="outlined" onClick={() => onKeyboardPlacement(null)} onKeyDown={event => {
              const directions: Record<string, Position> = { ArrowRight: { x: 1, y: 0 }, ArrowLeft: { x: -1, y: 0 },
                ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
              if (!directions[event.key]) return;
              event.preventDefault();
              onKeyboardPlacement(directions[event.key]);
            }}>{tr('placeAtCursor')}</Button>}
            {groups.size > 0 && <Box component="ul" aria-label={tr('parentSummary')} sx={{ my: 0, pl: 3 }}>
              {[...groups].map(([key, { parent, count }]) => <Typography component="li" key={key} variant="body2">
                {containerFor(parent)?.name} · {number(count, 0)}
              </Typography>)}
            </Box>}
            {recommended !== null && (
              <Typography variant="body2">{t('fields:individualPlants.spacing', { distance: number(recommended) })}</Typography>
            )}
            {pairs > 0 && closest !== null && (
              <Alert severity="warning">{t('fields:individualPlants.shortSpacing', { distance: number(closest) })}</Alert>
            )}
            {stems.length > 0 && (
              <Box component="ul" aria-label={tr('position')}
                sx={{ listStyle: 'none', p: 0, m: 0, maxHeight: 180, overflowY: 'auto' }}>
                {stems.map((stem, index) => {
                  const label = t('fields:individualPlants.positionIndex', { index: number(index + 1, 0) });
                  return <Stack key={stem.key} component="li" direction="row" sx={{ alignItems: 'center',
                    contentVisibility: 'auto', containIntrinsicSize: 'auto 44px' }}>
                    <Button disabled={saving} aria-pressed={stem.key === selectedKey} onClick={() => update({ selectedKey: stem.key })}
                      sx={{ flex: 1, justifyContent: 'flex-start', minHeight: 44,
                        bgcolor: stem.key === selectedKey ? 'action.selected' : undefined }}>
                      {label}
                    </Button>
                    {draft && <IconButton disabled={saving || Boolean(draft.planId && stems.length <= 1)}
                      color="error" aria-label={`${tr('removePosition')} · ${label}`}
                      sx={{ width: 44, height: 44 }} onClick={() => changeStem(stem.key, null)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>}
                  </Stack>;
                })}
              </Box>
            )}
            {draft && coordinatesContainer && parcelMeters(coordinatesContainer) && (
              <Box component="fieldset" disabled={saving} sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
                <Stack spacing={1}>
                  {(
                    <Disclosure label={tr('manualCoordinates')}>
                      <Stack spacing={1}>
                        {selected && (
                          <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => update({ selectedKey: null })}>
                            {tr('newPosition')}
                          </Button>
                        )}
                        {(selected || canAdd) && (
                          <CoordinateEditor
                            key={selected ? `${selected.key}:${selected.x_m}:${selected.y_m}` : 'new'}
                            initial={selected ?? null} field={coordinatesContainer}
                            onApply={point => {
                              if (selected && !selectedGraphic) {
                                changeStem(selected.key, point);
                              } else if (coordinatesParent && placementContext) {
                                const resolution = placementContext.resolveLocal(coordinatesParent, point);
                                if ('error' in resolution) update({ error: resolution.error });
                                else if (selected) changeStem(selected.key, { ...resolution.local, graphic: resolution.point });
                                else addStem({ ...resolution.local, graphic: resolution.point });
                              }
                            }} />
                        )}
                      </Stack>
                    </Disclosure>
                  )}
                </Stack>
              </Box>
            )}
          </Stack>
        </>}
        {editor.error && (
          <Alert severity="error" action={editor.error === 'geometryChanged'
            ? <LoadRetryButton onClick={() => { onRefreshGeometry(); update({ error: null }); }} /> : editor.error === 'changedElsewhere'
            ? <LoadRetryButton onClick={() => {
                update({ draft: null, placing: null, error: null });
                setInvalidCanopy(false);
                controller.refresh();
              }} /> : undefined}>{tr(editor.error)}</Alert>
        )}
        {draft && (
          <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button disabled={saving} onClick={() => {
              setInvalidCanopy(false);
              setCanopyShown(false);
              update({ draft: null, error: null, placing: null });
            }}>{t('common:actions.cancel')}</Button>
            <Button variant="contained" disabled={!canSave || placing !== null}
              onClick={() => { void controller.save(placementContext?.scene); }}>
              {t('common:actions.save')}
            </Button>
          </Stack>
        )}
      </Stack>
      {generationOpen && draft && measured && generationGeometry && (
        <IndividualPlantGenerationDialog dimensions={measured} suggestedSpacing={individualCropSpacings(crop)}
          geometry={generationGeometry} countLimit={draft.count ?? undefined}
          occupied={[...draft.stems.flatMap(stem => {
            const parent = stem.graphic?.parent ?? draft.parent;
            const projected = matchesPlacementParent(parent, draft.parent) ? stem
              : placementContext?.projectBetweenParents(parent, draft.parent, stem);
            return projected ? [projected] : [];
          }), ...collectOccupiedPlantPositions({
            parent: draft.parent, plans, planId: draft.planId,
            projectBetweenParents: placementContext?.projectBetweenParents,
            period: individualPlacementPeriod(draft.date, crop, plan),
          })]}
          existingCount={draft.stems.length} onClose={() => setGenerationOpen(false)}
          onConfirm={positions => {
            const resolved = positions.flatMap(point => {
              const result = placementContext?.resolveLocal(draft.parent, point);
              return result && 'local' in result && matchesPlacementParent(result.frame.parent, draft.parent)
                ? [{ ...result.local, graphic: result.point }] : [];
            });
            if (resolved.length !== positions.length) {
              update({ error: 'geometryChanged' });
              return;
            }
            controller.addStems(resolved);
            update({ placing: null });
            setGenerationOpen(false);
          }} />
      )}
    </Paper>
  );
}
