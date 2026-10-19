import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
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
import { seasonAPI, seasonPatternAPI } from '../api/api';
import type { Season, SeasonPatternPreviewResponse } from '../api/types';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { extractApiErrorMessage } from '../api/errors';
import { formatSeasonPeriod, resolveSeasonDateLocale } from './formatSeasonDate';
import { SeasonStartDateFields } from './SeasonStartDateFields';
import { SettingsSection } from '../components/settings/SettingsSection';
import { settingsActionButtonSx, settingsFlatAlertSx } from '../components/settings/settingsStyles';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { buildSeasonPreviewRows } from './seasonPreviewRows';

/** The project-settings section that sets when each season starts. */
export function SeasonPatternCard({ id = 'season-pattern', onSaved }: { id?: string; onSaved?: () => void }) {
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
  const [existingSeasons, setExistingSeasons] = useState<Season[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  useEffect(() => {
    void (async () => {
      try {
        const response = await seasonAPI.list();
        setExistingSeasons(response.data.results);
      } catch (error) {
        // Without the list only the latest existing season is known; the
        // other years are then shown as previews.
        console.error('Error loading seasons:', error);
      }
    })();
  }, []);

  const previewRows = useMemo(
    () => buildSeasonPreviewRows(preview, existingSeasons),
    [preview, existingSeasons],
  );

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
    setSaveError(null);
    try {
      await seasonPatternAPI.update({ start_day: startDay, start_month: startMonth });
      setSavedStartDay(startDay);
      setSavedStartMonth(startMonth);
      showGlobalSnackbar({ message: t('navigation:seasonPattern.saveSuccess'), severity: 'success' });
      // The due-season suggestion is derived from the pattern; let the app
      // refresh it so a later "create season" uses the new period.
      onSaved?.();
    } catch (error) {
      setSaveError(extractApiErrorMessage(error, t, t('navigation:seasonPattern.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const disabledReason = saving ? t('common:disabledReasons.busy') : !hasChanges ? t('common:disabledReasons.noChanges') : '';

  return (
    <SettingsSection
      id={id}
      title={t('navigation:seasonPattern.title')}
      actions={(
        <>
          <DisabledActionTooltip title={disabledReason}>
            <Button onClick={handleCancel} disabled={saving || !hasChanges} sx={settingsActionButtonSx}>
              {t('navigation:seasonPattern.cancel')}
            </Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={disabledReason}>
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={saving || !hasChanges}
              aria-label={t('navigation:seasonPattern.saveAriaLabel')}
              sx={settingsActionButtonSx}
            >
              {t('navigation:seasonPattern.save')}
            </Button>
          </DisabledActionTooltip>
        </>
      )}
    >
      <SeasonStartDateFields idPrefix="season-pattern" startDay={startDay} startMonth={startMonth} onChange={handleChange} />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>
        {t('navigation:seasonPattern.helper')}
      </Typography>

      <Typography component="h3" variant="subtitle2" sx={{ mb: 1 }}>{t('navigation:seasonPattern.previewTitle')}</Typography>
      <Table size="small" sx={{ mb: 2 }}>
        <TableHead>
          <TableRow>
            <TableCell>{t('navigation:seasonPattern.previewColumnLabel')}</TableCell>
            <TableCell>{t('navigation:seasonPattern.previewColumnPeriod')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {previewRows.map((row) => (row.kind === 'transition' ? (
            <TableRow key={`transition-${row.transition.start_date}`} sx={{ bgcolor: (theme) => alpha(theme.palette.warning.main, 0.12) }}>
              <TableCell sx={{ color: 'warning.dark' }}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <WarningAmberIcon fontSize="small" />
                  {t(`navigation:seasonPattern.transition.${row.transition.kind}Label`)}
                </Stack>
              </TableCell>
              <TableCell sx={{ color: 'warning.dark' }}>
                {formatSeasonPeriod(row.transition.start_date, row.transition.end_date, locale)}
                {' '}
                <Typography component="span" variant="caption" color="warning.dark">
                  {t('navigation:seasonPattern.transition.rowHint')}
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            <TableRow key={row.year} sx={row.isLatestExisting ? { bgcolor: 'action.hover' } : undefined}>
              <TableCell>
                {row.label}
                {row.isCurrent ? ` ${t('navigation:seasonPattern.current')}` : ''}
              </TableCell>
              <TableCell>
                {formatSeasonPeriod(row.startDate, row.endDate, locale)}
                {row.isLatestExisting ? (
                  <>
                    {' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {t('navigation:seasonPattern.previewReferenceHint')}
                    </Typography>
                  </>
                ) : null}
                {row.isPreview ? (
                  <>
                    {' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {t('navigation:seasonPattern.previewHint')}
                    </Typography>
                  </>
                ) : null}
              </TableCell>
            </TableRow>
          )))}
        </TableBody>
      </Table>

      <Alert severity="info" sx={settingsFlatAlertSx}>{t('navigation:seasonPattern.changeNotice')}</Alert>

      {saveError ? <Alert severity="error" sx={{ ...settingsFlatAlertSx, mt: 2 }}>{saveError}</Alert> : null}
    </SettingsSection>
  );
}
