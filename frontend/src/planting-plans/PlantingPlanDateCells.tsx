import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Box, Button, IconButton, Menu, MenuItem, Popover, Stack, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { FullCellTooltip } from '../components/data-grid/FullCellTooltip';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { ActualPlanDateField, PlanDateComparisonText } from './PlantingPlanExecutionDates';
import { planDateDeviation, planDateDeviationLabel, type PlantingPlanDateComparison, type PlantingPlanDateMode } from './plantingPlanActualDates';

const DATE_MODES: PlantingPlanDateMode[] = ['planned', 'actual', 'combined'];

export function PlantingPlanDateModeSelect({ mode, onChange }: {
  mode: PlantingPlanDateMode;
  onChange: (mode: PlantingPlanDateMode) => void;
}) {
  const { t } = useTranslation('plantingPlans');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const labelId = useId();
  const valueId = useId();
  const open = anchor !== null;
  return <>
    <Button data-grid-view-control variant="outlined" color="primary"
      startIcon={<CalendarTodayOutlinedIcon fontSize="small" />} endIcon={<ArrowDropDownIcon />}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      aria-labelledby={`${labelId} ${valueId}`} onClick={event => setAnchor(event.currentTarget)}
      sx={{ minHeight: { xs: 44, sm: 40 }, maxWidth: '100%', textAlign: 'start' }}>
      <Box component="span" id={labelId} sx={visuallyHidden}>{t('actualDates.modeLabel')}</Box>
      <span id={valueId}>{t(`actualDates.displayModes.${mode}`)}</span>
    </Button>
    <Menu data-grid-view-control anchorEl={anchor} open={open} onClose={() => setAnchor(null)}
      slotProps={{ list: { id: menuId, 'aria-labelledby': labelId } }}>
      {DATE_MODES.map(value => <MenuItem key={value} role="menuitemradio" selected={value === mode}
        aria-checked={value === mode} onClick={() => {
          setAnchor(null);
          onChange(value);
        }}>
        {t(`actualDates.displayModes.${value}`)}
      </MenuItem>)}
    </Menu>
  </>;
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
  const [editor, setEditor] = useState<{ anchor: HTMLElement; mode: PlantingPlanDateMode } | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const actualActionRef = useRef<HTMLButtonElement>(null);
  const actualLabel = t(`actualDates.actualLabels.${dates.activity}`);
  const activityLabel = t(`actualDates.activities.${dates.activity}`);
  const plannedLabel = `${t('actualDates.modes.planned')} ${activityLabel}`;
  const showPlanned = mode !== 'actual' && Boolean(renderPlanned);
  const locale = resolveSeasonDateLocale(i18n);
  const draftDate = value || null;
  const anchor = editor?.mode === mode ? editor.anchor : null;
  if (editor && !anchor) setEditor(null);

  useEffect(() => {
    if (hasFocus && !showPlanned) actualActionRef.current?.focus({ preventScroll: true });
  }, [hasFocus, showPlanned]);

  const open = (target: HTMLElement) => {
    setValue(dates.actual ?? dates.planned ?? '');
    setSaveFailed(false);
    setEditor({ anchor: target, mode });
  };
  const close = () => { if (!saving) setEditor(null); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSaveActual(draftDate);
      setEditor(null);
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
          {dates.actual ? formatSeasonDate(dates.actual, locale) : t('actualDates.modes.actual')}
          <ArrowDropDownIcon fontSize="small" />
        </Button>
      )}
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { role: 'dialog', 'aria-label': actualLabel, sx: { maxWidth: 'calc(100vw - 24px)' } } }}>
        <Box component="form" data-grid-view-control onSubmit={event => { void save(event); }}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              close();
            }
          }}>
          <Stack spacing={1.25} sx={{ p: 1.5, width: 296, maxWidth: '100%', boxSizing: 'border-box' }}>
            {showPlanned && <Stack direction="row" spacing={0.75}>
              <Button type="button" variant="outlined" onClick={close} disabled={saving}>{t('actualDates.modes.planned')}</Button>
              <Button type="button" variant="contained" aria-pressed="true" tabIndex={-1}>
                {t('actualDates.modes.actual')}
              </Button>
            </Stack>}
            {dates.planned && <Typography variant="body2" color="text.secondary">
              <Box component="span" sx={{ fontWeight: 600 }}>{t('actualDates.modes.planned')}</Box>
              {' '}{formatSeasonDate(dates.planned, locale)}
            </Typography>}
            <ActualPlanDateField autoFocus label={actualLabel} value={value} disabled={saving} onChange={setValue}
              helperText={planDateDeviationLabel({ ...dates, actual: draftDate }, t)} />
            {saveFailed && <Alert severity="error">{t('actualDates.saveError')}</Alert>}
            <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 0.5 }}>
              <Button size="small" onClick={() => setValue('')} disabled={!value || saving}>{t('actualDates.clear')}</Button>
              <Stack direction="row" spacing={0.5} sx={{ ml: 'auto' }}>
                <Button size="small" onClick={close} disabled={saving}>{t('common:actions.cancel')}</Button>
                <Button size="small" type="submit" variant="contained" disabled={saving || draftDate === dates.actual}>
                  {t('common:actions.save')}
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Box>
      </Popover>
    </>
  );
}
