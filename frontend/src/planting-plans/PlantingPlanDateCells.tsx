import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Box, Button, IconButton, Popover, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { FullCellTooltip } from '../components/data-grid/FullCellTooltip';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { ActualPlanDateField, PlanDateComparisonText } from './PlantingPlanExecutionDates';
import { planDateDeviation, type PlantingPlanDateComparison, type PlantingPlanDateMode } from './plantingPlanActualDates';

const DATE_MODES: PlantingPlanDateMode[] = ['planned', 'actual', 'combined'];

export function PlantingPlanDateModeToggle({ mode, onChange }: {
  mode: PlantingPlanDateMode;
  onChange: (mode: PlantingPlanDateMode) => void;
}) {
  const { t } = useTranslation('plantingPlans');
  return (
    <ToggleButtonGroup size="small" exclusive value={mode} data-grid-view-control
      aria-label={t('actualDates.modeLabel')}
      onChange={(_, value: PlantingPlanDateMode | null) => { if (value) onChange(value); }}
      sx={{ maxWidth: '100%', '& .MuiToggleButton-root': { textTransform: 'none', px: 1.25, minHeight: 36 } }}>
      {DATE_MODES.map(value => <ToggleButton key={value} value={value}>{t(`actualDates.modes.${value}`)}</ToggleButton>)}
    </ToggleButtonGroup>
  );
}

export function RecordedPlanDateValue({ dates }: { dates: PlantingPlanDateComparison }) {
  const { i18n } = useTranslation('plantingPlans');
  if (!dates.actual) return null;
  const deviation = planDateDeviation(dates);
  return (
    <Stack component="span" direction="row" spacing={0.5} sx={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
      <Typography component="span" variant="body2" sx={{ fontWeight: 700 }}>
        {formatSeasonDate(dates.actual, resolveSeasonDateLocale(i18n))}
      </Typography>
      {deviation === null ? <EventAvailableOutlinedIcon color="action" sx={{ fontSize: 16 }} />
        : deviation === 0 ? <CheckCircleOutlineIcon color="success" sx={{ fontSize: 16 }} />
          : <WarningAmberIcon color="warning" sx={{ fontSize: 16 }} />}
    </Stack>
  );
}

export function RecordedPlanDateCell({ dates, hasFocus }: { dates: PlantingPlanDateComparison; hasFocus: boolean }) {
  if (!dates.actual) return null;
  return (
    <FullCellTooltip title={<PlanDateComparisonText dates={dates} />} cellHasFocus={hasFocus} describeChild>
      <RecordedPlanDateValue dates={dates} />
    </FullCellTooltip>
  );
}

interface InlinePlanDateEditorProps {
  dates: PlantingPlanDateComparison;
  mode: PlantingPlanDateMode;
  hasFocus: boolean;
  renderPlanned?: (ariaLabel: string, leadingAction?: ReactNode, targetLabel?: string) => ReactNode;
  onSaveActual: (value: string | null) => Promise<void>;
}

/** Keeps the existing planned cell editor and offers an explicit actual-date choice. */
export function InlinePlanDateEditor({ dates, mode, hasFocus, renderPlanned, onSaveActual }: InlinePlanDateEditorProps) {
  const { t, i18n } = useTranslation(['plantingPlans', 'common']);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const actualActionRef = useRef<HTMLButtonElement>(null);
  const actualLabel = t(`actualDates.actualLabels.${dates.activity}`);
  const activityLabel = t(`actualDates.activities.${dates.activity}`);
  const plannedLabel = `${t('actualDates.modes.planned')} ${activityLabel}`;
  const showPlanned = mode !== 'actual' && Boolean(renderPlanned);

  useEffect(() => {
    if (hasFocus && !showPlanned) actualActionRef.current?.focus({ preventScroll: true });
  }, [hasFocus, showPlanned]);

  const open = (target: HTMLElement) => {
    setValue(dates.actual ?? '');
    setSaveFailed(false);
    setAnchor(target);
  };
  const close = () => { if (!saving) setAnchor(null); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSaveActual(value || null);
      setAnchor(null);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'planned') return renderPlanned?.(plannedLabel) ?? null;
  return (
    <>
      {showPlanned ? renderPlanned?.(plannedLabel, (
        <IconButton size="small" type="button" tabIndex={hasFocus ? 0 : -1}
          aria-label={`${t('actualDates.editTarget')} · ${activityLabel}`}
          aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
          onClick={event => { event.stopPropagation(); open(event.currentTarget); }}
          sx={{ px: 0.25 }}>
          <ArrowDropDownIcon sx={{ fontSize: 18 }} />
        </IconButton>
      ), t('actualDates.modes.planned')) : (
        <Button type="button" fullWidth ref={actualActionRef} tabIndex={hasFocus ? 0 : -1}
          aria-label={actualLabel} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
          onClick={event => { event.stopPropagation(); open(event.currentTarget); }}
          sx={{ justifyContent: 'flex-start', gap: 0.5, px: 0.75, whiteSpace: 'nowrap', textTransform: 'none' }}>
          {t('actualDates.modes.actual')}
          {dates.actual && formatSeasonDate(dates.actual, resolveSeasonDateLocale(i18n))}
          <ArrowDropDownIcon fontSize="small" />
        </Button>
      )}
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { role: 'dialog', 'aria-label': actualLabel, sx: { maxWidth: 'calc(100vw - 24px)' } } }}>
        <Box component="form" data-grid-view-control onSubmit={event => { void save(event); }}
          onKeyDown={event => event.stopPropagation()}>
          <Stack spacing={1.25} sx={{ p: 1.5, width: 296, maxWidth: '100%', boxSizing: 'border-box' }}>
            {showPlanned && <Stack direction="row" spacing={0.75}>
              <Button type="button" variant="outlined" onClick={close} disabled={saving}>{t('actualDates.modes.planned')}</Button>
              <Button type="button" variant="contained" aria-pressed="true" tabIndex={-1}>
                {t('actualDates.modes.actual')}
              </Button>
            </Stack>}
            <ActualPlanDateField autoFocus label={actualLabel} value={value} disabled={saving} onChange={setValue} />
            {saveFailed && <Alert severity="error">{t('actualDates.saveError')}</Alert>}
            <Stack direction="row" sx={{ justifyContent: 'space-between' }} spacing={0.75}>
              <Button onClick={() => setValue('')} disabled={!value || saving}>{t('actualDates.clear')}</Button>
              <Button type="submit" variant="contained" disabled={saving || (value || null) === dates.actual}>
                {t('common:actions.save')}
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Popover>
    </>
  );
}
