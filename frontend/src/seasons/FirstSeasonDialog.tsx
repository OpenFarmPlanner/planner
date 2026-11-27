import { useId, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { extractApiErrorMessage } from '../api/errors';
import { useTranslation } from '../i18n';
import { computeSeasonLabel, formatSeasonPeriod, resolveSeasonDateLocale } from './formatSeasonDate';
import { computeFirstSeasonPeriod } from './seasonPeriodMath';
import { LegacySeasonPatternNote, SeasonStartMonthField } from './SeasonStartMonthField';

export function FirstSeasonDialog({ defaultYear, defaultMonth, existingDay, onCreate, onClose }: {
  defaultYear: number;
  defaultMonth: number;
  existingDay: number;
  onCreate: (year: number, month: number) => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['navigation', 'common']);
  const titleId = useId();
  const [year, setYear] = useState(String(defaultYear));
  const [month, setMonth] = useState(defaultMonth);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const validYear = /^\d{1,4}$/.test(year) && Number(year) >= 1 && Number(year) <= 9998;
  const preview = validYear ? computeFirstSeasonPeriod(Number(year), month) : null;

  const submit = async () => {
    if (!validYear || saving.current) return;
    saving.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(Number(year), month);
    } catch (cause) {
      setError(extractApiErrorMessage(cause, t, t('navigation:seasonSwitcher.suggestion.createError')));
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={submitting ? undefined : onClose} maxWidth="xs" fullWidth aria-labelledby={titleId}>
      <Stack component="form" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
        <DialogTitle id={titleId}>{t('navigation:firstSeason.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.75 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField autoFocus fullWidth label={t('navigation:firstSeason.year')}
                value={year} onChange={event => setYear(event.target.value)} disabled={submitting}
                error={!validYear} helperText={!validYear ? t('navigation:firstSeason.yearRange') : undefined}
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 4 } }} />
              <SeasonStartMonthField month={month} onChange={setMonth} disabled={submitting} />
            </Stack>
            {preview && <Typography aria-live="polite" sx={{ fontWeight: 600 }}>
              {computeSeasonLabel(preview.start_date, preview.end_date)}
              {' · '}
              {formatSeasonPeriod(preview.start_date, preview.end_date, resolveSeasonDateLocale(i18n))}
            </Typography>}
            <Typography variant="body2" color="text.secondary">{t('navigation:firstSeason.recurs')}</Typography>
            <LegacySeasonPatternNote day={existingDay} month={defaultMonth} />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>{t('common:actions.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!validYear || submitting}>
            {t('navigation:seasonSwitcher.suggestion.create')}
          </Button>
        </DialogActions>
      </Stack>
    </Dialog>
  );
}
