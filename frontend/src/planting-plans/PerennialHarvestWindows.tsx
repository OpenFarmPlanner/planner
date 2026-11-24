import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { isAxiosError } from 'axios';
import { plantingPlanAPI } from '../api/api';
import type { HarvestWindowPage, HarvestWindowUpdate, Season, SeasonalHarvestPeriod } from '../api/types';
import { DetailGrid, DetailRow, DetailSection } from '../components/layout/DetailPrimitives';
import { useTranslation } from '../i18n';
import { formatSeasonDate, formatSeasonPeriod, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { ActualPlanDateField } from './PlantingPlanExecutionDates';

interface Props {
  planId: number;
  page: HarvestWindowPage;
  season: Season | null | undefined;
  editable: boolean;
  onSaved: (data: HarvestWindowUpdate, year: number) => void;
  onPageChange: (year: number) => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function PerennialHarvestWindows({ planId, page, season, editable, onSaved, onPageChange, onDirtyChange }: Props) {
  const { t, i18n } = useTranslation(['plantingPlans', 'common']);
  const [year, setYear] = useState<number>();
  const [draft, setDraft] = useState<SeasonalHarvestPeriod | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'invalidWindow' | 'saveFailed'>();
  const selectId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef(false);
  const { occurrences, previous_year: previousYear, next_year: nextYear } = page;
  const selected = occurrences.find(item => item.year === year) ??
    (editable ? occurrences.find(item => item.conflict) : undefined) ??
    occurrences.find(item => {
      const period = item.conflict ? item.default : item.override ?? item.default;
      return season && period && period.start_date <= season.end_date && period.end_date >= season.start_date;
    }) ?? occurrences.find(item => item.default) ?? occurrences[0];

  useEffect(() => {
    if (!draft && !saving && restoreFocus.current) {
      restoreFocus.current = false;
      selectRef.current?.focus();
    }
  }, [draft, saving]);

  const locale = resolveSeasonDateLocale(i18n);
  const formatPeriod = (period: SeasonalHarvestPeriod) => formatSeasonPeriod(period.start_date, period.end_date, locale);
  const currentPeriod = selected?.override ?? selected?.default;
  const hasChanged = (period: SeasonalHarvestPeriod) =>
    period.start_date !== currentPeriod?.start_date || period.end_date !== currentPeriod?.end_date;
  const invalidOrder = Boolean(draft && draft.start_date && draft.end_date && draft.start_date > draft.end_date);
  const canSave = Boolean(draft?.start_date && draft.end_date && !invalidOrder && hasChanged(draft));
  const close = () => {
    restoreFocus.current = true;
    setDraft(null);
    setError(undefined);
    onDirtyChange(false);
  };
  const changeDates = (period: SeasonalHarvestPeriod) => {
    setDraft(period);
    setError(undefined);
    onDirtyChange(hasChanged(period));
  };
  const save = async (period: SeasonalHarvestPeriod | null) => {
    if (!selected || !editable || saving || (period && !canSave)) return;
    setSaving(true);
    setError(undefined);
    try {
      const { data } = period ? await plantingPlanAPI.setHarvestWindow(planId, selected.year, period)
        : await plantingPlanAPI.resetHarvestWindow(planId, selected.year);
      onSaved(data, selected.year);
      close();
    } catch (failure: unknown) {
      setError(isAxiosError(failure) && failure.response?.data?.code === 'invalid_harvest_window'
        ? 'invalidWindow' : 'saveFailed');
    } finally {
      setSaving(false);
    }
  };
  const changePage = (next: number) => {
    setYear(next);
    setError(undefined);
    onPageChange(next);
  };

  return (
    <DetailSection title={t('harvestWindows.title')} outlined>
      {selected ? <Stack spacing={1.25}>
        <TextField id={selectId} select size="small" label={t('harvestWindows.year')} value={selected.year}
          inputRef={selectRef} disabled={Boolean(draft) || saving} slotProps={{ select: { native: true } }}
          onChange={event => { setYear(Number(event.target.value)); setError(undefined); }}
          sx={{ alignSelf: 'flex-start', minWidth: 160, maxWidth: '100%' }}>
          {occurrences.map(item => <option key={item.year} value={item.year}>
            {item.conflict ? t('harvestWindows.yearWithConflict', { year: item.year }) : item.year}
          </option>)}
        </TextField>
        {(previousYear !== null || nextYear !== null) && <Stack direction="row" spacing={1} useFlexGap
          sx={{ flexWrap: 'wrap' }}>
          {previousYear !== null && <Button size="small" disabled={Boolean(draft) || saving}
            onClick={() => changePage(previousYear)}>{t('harvestWindows.previousYears')}</Button>}
          {nextYear !== null && <Button size="small" disabled={Boolean(draft) || saving}
            onClick={() => changePage(nextYear)}>{t('harvestWindows.nextYears')}</Button>}
        </Stack>}
        <DetailGrid>
          <DetailRow label={t('harvestWindows.default')} value={selected.default
            ? formatPeriod(selected.default) : t('actualDates.missing')} />
          {selected.override && <DetailRow label={t('harvestWindows.override')} value={formatPeriod(selected.override)} />}
          {selected.actual_start_date && <DetailRow label={t('actualDates.actualLabels.harvestStart')}
            value={formatSeasonDate(selected.actual_start_date, locale)} />}
          {selected.actual_end_date && <DetailRow label={t('actualDates.actualLabels.harvestEnd')}
            value={formatSeasonDate(selected.actual_end_date, locale)} />}
        </DetailGrid>
        {selected.conflict && <Alert severity="warning">{t('harvestWindows.conflict')}</Alert>}
        {error && <Alert severity="error">{t(`harvestWindows.${error}`)}</Alert>}
        {editable && (draft ? <Stack component="form" spacing={1.25}
          onSubmit={event => { event.preventDefault(); void save(draft); }}
          onKeyDown={event => { if (event.key === 'Escape' && !saving) { event.stopPropagation(); close(); } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            <ActualPlanDateField label={t('columns.harvestStartDate')} value={draft.start_date} disabled={saving}
              autoFocus onChange={start_date => changeDates({ ...draft, start_date })} />
            <ActualPlanDateField label={t('columns.harvestEndDate')} value={draft.end_date} disabled={saving}
              helperText={invalidOrder ? t('harvestWindows.invalidOrder') : undefined}
              onChange={end_date => changeDates({ ...draft, end_date })} />
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={close} disabled={saving}>{t('common:actions.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={saving || !canSave}>
              {t('common:actions.save')}
            </Button>
          </Stack>
        </Stack> : <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {selected.default && <Button disabled={saving} onClick={() => {
            setYear(selected.year);
            setDraft(selected.override ?? selected.default);
            setError(undefined);
          }}>{t('harvestWindows.edit')}</Button>}
          {selected.override && <Button disabled={saving} onClick={() => { setYear(selected.year); void save(null); }}>
            {t('harvestWindows.reset')}
          </Button>}
        </Stack>)}
      </Stack> : <Typography variant="body2" color="text.secondary">{t('harvestWindows.empty')}</Typography>}
    </DetailSection>
  );
}
