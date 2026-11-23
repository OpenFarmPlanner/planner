import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Box, Button, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import type { GridRenderCellParams } from '@mui/x-data-grid';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import { extractApiErrorMessage } from '../api/errors';
import { AppTooltip } from '../components/AppTooltip';
import { DateEditCell } from '../components/data-grid/DateEditCell';
import { useDialogEditCellOpenRequest } from '../components/data-grid/DialogEditCellContext';
import { FullCellTooltip } from '../components/data-grid/FullCellTooltip';
import { parseGermanDateText, toGridDateValue, toIsoDateString } from '../components/data-grid/dateEditCellUtils';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { PlanDateComparisonText } from './PlantingPlanExecutionDates';
import { planDateDeviation, type PlantingPlanActivity, type PlantingPlanDateComparison, type PlantingPlanDateMode } from './plantingPlanActualDates';

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

export function RecordedPlanDateCell({ dates, hasFocus, editable = false }: {
  dates: PlantingPlanDateComparison;
  hasFocus: boolean;
  editable?: boolean;
}) {
  const { i18n, t } = useTranslation('plantingPlans');
  const deviation = planDateDeviation(dates);
  const title = dates.planned || dates.actual || editable ? <Stack spacing={0.5}>
    {(dates.planned || dates.actual) && <PlanDateComparisonText dates={dates} />}
    {editable && !dates.actual && <Typography component="span" variant="inherit">{t('actualDates.edit')}</Typography>}
  </Stack> : '';
  return <FullCellTooltip title={title} cellHasFocus={hasFocus} describeChild>
      <Typography component="span" variant="body2" sx={{ fontWeight: deviation ? 700 : undefined }}>
        {dates.actual ? formatSeasonDate(dates.actual, resolveSeasonDateLocale(i18n)) : '—'}
      </Typography>
  </FullCellTooltip>;
}

interface ActualPlanDateCellProps {
  params: GridRenderCellParams;
  children: ReactNode;
  getEditDates: () => PlantingPlanDateComparison;
  onSaveActual: (activity: PlantingPlanActivity, value: string | null) => Promise<void>;
}

export function ActualPlanDateCell({ params, children, getEditDates, onSaveActual }: ActualPlanDateCellProps) {
  const { t } = useTranslation(['plantingPlans', 'common']);
  const [editor, setEditor] = useState<{ dates: PlantingPlanDateComparison; initialText?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  const edited = useRef(false);
  const pending = useRef(false);
  const closing = useRef(false);
  const { api, id, field, hasFocus } = params;

  useDialogEditCellOpenRequest(id, field, initialKey => {
    api.setCellFocus(id, field);
    if (editor) return;
    const initialText = initialKey && /^\d$/.test(initialKey) ? initialKey : undefined;
    closing.current = false;
    edited.current = initialText !== undefined;
    setError('');
    setEditor({ dates: getEditDates(), initialText });
  });

  if (!editor) return children;
  const editDates = editor.dates;

  const focusCell = () => {
    api.setCellFocus(id, field);
    window.requestAnimationFrame(() => api.getCellElement(id, field)?.focus({ preventScroll: true }));
  };
  const close = (returnFocus: boolean) => {
    closing.current = true;
    setEditor(null);
    if (returnFocus) focusCell();
  };
  const save = async (value: string | null, returnFocus: boolean) => {
    if (closing.current || pending.current) return;
    if (value === editDates.actual) {
      close(returnFocus);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await onSaveActual(editDates.activity, value);
      close(returnFocus);
    } catch (failure) {
      setError(extractApiErrorMessage(failure, t, t('actualDates.saveError')));
      api.setCellFocus(id, field);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, text: string) => {
    if (event.nativeEvent.isComposing) return;
    const tab = event.key === 'Tab';
    const cancel = event.key === 'Escape';
    const saveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
    if (!tab && !cancel && event.key !== 'Enter' && !saveShortcut) return;

    const value = toIsoDateString(parseGermanDateText(text));
    const invalid = Boolean(text.trim() && !value);
    if (!tab || invalid || pending.current) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (pending.current) return;
    if (cancel || (tab && !edited.current)) {
      close(cancel);
    } else if (invalid) {
      setError(t('actualDates.invalidDate'));
    } else {
      void save(value, !tab);
    }
  };

  return <AppTooltip title={error} open={hasFocus && Boolean(error)}>
    <Box data-grid-dedicated-editor sx={{ width: '100%', minWidth: 0 }}>
      <DateEditCell {...params} value={toGridDateValue(editDates.actual ?? editDates.planned)}
        ariaLabel={t(`actualDates.actualLabels.${editDates.activity}`)}
        standalone={{
          initialText: editor.initialText,
          onChange: () => { edited.current = true; setError(''); },
          onKeyDown: handleKeyDown,
          onBlur: (event, text) => {
            const target = event.relatedTarget;
            if (pending.current || !target?.closest('[role="gridcell"]')
              || target.closest('[data-grid-dedicated-editor], [data-grid-view-control]')) return;
            const value = toIsoDateString(parseGermanDateText(text));
            if (!edited.current) close(false);
            else if (text.trim() && !value) setError(t('actualDates.invalidDate'));
            else void save(value, false);
          },
          onPick: (date) => { void save(toIsoDateString(date), true); },
          errorId: error ? errorId : undefined,
          readOnly: saving,
        }} />
      {error && <Box component="span" id={errorId} role="alert" sx={visuallyHidden}>{error}</Box>}
    </Box>
  </AppTooltip>;
}
