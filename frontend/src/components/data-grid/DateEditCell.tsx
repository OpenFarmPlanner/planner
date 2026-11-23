/**
 * Generic edit cell for date fields in editable data grids.
 */

import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { IconButton, InputAdornment, TextField } from '@mui/material';
import type { GridRenderEditCellParams } from '@mui/x-data-grid';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from '../../i18n';
import { formatDateAsGerman, parseGermanDateText, toGridDateValue, toIsoDateString } from './dateEditCellUtils';
import { useEditCellNavigation } from './EditCellNavigationContext';
import { useEditCellTabNavigation } from './useEditCellTabNavigation';

type DateSegment = 'day' | 'month' | 'year';

const DATE_SEGMENTS: DateSegment[] = ['day', 'month', 'year'];
const SEGMENT_RANGES: Record<DateSegment, [number, number]> = {
  day: [0, 2],
  month: [3, 5],
  year: [6, 10],
};

const getDaysInMonth = (year: number, monthIndex: number): number =>
  new Date(year, monthIndex + 1, 0).getDate();

const createValidDate = (year: number, monthIndex: number, day: number): Date => {
  const clampedDay = Math.min(day, getDaysInMonth(year, monthIndex));
  return new Date(year, monthIndex, clampedDay);
};

const adjustDateSegment = (date: Date, segment: DateSegment, delta: number): Date => {
  if (segment === 'day') {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + delta);
    return nextDate;
  }

  if (segment === 'month') {
    const targetMonthIndex = date.getMonth() + delta;
    const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
    const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
    return createValidDate(targetYear, normalizedMonthIndex, date.getDate());
  }

  return createValidDate(date.getFullYear() + delta, date.getMonth(), date.getDate());
};

const getSegmentFromSelection = (selectionStart: number | null): DateSegment => {
  const cursor = selectionStart ?? 0;
  if (cursor >= SEGMENT_RANGES.year[0]) {
    return 'year';
  }
  if (cursor >= SEGMENT_RANGES.month[0]) {
    return 'month';
  }
  return 'day';
};

/**
 * Optional inclusive bounds. When set, the native date picker is constrained
 * to the range so an out-of-range date can't be picked; typed/arrow-key input
 * is still surfaced through the grid's own validation, not silently clamped.
 */
export interface DateEditCellBoundsProps {
  minDate?: Date | string | null;
  maxDate?: Date | string | null;
  /**
   * Fired whenever this cell commits a concrete date: a successfully parsed
   * typed value, an arrow-key segment adjustment, or a picked calendar date.
   * Not fired for a partial/unparseable typed value, so a caller that
   * live-updates a coupled partner field never acts on incomplete input.
   */
  onCommitted?: (value: Date | null) => void;
  ariaLabel?: string;
  standalone?: {
    initialText?: string;
    onChange: (text: string) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>, text: string) => void;
    onBlur: (event: FocusEvent<HTMLInputElement>, text: string) => void;
    onPick: (value: Date | null) => void;
    errorId?: string;
    readOnly?: boolean;
  };
}

function DateEditCellComponent(params: GridRenderEditCellParams & DateEditCellBoundsProps) {
  const { t } = useTranslation(['plantingPlans', 'common']);
  const editCellNavigation = useEditCellNavigation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const isProgrammaticFocusRef = useRef(false);
  const [text, setText] = useState(() => params.standalone?.initialText
    ?? formatDateAsGerman(params.value as Date | string | null));
  const [activeSegment, setActiveSegment] = useState<DateSegment | null>(
    () => params.standalone?.initialText === undefined ? 'day' : null,
  );
  const displayedText = params.hasFocus || params.standalone
    ? text
    : formatDateAsGerman(params.value as Date | string | null);

  const navigateEditCell = params.standalone ? null : editCellNavigation;
  useEditCellTabNavigation(inputRef, navigateEditCell, params.id, params.field);

  const focusSegment = useCallback((segment: DateSegment): void => {
    const input = inputRef.current;
    const [start, end] = SEGMENT_RANGES[segment];
    window.requestAnimationFrame(() => {
      input?.setSelectionRange(start, end);
    });
  }, []);

  const selectSegment = useCallback((segment: DateSegment): void => {
    setActiveSegment(segment);
    focusSegment(segment);
  }, [focusSegment]);

  useEffect(() => {
    if (!params.hasFocus) {
      return;
    }

    // preventScroll: true — see useEditCellAutoFocus.ts for why an
    // unguarded focus() here fights the mobile keyboard's own scroll
    // adjustment. This effect also re-fires on every segment change
    // (Left/Right arrow), so it's not a one-time mount focus either.
    isProgrammaticFocusRef.current = true;
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    isProgrammaticFocusRef.current = false;
    if (activeSegment) {
      focusSegment(activeSegment);
    } else if (input) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [activeSegment, focusSegment, params.hasFocus]);

  const { api, field, id, onCommitted, standalone } = params;
  const commitDate = useCallback(async (nextValue: Date | null): Promise<void> => {
    const nextText = formatDateAsGerman(nextValue);
    setText(nextText);
    if (standalone) {
      standalone.onChange(nextText);
      return;
    }
    await api.setEditCellValue({ id, field, value: nextValue });
    onCommitted?.(nextValue);
  }, [api, field, id, onCommitted, standalone]);

  const handleTextChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const nextText = event.target.value;
    setText(nextText);
    if (params.standalone) {
      params.standalone.onChange(nextText);
      return;
    }

    if (nextText.trim() === '') {
      await params.api.setEditCellValue({
        id: params.id,
        field: params.field,
        value: null,
      });
      return;
    }

    const parsedDate = parseGermanDateText(nextText);
    if (parsedDate) {
      await params.api.setEditCellValue({
        id: params.id,
        field: params.field,
        value: parsedDate,
      });
      params.onCommitted?.(parsedDate);
    }
  };

  const handleKeyDown = async (event: ReactKeyboardEvent<HTMLInputElement>): Promise<void> => {
    params.standalone?.onKeyDown(event, displayedText);
    if (event.defaultPrevented || params.standalone?.readOnly) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.stopPropagation();
      return;
    }

    if (event.key === 'Tab' && navigateEditCell?.({
      id: params.id,
      field: params.field,
      event: event as ReactKeyboardEvent<HTMLElement>,
    })) {
      return;
    }

    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) {
      return;
    }

    // The DataGrid also consumes arrow keys for cell navigation. While this input is editing,
    // stop propagation so section navigation and value changes stay inside the date editor.
    event.preventDefault();
    event.stopPropagation();

    const currentSegment = getSegmentFromSelection(event.currentTarget.selectionStart);

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const currentIndex = DATE_SEGMENTS.indexOf(currentSegment);
      const nextIndex = event.key === 'ArrowLeft'
        ? Math.max(0, currentIndex - 1)
        : Math.min(DATE_SEGMENTS.length - 1, currentIndex + 1);
      selectSegment(DATE_SEGMENTS[nextIndex]);
      return;
    }

    const currentDate = parseGermanDateText(displayedText) ?? toGridDateValue(params.value) ?? new Date();
    const nextDate = adjustDateSegment(currentDate, currentSegment, event.key === 'ArrowUp' ? 1 : -1);
    await commitDate(nextDate);
    selectSegment(currentSegment);
  };

  const handleCalendarButtonClick = (): void => {
    const pickerInput = pickerInputRef.current;
    if (!pickerInput) {
      return;
    }

    if (typeof pickerInput.showPicker === 'function') {
      pickerInput.showPicker();
      return;
    }

    pickerInput.click();
  };

  const pickerValue = toIsoDateString(parseGermanDateText(displayedText) ?? params.value) ?? '';
  const pickerMin = params.minDate != null ? toIsoDateString(params.minDate) ?? undefined : undefined;
  const pickerMax = params.maxDate != null ? toIsoDateString(params.maxDate) ?? undefined : undefined;

  return (
    <>
      <TextField
        type="text"
        fullWidth
        size="small"
        inputRef={inputRef}
        error={Boolean(params.standalone?.errorId)}
        value={displayedText}
        placeholder={t('common:dateFormatPlaceholder')}
        sx={{
          ...(standalone && {
            '& .MuiOutlinedInput-root': { height: 28, paddingInlineEnd: 0.5 },
            '& .MuiInputAdornment-root': { marginInlineStart: 0 },
          }),
          '& .MuiInputBase-input': {
            paddingInline: 1,
            paddingInlineEnd: 0,
            ...(standalone && { paddingBlock: 0, fontSize: '0.875rem' }),
          },
        }}
        slotProps={{
          htmlInput: {
            'aria-label': params.ariaLabel,
            'aria-describedby': params.standalone?.errorId,
            tabIndex: params.hasFocus ? 0 : -1,
            inputMode: 'numeric',
            enterKeyHint: params.standalone ? 'done' : undefined,
            readOnly: params.standalone?.readOnly,
            onFocus: (event: FocusEvent<HTMLInputElement>) => {
              if (isProgrammaticFocusRef.current || activeSegment === null) {
                return;
              }
              selectSegment(getSegmentFromSelection(event.currentTarget.selectionStart));
            },
            onClick: (event: MouseEvent<HTMLInputElement>) => selectSegment(getSegmentFromSelection(event.currentTarget.selectionStart)),
            onBlur: (event: FocusEvent<HTMLInputElement>) => params.standalone?.onBlur(event, displayedText),
            onKeyDown: handleKeyDown,
          },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={t('dateEditor.openCalendar')}
                  edge={standalone ? false : 'end'}
                  size="small"
                  tabIndex={-1}
                  disabled={params.standalone?.readOnly}
                  onClick={handleCalendarButtonClick}
                  sx={standalone && { p: 0.5 }}
                >
                  <CalendarTodayIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        onChange={(event) => {
          void handleTextChange(event as ChangeEvent<HTMLInputElement>);
        }}
      />
      <input
        ref={pickerInputRef}
        type="date"
        aria-hidden="true"
        tabIndex={-1}
        min={pickerMin}
        max={pickerMax}
        value={pickerValue}
        onChange={(event) => {
          const nextValue = event.target.value ? new Date(`${event.target.value}T00:00:00`) : null;
          void commitDate(nextValue);
          params.standalone?.onPick(nextValue);
          inputRef.current?.focus({ preventScroll: true });
        }}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}

export const DateEditCell = memo(DateEditCellComponent, (previous, next) => (
  previous.id === next.id
  && previous.field === next.field
  && previous.value === next.value
  && previous.hasFocus === next.hasFocus
  && previous.minDate === next.minDate
  && previous.maxDate === next.maxDate
  && previous.ariaLabel === next.ariaLabel
  && previous.standalone === next.standalone
));
