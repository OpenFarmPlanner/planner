import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { seasonPatternAPI } from '../api/api';
import type { SeasonPatternPreviewResponse } from '../api/types';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { extractApiErrorMessage } from '../api/errors';
import { formatSeasonPeriod, resolveSeasonDateLocale } from './formatSeasonDate';
import { SeasonStartDateFields } from './SeasonStartDateFields';

const sectionCardContentSx = { p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } };

export function SeasonPatternCard({ id, onSaved }: { id?: string; onSaved?: () => void }) {
  const { t, i18n } = useTranslation(['navigation', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const [startDay, setStartDay] = useState(1);
  const [startMonth, setStartMonth] = useState(1);
  const [savedStartDay, setSavedStartDay] = useState(1);
  const [savedStartMonth, setSavedStartMonth] = useState(1);
  const [preview, setPreview] = useState<SeasonPatternPreviewResponse>({
    periods: [],
    reference_season: null,
    transition: null,
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);

  const loadPreview = useCallback(async (day: number, month: number) => {
    try {
      const response = await seasonPatternAPI.preview({ start_day: day, start_month: month });
      setPreview(response.data);
    } catch (error) {
      console.error('Error loading season pattern preview:', error);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await seasonPatternAPI.get();
        setStartDay(response.data.start_day);
        setStartMonth(response.data.start_month);
        setSavedStartDay(response.data.start_day);
        setSavedStartMonth(response.data.start_month);
        await loadPreview(response.data.start_day, response.data.start_month);
      } catch (error) {
        console.error('Error loading season pattern:', error);
      }
    })();
  }, [loadPreview]);

  const handleChange = (day: number, month: number) => {
    setStartDay(day);
    setStartMonth(month);
    void loadPreview(day, month);
  };

  const hasChanges = startDay !== savedStartDay || startMonth !== savedStartMonth;

  const handleCancel = () => {
    setStartDay(savedStartDay);
    setStartMonth(savedStartMonth);
    void loadPreview(savedStartDay, savedStartMonth);
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await seasonPatternAPI.update({ start_day: startDay, start_month: startMonth });
      setSavedStartDay(startDay);
      setSavedStartMonth(startMonth);
      setFeedback({ severity: 'success', message: t('navigation:seasonPattern.saveSuccess') });
      // The due-season suggestion is derived from the pattern; let the app
      // refresh it so a later "create season" uses the new period.
      onSaved?.();
    } catch (saveError) {
      setFeedback({ severity: 'error', message: extractApiErrorMessage(saveError, t, t('navigation:seasonPattern.saveError')) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id={id} variant="outlined" aria-labelledby="project-season-pattern-title" sx={{ scrollMarginTop: 80 }}>
      <CardContent sx={sectionCardContentSx}>
        <Typography id="project-season-pattern-title" variant="h6" sx={{ mb: 2 }}>
          {t('navigation:seasonPattern.title')}
        </Typography>

        <SeasonStartDateFields idPrefix="season-pattern" startDay={startDay} startMonth={startMonth} onChange={handleChange} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>
          {t('navigation:seasonPattern.helper')}
        </Typography>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('navigation:seasonPattern.previewTitle')}</Typography>
        <Table size="small" sx={{ mb: 2 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('navigation:seasonPattern.previewColumnLabel')}</TableCell>
              <TableCell>{t('navigation:seasonPattern.previewColumnPeriod')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {preview.reference_season ? (
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell>{preview.reference_season.label}</TableCell>
                <TableCell>
                  {formatSeasonPeriod(
                    preview.reference_season.start_date,
                    preview.reference_season.end_date,
                    locale,
                  )}
                  {' '}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {t('navigation:seasonPattern.previewReferenceHint')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
            {preview.transition ? (
              <TableRow sx={{ bgcolor: (theme) => alpha(theme.palette.warning.main, 0.12) }}>
                <TableCell sx={{ color: 'warning.dark' }}>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <WarningAmberIcon fontSize="small" />
                    {t(`navigation:seasonPattern.transition.${preview.transition.kind}Label`)}
                  </Stack>
                </TableCell>
                <TableCell sx={{ color: 'warning.dark' }}>
                  {formatSeasonPeriod(
                    preview.transition.start_date,
                    preview.transition.end_date,
                    locale,
                  )}
                  {' '}
                  <Typography component="span" variant="caption" color="warning.dark">
                    {t('navigation:seasonPattern.transition.rowHint')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
            {preview.periods.map((period) => (
              <TableRow key={period.start_date}>
                <TableCell>
                  {new Date(`${period.start_date}T00:00:00`).getFullYear()}
                  {period.is_current ? ` ${t('navigation:seasonPattern.current')}` : ''}
                </TableCell>
                <TableCell>{formatSeasonPeriod(period.start_date, period.end_date, locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Alert severity="info" sx={{ mb: 2 }}>{t('navigation:seasonPattern.changeNotice')}</Alert>

        {feedback ? <Alert severity={feedback.severity} sx={{ mb: 2 }}>{feedback.message}</Alert> : null}

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <DisabledActionTooltip title={saving ? t('common:disabledReasons.busy') : !hasChanges ? t('common:disabledReasons.noChanges') : ''}>
            <Button onClick={handleCancel} disabled={saving || !hasChanges}>{t('navigation:seasonPattern.cancel')}</Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={saving ? t('common:disabledReasons.busy') : !hasChanges ? t('common:disabledReasons.noChanges') : ''}>
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={saving || !hasChanges}
              aria-label={t('navigation:seasonPattern.saveAriaLabel')}
            >
              {t('navigation:seasonPattern.save')}
            </Button>
          </DisabledActionTooltip>
        </Stack>
      </CardContent>
    </Card>
  );
}
