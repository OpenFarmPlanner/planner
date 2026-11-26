import { useState, type FormEvent } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { plantingPlanAPI } from '../api/api';
import type { PlantingPlan } from '../api/types';
import { DetailGrid, DetailRow, DetailSection } from '../components/layout/DetailPrimitives';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { ActualPlanDateField } from './PlantingPlanExecutionDates';

interface PerennialPlanDatesProps {
  plan: PlantingPlan & { id: number };
  editable: boolean;
  onSaved: (plan: PlantingPlan) => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function PerennialPlanDates({ plan, editable, onSaved, onDirtyChange }: PerennialPlanDatesProps) {
  const { t, i18n } = useTranslation(['plantingPlans', 'common']);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const locale = resolveSeasonDateLocale(i18n);
  if (plan.crop_life_cycle !== 'perennial' && !plan.clearing_date) return null;

  const initialDate = plan.clearing_date ?? '';
  const invalidDate = draft !== null && (!draft || !plan.planting_date || draft < plan.planting_date);
  const changeDraft = (value: string | null) => {
    setDraft(value);
    onDirtyChange(value !== null && value !== initialDate);
  };
  const close = () => {
    changeDraft(null);
    setSaveError('');
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || invalidDate || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const area = Number(plan.area_usage_sqm);
      if (plan.bed && plan.planting_date && area > 0) {
        const { data: capacity } = await plantingPlanAPI.remainingArea({
          bed_id: plan.bed, start_date: plan.planting_date, clearing_date: draft,
          crop_id: plan.crop ?? undefined, exclude_plan_id: plan.id,
        });
        if (capacity.has_bed_area && (capacity.unallocated_measured_area_sqm ?? capacity.remaining_area_sqm ?? 0) < area) {
          setSaveError(t('perennial.insufficientArea'));
          return;
        }
      }
      const { data } = await plantingPlanAPI.patch(plan.id, { clearing_date: draft });
      onSaved(data);
      close();
    } catch {
      setSaveError(t('perennial.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailSection title={t('perennial.title')} outlined>
      <Stack spacing={1.25} sx={{ alignItems: 'flex-start' }}>
        <DetailGrid>
          <DetailRow label={t('perennial.productiveLifespan')} value={plan.crop_standing_time_years
            ? t('perennial.years', { count: plan.crop_standing_time_years }) : t('actualDates.missing')} />
          <DetailRow label={t('perennial.clearingDate')} value={plan.clearing_date
            ? formatSeasonDate(plan.clearing_date, locale) : t('actualDates.missing')} />
        </DetailGrid>
        {draft !== null ? (
          <Stack component="form" spacing={1.25} sx={{ width: '100%' }} onSubmit={event => { void save(event); }}>
            <ActualPlanDateField label={t('perennial.clearingDate')} value={draft}
              onChange={changeDraft} disabled={saving} autoFocus
              helperText={invalidDate ? t('perennial.invalidDate') : t('perennial.clearingDateHelp')} />
            {saveError && <Alert severity="error">{saveError}</Alert>}
            <Stack direction="row" spacing={1}>
              <Button onClick={close} disabled={saving}>{t('common:actions.cancel')}</Button>
              <Button type="submit" variant="contained" disabled={saving || invalidDate || draft === initialDate}>
                {t('common:actions.save')}
              </Button>
            </Stack>
          </Stack>
        ) : editable && (
          plan.planting_date
            ? <Button onClick={() => changeDraft(plan.clearing_date ?? plan.suggested_clearing_date ?? '')}>
              {t('perennial.editClearingDate')}
            </Button>
            : <Typography variant="body2" color="text.secondary">{t('perennial.plantingDateRequired')}</Typography>
        )}
      </Stack>
    </DetailSection>
  );
}
