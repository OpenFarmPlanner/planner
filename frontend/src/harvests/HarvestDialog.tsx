import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Stack, TextField, Typography, useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { isAxiosError } from 'axios';
import { cropAPI, harvestAPI } from '../api/api';
import type { Crop, HarvestPlanSuggestion, HarvestRecord, HarvestUnit, HarvestWrite } from '../api/types';
import { getCropDisplayName } from '../crops/cropDisplay';
import { useTranslation } from '../i18n';
import { ActualPlanDateField } from '../planting-plans/PlantingPlanExecutionDates';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { formatLocalizedNumberForInput, parseLocalizedNumber } from '../utils/numberLocalization';
import { formatHarvestQuantity, HARVEST_UNITS } from './harvestDisplay';

export interface HarvestPlanContext {
  id: number;
  crop: number;
  cropLabel: string;
  label: string;
}

interface AllocationDraft {
  key: number;
  planId: number | '';
  label: string;
  quantity: string;
  area: string;
  useTotal?: boolean;
}

interface HarvestDialogProps {
  record?: HarvestRecord;
  plan?: HarvestPlanContext;
  initialDate: string;
  onClose: () => void;
  onSaved: () => void;
}

const WEIGHT_FIELDS = {
  piece: 'average_harvest_piece_weight_g',
  bunch: 'average_harvest_bunch_weight_g',
} as const;

const toUnits = (value: number): number => Math.round(value * 1000);
const validPositiveDecimal = (value: number | null, max: number): value is number => (
  value !== null && value > 0 && value <= max && toUnits(value) / 1000 === value
);

export function HarvestDialog({ record, plan, initialDate, onClose, onSaved }: HarvestDialogProps) {
  const { t, i18n } = useTranslation(['harvests', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const inputNumber = (value: number | string | null | undefined): string => (
    value == null ? '' : formatLocalizedNumberForInput(Number(value), locale)
  );
  const small = useMediaQuery('(max-width:599px)');
  const titleId = useId();
  const initialCropId = record?.crop ?? plan?.crop ?? null;
  const [cropId, setCropId] = useState(initialCropId);
  const [crops, setCrops] = useState<Crop[] | null>(null);
  const [cropError, setCropError] = useState(false);
  const [date, setDate] = useState(record?.date ?? initialDate);
  const [quantity, setQuantity] = useState(() => inputNumber(record?.quantity));
  const [chosenUnit, setChosenUnit] = useState<HarvestUnit | null>(record?.unit ?? null);
  const [note, setNote] = useState(record?.note ?? '');
  const [conversion, setConversion] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(Boolean(record?.note || record?.grams_per_unit));
  const [suggestions, setSuggestions] = useState<HarvestPlanSuggestion[]>([]);
  const [suggestionState, setSuggestionState] = useState({ key: '', error: false });
  const [allocations, setAllocations] = useState<AllocationDraft[]>(() => record
    ? record.allocations.map((row, key) => ({
      key, planId: row.planting_plan,
      label: [row.bed_name || row.parcel_name, row.season_label].filter(Boolean).join(' · '),
      quantity: inputNumber(row.quantity), area: inputNumber(row.harvested_area_sqm),
    }))
    : plan ? [{ key: 0, planId: plan.id, label: plan.label, quantity: '', area: '', useTotal: true }] : []);
  const nextAllocation = useRef(allocations.length);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedCrop = crops?.find(crop => crop.id === cropId);
  const loadingCrops = crops === null && !cropError;
  const unit = chosenUnit || selectedCrop?.effective_values?.default_harvest_unit
    || selectedCrop?.default_harvest_unit || 'kg';
  const conversionField = unit === 'piece' || unit === 'bunch' ? WEIGHT_FIELDS[unit] : null;
  const unchangedConversion = record?.crop === cropId && record.unit === unit;
  const cropWeight = conversionField && (selectedCrop?.effective_values?.[conversionField]
    ?? selectedCrop?.[conversionField]);
  const factorDraft = conversion ?? inputNumber(unchangedConversion ? record.grams_per_unit : cropWeight || null);
  const total = parseLocalizedNumber(quantity, locale);
  const factor = parseLocalizedNumber(factorDraft, locale);
  const allocated = allocations.reduce((sum, row) => sum + toUnits(
    parseLocalizedNumber(row.useTotal ? quantity : row.quantity, locale) ?? 0,
  ), 0);
  const remaining = (toUnits(total ?? 0) - allocated) / 1000;
  const suggestionKey = cropId && date ? `${cropId}:${date}` : '';
  const matchingPlans = suggestionState.key === suggestionKey ? suggestions : [];

  useEffect(() => {
    const controller = new AbortController();
    void cropAPI.listAll(controller.signal).then(({ results }) => {
      if (!controller.signal.aborted) setCrops(results);
    }).catch(() => {
      if (!controller.signal.aborted) setCropError(true);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (cropId === null || !date) return;
    const controller = new AbortController();
    void harvestAPI.suggestions(cropId, date, controller.signal).then(({ data }) => {
      if (controller.signal.aborted) return;
      setSuggestions(data);
      setSuggestionState({ key: suggestionKey, error: false });
    }).catch(() => {
      if (controller.signal.aborted) return;
      setSuggestions([]);
      setSuggestionState({ key: suggestionKey, error: true });
    });
    return () => controller.abort();
  }, [cropId, date, suggestionKey]);

  const cropOptions = (crops ?? []).map(crop => ({ id: crop.id!, name: getCropDisplayName(crop) }));
  const originalCropLabel = record?.crop_label ?? plan?.cropLabel;
  if (initialCropId !== null && originalCropLabel && !cropOptions.some(option => option.id === initialCropId)) {
    cropOptions.unshift({ id: initialCropId, name: originalCropLabel });
  }

  const suggestionLabel = (suggestion: HarvestPlanSuggestion): string => [
    [suggestion.field_name, suggestion.bed_name].filter(Boolean).join(' | ') || t('noBed'),
    suggestion.season_label,
    suggestion.planting_date ? formatSeasonDate(suggestion.planting_date, locale) : '',
  ].filter(Boolean).join(' · ');

  const changeAllocation = (key: number, update: Partial<AllocationDraft>) => {
    setAllocations(current => current.map(row => row.key === key ? { ...row, ...update } : row));
  };

  const save = async (event: FormEvent<HTMLElement>) => {
    event.preventDefault();
    if (saving) return;
    setErrors({});
    const nextErrors: Record<string, string> = {};
    if (cropId === null) nextErrors.crop = t('errors.crop');
    if (!date) nextErrors.date = t('errors.date');
    if (!validPositiveDecimal(total, 999999999.999)) nextErrors.quantity = t('errors.quantity');
    if (conversionField && factorDraft.trim() && !validPositiveDecimal(factor, 9999999.999)) {
      nextErrors.factor = t('errors.factor');
    }
    const rows: NonNullable<HarvestWrite['allocations']> = [];
    for (const row of allocations) {
      const amount = parseLocalizedNumber(row.useTotal ? quantity : row.quantity, locale);
      const area = parseLocalizedNumber(row.area, locale);
      if (row.planId === '' || !validPositiveDecimal(amount, 999999999.999)
        || (row.area.trim() && !validPositiveDecimal(area, 9999999.999))) {
        nextErrors.allocations = t('errors.assignment');
      } else {
        rows.push({ planting_plan: row.planId, quantity: String(amount), harvested_area_sqm: area === null ? null : String(area) });
      }
    }
    if (remaining < 0) nextErrors.allocations = t('errors.overAllocated');
    if (new Set(rows.map(row => row.planting_plan)).size < rows.length) nextErrors.allocations = t('errors.duplicatePlan');
    if (Object.keys(nextErrors).length || cropId === null || total === null) {
      setErrors(nextErrors);
      return;
    }
    const allocationsChanged = !record || record.allocations.length !== rows.length || rows.some((row, index) => {
      const previous = record.allocations[index];
      return row.planting_plan !== previous.planting_plan || Number(row.quantity) !== Number(previous.quantity)
        || Number(row.harvested_area_sqm) !== Number(previous.harvested_area_sqm);
    });
    const payload: HarvestWrite = {
      crop: cropId, unit, date, quantity: String(total), note,
      ...(conversionField && conversion !== null ? { grams_per_unit: factor === null ? null : String(factor) } : {}),
      ...(allocationsChanged ? { allocations: rows } : {}),
    };
    setSaving(true);
    try {
      if (record) await harvestAPI.patch(record.id, payload);
      else await harvestAPI.create(payload);
      onSaved();
    } catch (error) {
      const data = isAxiosError<Record<string, unknown>>(error) ? error.response?.data : undefined;
      setErrors(data?.allocations ? { allocations: t('errors.assignmentRejected') }
        : data?.grams_per_unit ? { factor: t('errors.factor') }
          : data?.quantity ? { quantity: t('errors.quantity') } : { save: t('errors.save') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open fullScreen={small} fullWidth maxWidth="sm" onClose={saving ? undefined : onClose}
      aria-labelledby={titleId} slotProps={{ paper: { component: 'form', onSubmit: save } }}>
      <DialogTitle id={titleId}>{record ? t('edit') : t('add')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {cropError && <Alert severity="error">{t('errors.crops')}</Alert>}
          <Autocomplete options={cropOptions} getOptionLabel={option => option.name}
            value={cropOptions.find(option => option.id === cropId) ?? null}
            isOptionEqualToValue={(left, right) => left.id === right.id} loading={loadingCrops} disabled={saving}
            onChange={(_event, option) => {
              if (quantity.trim() || chosenUnit !== null) setChosenUnit(unit);
              setCropId(option?.id ?? null);
              setConversion(null);
            }}
            renderInput={params => <TextField {...params} label={t('crop')} error={!!errors.crop} helperText={errors.crop} />} />
          <ActualPlanDateField label={t('date')} value={date} onChange={setDate} disabled={saving} helperText={errors.date} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField fullWidth label={t('quantity')} value={quantity} onChange={event => setQuantity(event.target.value)}
              error={!!errors.quantity} helperText={errors.quantity} disabled={saving || loadingCrops}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
            <TextField fullWidth select label={t('unit')} value={unit} disabled={saving || loadingCrops}
              onChange={event => { setChosenUnit(event.target.value as HarvestUnit); setConversion(null); }}>
              {HARVEST_UNITS.map(item => <MenuItem key={item} value={item}>{t(`units.${item}`)}</MenuItem>)}
            </TextField>
          </Stack>
          <Stack spacing={1.25}>
            <Typography component="h2" variant="subtitle1">{t('assignments')}</Typography>
            {allocations.length === 0 && <Typography variant="body2" color="text.secondary">{t('unassigned')}</Typography>}
            {allocations.map((row, index) => {
              const available = matchingPlans.filter(option => !allocations.some(item => item.key !== row.key && item.planId === option.id));
              const hasSelection = available.some(option => option.id === row.planId);
              return <Stack key={row.key} spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.25 }}>
                <Stack direction="row" spacing={1}>
                  <TextField select fullWidth size="small" label={t('assignmentPlan', { number: index + 1 })}
                    value={row.planId} disabled={saving} onChange={event => {
                      const id = Number(event.target.value);
                      const option = available.find(item => item.id === id);
                      if (option) changeAllocation(row.key, { planId: id, label: suggestionLabel(option) });
                    }}>
                    <MenuItem value="">{t('choosePlan')}</MenuItem>
                    {!hasSelection && row.planId !== '' && <MenuItem value={row.planId}>{row.label || t('planNumber', { id: row.planId })}</MenuItem>}
                    {available.map(option => <MenuItem key={option.id} value={option.id} sx={{ whiteSpace: 'normal' }}>
                      {suggestionLabel(option)}
                    </MenuItem>)}
                  </TextField>
                  <IconButton aria-label={t('removeAssignment', { number: index + 1 })} disabled={saving}
                    onClick={() => setAllocations(current => current.filter(item => item.key !== row.key))} sx={{ width: 44, height: 44 }}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <TextField size="small" value={row.useTotal ? quantity : row.quantity} label={t('assignedQuantity')}
                  disabled={saving} onChange={event => changeAllocation(row.key, { quantity: event.target.value, useTotal: false })}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
                {(showOptional || !!row.area) && <TextField size="small" value={row.area} label={t('harvestedArea')}
                  disabled={saving} onChange={event => changeAllocation(row.key, { area: event.target.value })}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }} />}
              </Stack>;
            })}
            {suggestionKey && suggestionState.key === suggestionKey && matchingPlans.length === 0 && (
              <Typography color="text.secondary" variant="body2">
                {suggestionState.error ? t('errors.suggestions') : t('noSuggestions')}
              </Typography>
            )}
            {matchingPlans.some(option => !allocations.some(row => row.planId === option.id)) && (
              <Button startIcon={<AddIcon />} disabled={saving} sx={{ alignSelf: 'flex-start' }} onClick={() => {
                const key = nextAllocation.current++;
                setAllocations(current => [...current, { key, planId: '', label: '', quantity: '', area: '' }]);
              }}>{t('addAssignment')}</Button>
            )}
            {total !== null && <Typography variant="body2" aria-live="polite">
              {t('allocationTotals', {
                total: formatHarvestQuantity(total, unit, locale, t),
                assigned: formatHarvestQuantity(allocated / 1000, unit, locale, t),
                remaining: formatHarvestQuantity(remaining, unit, locale, t),
              })}
            </Typography>}
            {errors.allocations && <Alert severity="error">{errors.allocations}</Alert>}
          </Stack>
          {!showOptional && <Button onClick={() => setShowOptional(true)} sx={{ alignSelf: 'flex-start' }}>{t('addDetails')}</Button>}
          {showOptional && <Stack spacing={1.5}>
            <TextField multiline minRows={2} label={t('note')} value={note} disabled={saving}
              onChange={event => setNote(event.target.value)} slotProps={{ htmlInput: { maxLength: 10000 } }} />
            {conversionField && <TextField value={factorDraft} disabled={saving} label={t(unit === 'piece' ? 'pieceWeight' : 'bunchWeight')}
              onChange={event => setConversion(event.target.value)} error={!!errors.factor}
              helperText={errors.factor || (conversion === null && unchangedConversion && record.conversion_source
                ? t(`conversionSources.${record.conversion_source}`) : t('conversionHelp'))}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }} />}
          </Stack>}
          {conversionField && factor !== null && factor > 0 && total !== null && total > 0 && (
            <Box color="text.secondary"><Typography variant="body2">{t('estimatedWeight', {
              quantity: formatHarvestQuantity(total * factor / 1000, 'kg', locale, t),
            })}</Typography></Box>
          )}
          {errors.save && <Alert severity="error">{errors.save}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" type="submit" disabled={saving || loadingCrops}>{t('common:actions.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}
