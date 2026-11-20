import { useId, useState, type FormEvent } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Stack, TextField, useMediaQuery,
} from '@mui/material';
import { isAxiosError } from 'axios';
import { cropLossAPI } from '../api/api';
import type { CropLoss, CropLossCause, CropLossType, CropLossUnit } from '../api/types';
import { useTranslation } from '../i18n';
import { resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { formatLocalizedNumberForInput, parseLocalizedNumber } from '../utils/numberLocalization';
import { ActualPlanDateField } from './PlantingPlanExecutionDates';

const LOSS_TYPES = ['partial', 'total'] satisfies CropLossType[];
const LOSS_CAUSES = ['frost', 'drought', 'waterlogging', 'pests', 'disease', 'other'] satisfies CropLossCause[];
const LOSS_UNITS = ['percent', 'plants', 'sqm'] satisfies CropLossUnit[];

type FormError = 'date' | 'cause' | 'extent' | 'save';

interface CropLossDialogProps {
  planId: number;
  initialDate: string;
  incident?: CropLoss;
  onClose: () => void;
  onSaved: () => void;
}

export function CropLossDialog({ planId, initialDate, incident, onClose, onSaved }: CropLossDialogProps) {
  const { t, i18n } = useTranslation(['plantingPlans', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const titleId = useId();
  const small = useMediaQuery(theme => theme.breakpoints.down('sm'));
  const [date, setDate] = useState(incident?.date ?? initialDate);
  const [lossType, setLossType] = useState<CropLossType>(incident?.loss_type ?? 'partial');
  const [cause, setCause] = useState<CropLossCause | ''>(incident?.cause ?? '');
  const [unit, setUnit] = useState<CropLossUnit>(incident?.extent_unit || 'percent');
  const [extent, setExtent] = useState(() => incident?.extent_value != null
    ? formatLocalizedNumberForInput(Number(incident.extent_value), locale) : '');
  const [note, setNote] = useState(incident?.note ?? '');
  const [error, setError] = useState<FormError>();
  const [saving, setSaving] = useState(false);
  const partial = lossType === 'partial';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!date) { setError('date'); return; }
    if (!cause) { setError('cause'); return; }
    const raw = partial ? extent.trim() : '';
    const amount = raw ? parseLocalizedNumber(raw, locale) : null;
    if (raw && (amount === null || amount < 0 || amount >= 1_000_000_000
      || Math.round(amount * 1_000) / 1_000 !== amount
      || (unit === 'percent' && amount > 100) || (unit === 'plants' && !Number.isInteger(amount)))) {
      setError('extent');
      return;
    }
    const data = {
      date, loss_type: lossType, cause, note,
      extent_value: amount === null ? null : String(amount),
      extent_unit: amount === null ? '' as const : unit,
    };
    setSaving(true);
    setError(undefined);
    try {
      if (incident) await cropLossAPI.patch(incident.id, data);
      else await cropLossAPI.create({ ...data, planting_plan: planId });
      onSaved();
    } catch (err) {
      const response = isAxiosError<Record<string, unknown>>(err) ? err.response?.data : undefined;
      if (response?.date) setError('date');
      else if (response?.cause) setError('cause');
      else if (partial && (response?.extent_unit || response?.extent_value)) setError('extent');
      else setError('save');
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open fullWidth maxWidth="xs" fullScreen={small} aria-labelledby={titleId}
    onClose={saving ? undefined : onClose} slotProps={{ paper: { component: 'form', onSubmit: save } }}>
    <DialogTitle id={titleId}>{t(incident ? 'cropLosses.edit' : 'cropLosses.add')}</DialogTitle>
    <DialogContent>
      <Stack spacing={2} sx={{ pt: 0.5 }}>
        <ActualPlanDateField label={t('cropLosses.date')} value={date} disabled={saving}
          helperText={error === 'date' ? t('cropLosses.errors.date') : undefined} onChange={value => {
            setDate(value);
            if (error === 'date') setError(undefined);
          }} />
        <TextField select label={t('cropLosses.type')} value={lossType} disabled={saving}
          onChange={event => { setLossType(event.target.value as CropLossType); setError(undefined); }}>
          {LOSS_TYPES.map(value => <MenuItem key={value} value={value}>{t(`cropLosses.types.${value}`)}</MenuItem>)}
        </TextField>
        <TextField select label={t('cropLosses.cause')} value={cause} disabled={saving} error={error === 'cause'}
          helperText={error === 'cause' ? t('cropLosses.errors.cause') : undefined}
          onChange={event => {
            setCause(event.target.value as CropLossCause);
            if (error === 'cause') setError(undefined);
          }}>
          {LOSS_CAUSES.map(value => <MenuItem key={value} value={value}>{t(`cropLosses.causes.${value}`)}</MenuItem>)}
        </TextField>
        {partial && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField fullWidth label={t('cropLosses.extent')} value={extent} disabled={saving}
            error={error === 'extent'} helperText={error === 'extent' ? t(`cropLosses.errors.${unit}`) : undefined}
            slotProps={{ htmlInput: { inputMode: unit === 'plants' ? 'numeric' : 'decimal' } }}
            onChange={event => {
              setExtent(event.target.value);
              if (error === 'extent') setError(undefined);
            }} />
          <TextField fullWidth select label={t('cropLosses.unit')} value={unit} disabled={saving}
            onChange={event => { setUnit(event.target.value as CropLossUnit); }}>
            {LOSS_UNITS.map(value => <MenuItem key={value} value={value}>{t(`cropLosses.units.${value}`)}</MenuItem>)}
          </TextField>
        </Stack>}
        <TextField multiline minRows={2} label={t('cropLosses.note')} value={note} disabled={saving}
          onChange={event => setNote(event.target.value)} slotProps={{ htmlInput: { maxLength: 4000 } }} />
        {error === 'save' && <Alert severity="error">{t('cropLosses.errors.save')}</Alert>}
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={saving}>{t('common:actions.cancel')}</Button>
      <Button variant="contained" type="submit" disabled={saving}>{t('common:actions.save')}</Button>
    </DialogActions>
  </Dialog>;
}
