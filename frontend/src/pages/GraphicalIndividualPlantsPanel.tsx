import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert, Box, Button, IconButton, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Link } from 'react-router';
import { cropAPI } from '../api/api';
import type { Crop, Field, PlantingPlan, PlanCultivationType, Season, StemCoordinates } from '../api/types';
import { LocalizedDecimalField } from '../components/inputs/LocalizedDecimalField';
import LoadRetryButton from '../components/LoadRetryButton';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { getEffectiveCropValue } from '../crops/varietyValueSource';
import { useTranslation } from '../i18n';
import { plantingPlanDetailPath } from '../planting-plans/plantingPlanDetailRoutes';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { formatSeasonDate } from '../seasons/formatSeasonDate';
import { parcelMeters, roundMeters, shortStemSpacing } from './individualPlantGeometry';
import { getAllowedCultivationTypesForCrop } from './plantingPlansUtils';
import { MAX_INDIVIDUAL_POSITIONS, type IndividualPlantsController } from './useIndividualPlants';

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

function usePerennialCrops(enabled: boolean) {
  const [crops, setCrops] = useState<Crop[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    void cropAPI.listAll(request.signal).then(({ results }) => {
      if (!request.signal.aborted) setCrops(results.filter(crop => (
        crop.id && getEffectiveCropValue(crop, 'life_cycle') === 'perennial'
      )));
    }).catch(() => {
      if (!request.signal.aborted) setFailed(true);
    });
    return () => request.abort();
  }, [enabled, attempt]);
  return {
    crops,
    failed,
    retry: () => { setFailed(false); setAttempt(value => value + 1); },
  };
}

function CoordinateEditor({
  initial, field, onApply,
}: {
  initial: StemCoordinates | null;
  field: Field;
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

export function GraphicalIndividualPlantsPanel({
  fields, season, controller, onFocusParcel,
}: {
  fields: Field[];
  season: Season;
  controller: IndividualPlantsController;
  onFocusParcel: (fieldId: number) => void;
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
  const parcel = fields.find(field => field.id === editor.parcel) ?? fields[0];
  const parcelId = parcel?.id;
  const localPlans = plans.filter(plan => plan.parcel === parcelId);
  const plan = localPlans.find(item => item.id === editor.planId);
  const stems = draft?.stems ?? (plan?.individual_positions ?? []).map(stem => ({ ...stem, key: stem.id }));
  const selected = stems.find(stem => stem.key === selectedKey);
  const creating = Boolean(draft && !draft.planId);
  const { crops, failed: cropsFailed, retry: retryCrops } = usePerennialCrops(creating);
  const crop = crops?.find(item => item.id === draft?.crop);
  const cultivationTypes = getAllowedCultivationTypesForCrop(crop);
  const spacing = creating
    ? positive(getEffectiveCropValue(crop, 'distance_within_row_cm')) ?? positive(getEffectiveCropValue(crop, 'row_spacing_cm'))
    : null;
  const recommended = spacing === null ? positive(plan?.recommended_plant_spacing_m) : spacing / 100;
  const { pairs, closest } = shortStemSpacing(stems, recommended);
  const canopy = draft ? draft.canopy : plan?.estimated_canopy_diameter_m;
  const [invalidCanopy, setInvalidCanopy] = useState(false);
  const validCanopy = !invalidCanopy && (canopy == null || (
    Number(canopy) >= 0.01 && Number(canopy) <= 99999.99
  ));
  const canAdd = Boolean(parcel && parcelMeters(parcel) && stems.length < MAX_INDIVIDUAL_POSITIONS);
  const canSave = Boolean(draft && validCanopy && !saving && (
    draft.planId ? draft.expectedUpdatedAt : draft.crop && stems.length > 0 && draft.date >= season.start_date && draft.date <= season.end_date
  ));

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
    update({ open: false, draft: null, error: null, placing: null });
  };
  const armPlacement = (action: 'add' | 'move') => {
    update({ placing: action });
    if (parcelId) onFocusParcel(parcelId);
  };

  return (
    <Paper variant="outlined" component="section" aria-labelledby={titleId} ref={panel}
      tabIndex={-1} data-individual-plants-panel sx={{ minWidth: 0, p: 1.5 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography id={titleId} variant="h6" component="h2">{tr('title')}</Typography>
          <IconButton aria-label={t('common:actions.close')} onClick={closeEditor} disabled={saving}><CloseIcon /></IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary">{tr('legend')}</Typography>
        {controller.failed && <Alert severity="error" action={<LoadRetryButton onClick={controller.refresh} />}>{tr('loadFailed')}</Alert>}
        {controller.loading && <Typography role="status" variant="body2">{t('common:messages.loading')}</Typography>}
        <TextField select size="small" label={tr('parcel')} value={parcelId ?? ''} disabled={!fields.length || Boolean(draft)}
          onChange={event => select(null, Number(event.target.value))}>
          {fields.map(field => <MenuItem key={field.id} value={field.id}>{field.name}</MenuItem>)}
        </TextField>
        {!draft && localPlans.length > 0 && (
          <TextField select size="small" label={tr('plan')} value={plan?.id ?? ''} slotProps={{ inputLabel: { shrink: true } }}
            onChange={event => select(Number(event.target.value), parcelId ?? null)}>
            {localPlans.map(item => <MenuItem key={item.id} value={item.id}>{placementPlanLabel(item, locale)}</MenuItem>)}
          </TextField>
        )}
        {!draft && plan && (
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
            {canEdit && parcelId && <Button variant="outlined" onClick={() => startDraft(parcelId, plan)}>{tr('edit')}</Button>}
            {plan.id && <Button component={Link} to={plantingPlanDetailPath(plan.id)}>{tr('details')}</Button>}
          </Stack>
        )}
        {!draft && canEdit && parcelId && (
          <Button variant="outlined" disabled={!canAdd || controller.loading || controller.failed}
            onClick={() => startDraft(parcelId)}>{tr('newPlan')}</Button>
        )}
        {parcel && !parcelMeters(parcel) && <Alert severity="info">{tr('dimensionsRequired')}</Alert>}
        {creating && <>
          {cropsFailed && <Alert severity="error" action={<LoadRetryButton onClick={retryCrops} />}>{tr('cropsFailed')}</Alert>}
          {crops?.length === 0 && <Alert severity="info">{tr('noPerennials')}</Alert>}
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
        {draft && (
          <LocalizedDecimalField size="small" label={tr('canopy')} disabled={saving}
            error={!validCanopy} helperText={!validCanopy ? tr('canopyInvalid') : undefined}
            value={canopy} onValueChange={value => {
              setInvalidCanopy(false);
              updateDraft({ canopy: value === null ? null : roundMeters(value) });
            }} onInvalidValue={() => setInvalidCanopy(true)} />
        )}
        {(plan || draft) && <>
          <Typography role="status" variant="body2">
            {t('fields:individualPlants.count', { count: stems.length, formatted: number(stems.length, 0) })}
          </Typography>
          {canopy != null && !draft && <Typography variant="body2">{tr('canopy')}{' '}{number(Number(canopy))}</Typography>}
          {recommended !== null && (
            <Typography variant="body2">{t('fields:individualPlants.spacing', { distance: number(recommended) })}</Typography>
          )}
          {pairs > 0 && closest !== null && (
            <Alert severity="warning">{t('fields:individualPlants.shortSpacing', { distance: number(closest) })}</Alert>
          )}
          {stems.length > 0 && (
            <TextField select size="small" label={tr('position')} value={selected?.key ?? ''} disabled={saving}
              onChange={event => update({ selectedKey: event.target.value, placing: null })}>
              {stems.map((stem, index) => (
                <MenuItem key={stem.key} value={stem.key}>
                  {t('fields:individualPlants.positionLabel', { index: number(index + 1, 0), x: number(stem.x_m), y: number(stem.y_m) })}
                </MenuItem>
              ))}
            </TextField>
          )}
        </>}
        {draft && parcel && (
          <Box component="fieldset" disabled={saving} sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
            <Stack spacing={1}>
              {selected && (
                <Button size="small" onClick={() => update({ selectedKey: null })}>{tr('newPosition')}</Button>
              )}
              {(selected || canAdd) && parcelMeters(parcel) && (
                <CoordinateEditor
                  key={selected ? `${selected.key}:${selected.x_m}:${selected.y_m}` : 'new'}
                  initial={selected ?? null} field={parcel}
                  onApply={point => selected ? changeStem(selected.key, point) : addStem(point)} />
              )}
              {selected && <Button color="error" size="small" onClick={() => changeStem(selected.key, null)}>{tr('removePosition')}</Button>}
              {placing ? (
                <Button onClick={() => update({ placing: null })}>{tr('cancelPlaceOnMap')}</Button>
              ) : <>
                {canAdd && <Button variant="outlined" onClick={() => armPlacement('add')}>{tr('placeOnMap')}</Button>}
                {selected && parcelMeters(parcel) && (
                  <Button variant="outlined" onClick={() => armPlacement('move')}>{tr('moveOnMap')}</Button>
                )}
              </>}
              {placing && <Alert role="status" severity="info">{tr(placing === 'add' ? 'placeHint' : 'moveHint')}</Alert>}
            </Stack>
          </Box>
        )}
        {editor.error && (
          <Alert severity="error" action={editor.error === 'changedElsewhere'
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
              update({ draft: null, error: null, placing: null });
            }}>{t('common:actions.cancel')}</Button>
            <Button variant="contained" disabled={!canSave || placing !== null} onClick={() => { void controller.save(); }}>
              {t('common:actions.save')}
            </Button>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
