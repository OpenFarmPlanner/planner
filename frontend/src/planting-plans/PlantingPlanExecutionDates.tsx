import { useId, useState, type FormEvent } from 'react';
import { Alert, Box, Button, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import { plantingPlanAPI } from '../api/api';
import type { PlantingPlan, PlantingPlanActualDates } from '../api/types';
import { DetailSection } from '../components/layout/DetailPrimitives';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import {
  ACTUAL_DATE_FIELDS, getPlanActivityDates, planDateDeviationLabel, type PlantingPlanDateComparison,
} from './plantingPlanActualDates';

export function ActualPlanDateField({ label, value, onChange, disabled, autoFocus, allowClear, helperText }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  allowClear?: boolean;
  helperText?: string;
}) {
  const { t } = useTranslation('plantingPlans');
  const id = useId();
  return (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Typography component="label" htmlFor={id} variant="body2">{label}</Typography>
      <TextField id={id} type="date" size="small" value={value} disabled={disabled} autoFocus={autoFocus}
        onChange={event => onChange(event.target.value)} helperText={helperText}
        slotProps={{
          formHelperText: helperText ? { 'aria-live': 'polite' } : undefined,
          input: allowClear && value ? { endAdornment: <InputAdornment position="end">
            <IconButton type="button" size="small" disabled={disabled} onClick={() => onChange('')}
              aria-label={`${t('actualDates.clear')} · ${label}`}><ClearIcon fontSize="small" /></IconButton>
          </InputAdornment> } : undefined,
        }} />
    </Stack>
  );
}

export function PlanDateComparisonText({ dates }: { dates: PlantingPlanDateComparison }) {
  const { t, i18n } = useTranslation('plantingPlans');
  const locale = resolveSeasonDateLocale(i18n);
  const dateLabel = (value: string | null) => value ? formatSeasonDate(value, locale) : t('actualDates.missing');
  const plannedLabel = dates.plannedDates?.length
    ? dates.plannedDates.map(dateLabel).join(' · ') : dateLabel(dates.planned);
  const difference = planDateDeviationLabel(dates, t);
  return (
    <Stack component="span" spacing={0.25}>
      <Typography component="span" variant="inherit" sx={{ fontWeight: 600 }}>
        {t(`actualDates.activities.${dates.activity}`)}
      </Typography>
      <Typography component="span" variant="inherit">{t('actualDates.modes.planned')}{' '}
        <Box component="span">{plannedLabel}</Box>
      </Typography>
      <Typography component="span" variant="inherit">{t('actualDates.modes.actual')}{' '}
        <Box component="span">{dateLabel(dates.actual)}</Box>
      </Typography>
      {difference && <Typography component="span" variant="inherit">{difference}</Typography>}
    </Stack>
  );
}

interface PlantingPlanExecutionDatesProps {
  plan: PlantingPlan & { id: number };
  editable: boolean;
  onSaved: (dates: PlantingPlanActualDates & Pick<PlantingPlan, 'seasonal_harvest'>) => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function PlantingPlanExecutionDates({ plan, editable, onSaved, onDirtyChange }: PlantingPlanExecutionDatesProps) {
  const { t, i18n } = useTranslation(['plantingPlans', 'common']);
  const [draft, setDraft] = useState<PlantingPlanActualDates | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const locale = resolveSeasonDateLocale(i18n);
  const dates = getPlanActivityDates(plan);
  const visibleDates = dates.filter(date => date.planned !== null || date.actual !== null);
  const hasChanges = (values: PlantingPlanActualDates) => Object.entries(values).some(([field, value]) =>
    value !== (plan[field as keyof PlantingPlanActualDates] ?? null),
  );

  const close = () => {
    setDraft(null);
    setSaveFailed(false);
    onDirtyChange(false);
  };

  const updateDate = (field: keyof PlantingPlanActualDates, value: string | null) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    onDirtyChange(hasChanges(next));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || saving) return;
    const changes = Object.fromEntries(Object.entries(draft).filter(([field, value]) =>
      (plan[field as keyof PlantingPlanActualDates] ?? null) !== value,
    ));
    if (!Object.keys(changes).length) {
      close();
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    try {
      const { data } = await plantingPlanAPI.patch(plan.id, changes);
      onSaved({
        ...Object.fromEntries(Object.keys(changes).map(field => [field, data[field as keyof PlantingPlanActualDates]])),
        seasonal_harvest: data.seasonal_harvest,
      });
      close();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (!editable && !visibleDates.length) return null;
  return (
    <DetailSection title={t('actualDates.title')} outlined>
      {draft ? (
        <Stack component="form" spacing={1.5} onSubmit={event => { void save(event); }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            {dates.map(date => {
              const field = ACTUAL_DATE_FIELDS[date.activity];
              return (
                <ActualPlanDateField
                  key={field}
                  label={t(`actualDates.actualLabels.${date.activity}`)}
                  value={(field in draft ? draft[field] : plan[field]) ?? ''}
                  onChange={value => updateDate(field, value || null)}
                  disabled={saving}
                  allowClear
                  helperText={date.planned
                    ? `${t('actualDates.modes.planned')} ${formatSeasonDate(date.planned, locale)}` : undefined}
                />
              );
            })}
          </Box>
          {saveFailed && <Alert severity="error">{t('actualDates.saveError')}</Alert>}
          <Stack direction="row" spacing={1.5}>
            <Button onClick={close} disabled={saving}>{t('common:actions.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={saving || !hasChanges(draft)}>{t('common:actions.save')}</Button>
          </Stack>
        </Stack>
      ) : (
        <Stack spacing={1.25} sx={{ alignItems: 'flex-start' }}>
          {visibleDates.length > 0 && <Box component="ul" sx={{
            display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: 1.5, pl: 0, m: 0, listStyle: 'none', width: '100%',
          }}>
            {visibleDates.map(date => (
              <Box key={date.activity} component="li"><PlanDateComparisonText dates={date} /></Box>
            ))}
          </Box>}
          {editable && <Button onClick={() => setDraft({})}>{t('actualDates.edit')}</Button>}
        </Stack>
      )}
    </DetailSection>
  );
}
