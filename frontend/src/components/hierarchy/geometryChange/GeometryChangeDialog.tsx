import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import axios from 'axios';
import { growingAreaGeometryAPI } from '../../../api/api';
import type {
  GeometryChangeAction,
  GeometryChangePreview,
  GeometryChangeRequest,
  GeometryFactsPayload,
  GeometryFinding,
  GeometryPreviewRequired,
} from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { formatSeasonDate } from '../../../seasons/formatSeasonDate';
import { showGlobalSnackbar } from '../../../utils/globalSnackbar';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../../../utils/numberLocalization';
import { ConfirmationDialog } from '../../feedback/ConfirmationDialog';

const LISTED_PLANS = 5;
const STALE_CODES = new Set(['geometry_preview_stale', 'geometry_version_changed']);

function changeRequest(request: GeometryPreviewRequired, action: GeometryChangeAction): GeometryChangeRequest {
  const { proposed } = request;
  const body: GeometryChangeRequest = {
    kind: request.kind, id: request.id, action,
    length_m: proposed.length_m, width_m: proposed.width_m,
  };
  if (proposed.measurement_basis === 'declared_area') body.area_sqm = proposed.area_sqm;
  if (request.kind !== 'location') body.parent_id = proposed.parent_id;
  if (action === 'physical_change') body.season = request.season;
  else Object.assign(body, { version_id: request.version_id, revision: request.revision });
  return body;
}

function errorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code: unknown = (error.response?.data as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

/** Offers a physical change from the selected season or a correction for a used area (#1634). */
export function GeometryChangeDialog({ request, onDone }: {
  request: GeometryPreviewRequired;
  onDone: (confirmed: boolean) => void;
}) {
  const { t, i18n } = useTranslation(['hierarchy', 'common']);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const locale = resolveLocaleFromLanguage(language);
  const canChangeFromSeason = Boolean(
    request.season && request.season_start && request.version_effective_from
    && request.season_start > request.version_effective_from,
  );
  const initialAction: GeometryChangeAction = canChangeFromSeason ? 'physical_change' : 'correction';
  const [action, setAction] = useState<GeometryChangeAction>(initialAction);
  const actionRef = useRef<GeometryChangeAction>(initialAction);
  const [preview, setPreview] = useState<GeometryChangePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const loadId = useRef(0);

  const number = useCallback(
    (value: number) => formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 }), [locale],
  );
  const date = useCallback((value: string) => formatSeasonDate(value, locale), [locale]);
  const facts = useCallback((value: GeometryFactsPayload) => {
    const area = value.area_sqm === null ? t('hierarchy:geometryChange.unknownArea')
      : t('hierarchy:geometryChange.area', { area: number(value.area_sqm) });
    if (value.length_m === null || value.width_m === null) return area;
    return t('hierarchy:geometryChange.dimensions', {
      length: number(value.length_m), width: number(value.width_m), area,
    });
  }, [number, t]);
  const finding = useCallback((item: GeometryFinding) => t(`hierarchy:geometryChange.findings.${item.code}`, {
    used: number(Number(item.used_area_sqm ?? 0)), area: number(Number(item.area_sqm ?? 0)),
    children: number(Number(item.children_area_sqm ?? 0)),
    date: typeof item.effective_from === 'string' ? date(item.effective_from) : '',
    defaultValue: t('hierarchy:geometryChange.findings.fallback'),
  }), [date, number, t]);

  const fetchPreview = useCallback(async (nextAction: GeometryChangeAction) => {
    const id = ++loadId.current;
    try {
      const { data } = await growingAreaGeometryAPI.preview(changeRequest(request, nextAction));
      if (id === loadId.current) setPreview(data);
    } catch (error) {
      if (id === loadId.current) {
        setProblem(t(`hierarchy:geometryChange.errors.${errorCode(error) ?? 'generic'}`, {
          defaultValue: t('hierarchy:geometryChange.errors.generic'),
        }));
      }
    } finally {
      if (id === loadId.current) setBusy(false);
    }
  }, [request, t]);

  const reload = (nextAction: GeometryChangeAction, notice: string | null = null) => {
    actionRef.current = nextAction;
    setAction(nextAction);
    setBusy(true);
    setPreview(null);
    setProblem(notice);
    void fetchPreview(nextAction);
  };

  useEffect(() => { void fetchPreview(actionRef.current); }, [fetchPreview]);

  const confirm = async () => {
    if (!preview?.token) return;
    setBusy(true);
    try {
      await growingAreaGeometryAPI.confirm(preview.token, crypto.randomUUID());
      showGlobalSnackbar({
        severity: 'success',
        message: action === 'physical_change'
          ? t('hierarchy:geometryChange.savedFromSeason', {
            date: date(preview.effective_from), proposed: facts(preview.proposed) })
          : t('hierarchy:geometryChange.savedCorrection'),
      });
      onDone(true);
    } catch (error) {
      const code = errorCode(error);
      setBusy(false);
      if (code && STALE_CODES.has(code)) {
        reload(action, t('hierarchy:geometryChange.errors.refreshed'));
        return;
      }
      setProblem(t(`hierarchy:geometryChange.errors.${code ?? 'generic'}`, {
        defaultValue: t('hierarchy:geometryChange.errors.generic'),
      }));
    }
  };

  const fromDate = request.version_effective_from ? date(request.version_effective_from) : '';
  const plans = preview?.affected_plans;
  const summary = useMemo(() => t('hierarchy:geometryChange.summary', {
    previous: facts(request.previous), proposed: facts(request.proposed),
  }), [facts, request.previous, request.proposed, t]);
  const title = t('hierarchy:geometryChange.title', { name: request.name ?? '' });

  return (
    <ConfirmationDialog open title={title} maxWidth="sm" fullWidth disableBackdropClose
      messageTypographyProps={{ component: 'div' }}
      message={<Stack spacing={1.5}>
        <Typography variant="body2">{summary}</Typography>
        <RadioGroup value={action} aria-label={title}
          onChange={event => reload(event.target.value as GeometryChangeAction)}>
          <FormControlLabel value="physical_change" disabled={!canChangeFromSeason} control={<Radio />} label={<Stack>
            <Typography variant="body2">{t('hierarchy:geometryChange.physicalChange', {
              season: request.season_label ?? '' })}</Typography>
            <Typography variant="caption" color="text.secondary">{canChangeFromSeason
              ? t('hierarchy:geometryChange.physicalChangeHint', {
                date: request.season_start ? date(request.season_start) : '',
                previous: facts(request.previous) })
              : t('hierarchy:geometryChange.physicalChangeUnavailable')}</Typography>
          </Stack>} />
          <FormControlLabel value="correction" control={<Radio />} label={<Stack>
            <Typography variant="body2">{t('hierarchy:geometryChange.correction')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('hierarchy:geometryChange.correctionHint', { date: fromDate })}</Typography>
          </Stack>} />
        </RadioGroup>
        <Box aria-live="polite">
          {busy && !preview && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={16} />
            <Typography variant="body2">{t('hierarchy:geometryChange.checking')}</Typography>
          </Stack>}
          {preview && <Stack spacing={1}>
            <Typography variant="body2">{t('hierarchy:geometryChange.affectedPlans', {
              count: plans?.count ?? 0, formatted: number(plans?.count ?? 0) })}</Typography>
            {plans && plans.results.length > 0 && <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {plans.results.slice(0, LISTED_PLANS).map(plan => (
                <Typography component="li" variant="body2" key={plan.id} sx={{ overflowWrap: 'anywhere' }}>
                  {plan.label}</Typography>
              ))}
            </Box>}
            {preview.conflicts.map(item => <Alert severity="error" key={`c-${item.code}`}>{finding(item)}</Alert>)}
            {preview.warnings.map(item => <Alert severity="warning" key={`w-${item.code}`}>{finding(item)}</Alert>)}
          </Stack>}
          {problem && <Alert severity="error" sx={{ mt: 1 }}>{problem}</Alert>}
        </Box>
      </Stack>}
      cancelLabel={t('common:actions.cancel')}
      confirmLabel={t('hierarchy:geometryChange.confirm')}
      confirmButtonProps={{ color: 'primary', disabled: busy || !preview?.can_confirm, sx: { whiteSpace: 'nowrap' } }}
      onCancel={() => onDone(false)} onConfirm={() => { void confirm(); }} />
  );
}
