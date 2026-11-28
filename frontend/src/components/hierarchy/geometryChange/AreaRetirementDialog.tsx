import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import axios from 'axios';
import { growingAreaGeometryAPI } from '../../../api/api';
import type { AreaInUse, GeometryChangePreview, GeometryFinding } from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { formatSeasonDate } from '../../../seasons/formatSeasonDate';
import { showGlobalSnackbar } from '../../../utils/globalSnackbar';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../../../utils/numberLocalization';
import { ConfirmationDialog } from '../../feedback/ConfirmationDialog';

function errorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code: unknown = (error.response?.data as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

/** A used area is retired from the selected season instead of deleted (#1634). */
export function AreaRetirementDialog({ request, onDone }: {
  request: AreaInUse;
  onDone: (retired: boolean) => void;
}) {
  const { t, i18n } = useTranslation(['hierarchy', 'common']);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const [preview, setPreview] = useState<GeometryChangePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(request.season ? null
    : t('hierarchy:geometryChange.errors.geometry_season_required'));
  const [busy, setBusy] = useState(Boolean(request.season));
  const loaded = useRef(false);

  const date = useCallback((value: string) => formatSeasonDate(value, locale), [locale]);
  const finding = useCallback((item: GeometryFinding) => t(`hierarchy:retirement.findings.${item.code}`, {
    count: Number(item.count ?? 0),
    formatted: formatLocalizedNumber(Number(item.count ?? 0), locale),
    date: typeof item.effective_from === 'string' ? date(item.effective_from) : '',
    defaultValue: t('hierarchy:geometryChange.findings.fallback'),
  }), [date, locale, t]);

  const fetchPreview = useCallback(async () => {
    try {
      const { data } = await growingAreaGeometryAPI.preview({
        kind: request.kind, id: request.id, action: 'retirement', season: request.season,
      });
      setPreview(data);
    } catch (error) {
      setProblem(t(`hierarchy:geometryChange.errors.${errorCode(error) ?? 'generic'}`, {
        defaultValue: t('hierarchy:geometryChange.errors.generic'),
      }));
    } finally {
      setBusy(false);
    }
  }, [request, t]);

  useEffect(() => {
    if (!request.season || loaded.current) return;
    loaded.current = true;
    void fetchPreview();
  }, [fetchPreview, request.season]);

  const confirm = async () => {
    if (!preview?.token) return;
    setBusy(true);
    try {
      await growingAreaGeometryAPI.confirm(preview.token, crypto.randomUUID());
      showGlobalSnackbar({
        severity: 'success',
        message: t('hierarchy:retirement.saved', { name: request.name, date: date(preview.effective_from) }),
      });
      onDone(true);
    } catch (error) {
      setBusy(false);
      setProblem(t(`hierarchy:geometryChange.errors.${errorCode(error) ?? 'generic'}`, {
        defaultValue: t('hierarchy:geometryChange.errors.generic'),
      }));
    }
  };

  const title = t('hierarchy:retirement.title', { name: request.name });
  return (
    <ConfirmationDialog open title={title} maxWidth="sm" fullWidth disableBackdropClose
      messageTypographyProps={{ component: 'div' }}
      message={<Stack spacing={1.5}>
        <Typography variant="body2">{t('hierarchy:retirement.explanation', { name: request.name })}</Typography>
        {request.season_start && <Typography variant="body2">{t('hierarchy:retirement.fromSeason', {
          season: request.season_label ?? '', date: date(request.season_start),
        })}</Typography>}
        {busy && !preview && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={16} />
          <Typography variant="body2">{t('hierarchy:geometryChange.checking')}</Typography>
        </Stack>}
        {preview && preview.descendant_count > 0 && <Typography variant="body2">
          {t('hierarchy:retirement.descendants', {
            count: preview.descendant_count,
            formatted: formatLocalizedNumber(preview.descendant_count, locale),
          })}</Typography>}
        {preview?.conflicts.map(item => <Alert severity="error" key={item.code}>{finding(item)}</Alert>)}
        {problem && <Alert severity="error">{problem}</Alert>}
      </Stack>}
      cancelLabel={t('common:actions.cancel')}
      confirmLabel={t('hierarchy:retirement.confirm')}
      confirmButtonProps={{
        color: 'primary', disabled: busy || !preview?.can_confirm, sx: { whiteSpace: 'nowrap' },
      }}
      onCancel={() => onDone(false)} onConfirm={() => { void confirm(); }} />
  );
}
