import { memo, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Box, Button, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import type { GridRenderCellParams } from '@mui/x-data-grid';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import { extractApiErrorMessage } from '../api/errors';
import { AppTooltip } from '../components/AppTooltip';
import { DateEditCell } from '../components/data-grid/DateEditCell';
import { buildDialogEditCellKey, useDialogEditCellOpenRequest } from '../components/data-grid/DialogEditCellContext';
import { FullCellTooltip } from '../components/data-grid/FullCellTooltip';
import { parseGermanDateText, toGridDateValue, toIsoDateString } from '../components/data-grid/dateEditCellUtils';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { PlanDateComparisonText } from './PlantingPlanExecutionDates';
import { planDateDeviation, type PlantingPlanDateComparison, type PlantingPlanDateMode } from './plantingPlanActualDates';

import { PLANTING_PLAN_DATE_MODES } from './usePlantingPlanDateMode';

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
      sx={{ minHeight: { xs: 44, sm: 40 }, maxWidth: '100%', textAlign: 'start', whiteSpace: 'nowrap' }}>
      <Box component="span" id={labelId} sx={visuallyHidden}>{t('actualDates.modeLabel')}</Box>
      <span id={valueId}>{t(`actualDates.displayModes.${mode}`)}</span>
    </Button>
    <Menu data-grid-view-control anchorEl={anchor} open={open} onClose={() => setAnchor(null)}
      slotProps={{
        list: { id: menuId, 'aria-labelledby': labelId },
        paper: { sx: { width: (theme) => theme.spacing(40), maxWidth: 'calc(100% - 32px)' } },
      }}>
      {PLANTING_PLAN_DATE_MODES.map(value => <MenuItem key={value} role="menuitemradio" selected={value === mode}
        aria-checked={value === mode} aria-labelledby={`${menuId}-${value}-title`}
        aria-describedby={`${menuId}-${value}-description`}
        sx={{ whiteSpace: 'normal', alignItems: 'flex-start' }} onClick={() => {
          setAnchor(null);
          onChange(value);
        }}>
        <Stack>
          <Typography id={`${menuId}-${value}-title`}>{t(`actualDates.displayModes.${value}`)}</Typography>
          <Typography id={`${menuId}-${value}-description`} variant="body2" color="text.secondary">
            {t(`actualDates.modeDescriptions.${value}`)}
          </Typography>
        </Stack>
      </MenuItem>)}
    </Menu>
  </>;
}

export function DateComparisonTooltipText({ dates, editMode, readOnlyReason }: {
  dates: PlantingPlanDateComparison;
  editMode?: 'planned' | 'actual';
  readOnlyReason?: string | null;
}) {
  const { t } = useTranslation('plantingPlans');
  return <Stack component="span" spacing={0.5}>
    <PlanDateComparisonText dates={dates} />
    {readOnlyReason && <Typography component="span" variant="inherit">{readOnlyReason}</Typography>}
    {editMode && <Typography component="span" variant="inherit">
      {t(`actualDates.editTargets.${editMode}`)}
    </Typography>}
  </Stack>;
}

export const RecordedPlanDateCell = memo(function RecordedPlanDateCell({ dates, hasFocus, editable = false, readOnlyReason }: {
  dates: PlantingPlanDateComparison;
  hasFocus: boolean;
  editable?: boolean;
  readOnlyReason?: string | null;
}) {
  const { i18n } = useTranslation('plantingPlans');
  const deviation = planDateDeviation(dates);
  const title = dates.planned || dates.actual || editable || readOnlyReason
    ? <DateComparisonTooltipText dates={dates} editMode={editable ? 'actual' : undefined} readOnlyReason={readOnlyReason} /> : '';
  return <FullCellTooltip title={title} cellHasFocus={hasFocus} describeChild touchPreview={Boolean(title)}>
      <Typography component="span" variant="body2" sx={{ fontWeight: deviation ? 700 : undefined }}>
        {dates.actual ? formatSeasonDate(dates.actual, resolveSeasonDateLocale(i18n)) : '—'}
      </Typography>
  </FullCellTooltip>;
});

export type ActualPlanDateDrafts = Map<string, { text?: string }>;

interface ActualPlanDateCellProps {
  params: GridRenderCellParams;
  children: ReactNode;
  drafts: ActualPlanDateDrafts;
  getEditDates: () => PlantingPlanDateComparison;
  onSaveActual: (dates: PlantingPlanDateComparison, value: string | null) => Promise<void>;
}

export function ActualPlanDateCell({ params, children, drafts, getEditDates, onSaveActual }: ActualPlanDateCellProps) {
  const { t } = useTranslation(['plantingPlans', 'common']);
  const { api, id, field, hasFocus } = params;
  const cellKey = buildDialogEditCellKey(id, field);
  const [draft, setDraft] = useState(() => drafts.get(cellKey));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  const pending = useRef(false);
  const closing = useRef(false);
  const updateDraft = (next?: { text?: string }) => {
    if (next) drafts.set(cellKey, next);
    else drafts.delete(cellKey);
    setDraft(next);
  };

  useDialogEditCellOpenRequest(id, field, initialKey => {
    api.setCellFocus(id, field);
    if (draft) return;
    const initialText = initialKey && /^\d$/.test(initialKey) ? initialKey : undefined;
    closing.current = false;
    updateDraft({ text: initialText });
    setError('');
  });

  if (!draft) return children;
  const draftText = draft.text;
  const editDates = getEditDates();

  const focusCell = () => {
    api.setCellFocus(id, field);
    window.requestAnimationFrame(() => api.getCellElement(id, field)?.focus({ preventScroll: true }));
  };
  const close = (returnFocus: boolean) => {
    closing.current = true;
    updateDraft();
    if (returnFocus) focusCell();
  };
  const save = async (value: string | null, returnFocus: boolean) => {
    if (closing.current || pending.current) return;
    const target = getEditDates();
    if (value === target.actual) {
      close(returnFocus);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await onSaveActual(target, value);
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
    if (cancel || (tab && draftText === undefined)) {
      close(cancel);
    } else if (invalid) {
      setError(t('actualDates.invalidDate'));
    } else {
      void save(value, !tab);
    }
  };

  return <AppTooltip title={error} open={hasFocus && Boolean(error)}>
    <Box data-grid-dedicated-editor sx={{ width: '100%', minWidth: 0 }}>
      <DateEditCell key={editDates.activity} {...params} value={toGridDateValue(editDates.actual ?? editDates.planned)}
        ariaLabel={t(`actualDates.actualLabels.${editDates.activity}`)}
        standalone={{
          initialText: draftText,
          onChange: text => { updateDraft({ text }); setError(''); },
          onKeyDown: handleKeyDown,
          onBlur: (event, text) => {
            const target = event.relatedTarget;
            if (pending.current || !target?.closest('[role="gridcell"]')
              || target.closest('[data-grid-dedicated-editor], [data-grid-view-control]')) return;
            const value = toIsoDateString(parseGermanDateText(text));
            if (draftText === undefined) close(false);
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
