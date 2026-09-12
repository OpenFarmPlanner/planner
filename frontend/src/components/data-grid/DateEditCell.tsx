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
import { formatDateAsGerman, parseGermanDateText, toIsoDateString } from './dateEditCellUtils';
import { useEditCellNavigation } from './EditCellNavigationContext';
import { useEditCellTabNavigation } from './useEditCellTabNavigation';

type DateSegment = 'day' | 'month' | 'year';

const DATE_SEGMENTS: DateSegment[] = ['day', 'month', 'year'];
const SEGMENT_RANGES: Record<DateSegment, [number, number]> = {
  day: [0, 2],
  month: [3, 5],
  year: [6, 10],
};

const toDateValue = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? parseGermanDateText(value) : parsed;
  }
  return null;
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
}

function DateEditCellComponent(params: GridRenderEditCellParams & DateEditCellBoundsProps) {
  const { t } = useTranslation(['plantingPlans', 'common']);
  const editCellNavigation = useEditCellNavigation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const isProgrammaticFocusRef = useRef(false);
  const [text, setText] = useState(formatDateAsGerman(params.value as Date | string | null));
  const [activeSegment, setActiveSegment] = useState<DateSegment>('day');
  const displayedText = params.hasFocus
    ? text
    : formatDateAsGerman(params.value as Date | string | null);

  useEditCellTabNavigation(inputRef, editCellNavigation, params.id, params.field);

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
    inputRef.current?.focus({ preventScroll: true });
    isProgrammaticFocusRef.current = false;
    focusSegment(activeSegment);
  }, [activeSegment, focusSegment, params.hasFocus]);

  const commitDate = useCallback(async (nextValue: Date | null): Promise<void> => {
    setText(formatDateAsGerman(nextValue));
    await params.api.setEditCellValue({
      id: params.id,
      field: params.field,
      value: nextValue,
    });
  }, [params.api, params.field, params.id]);

  const handleTextChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const nextText = event.target.value;
    setText(nextText);

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
    }
  };

  const handleKeyDown = async (event: ReactKeyboardEvent<HTMLInputElement>): Promise<void> => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.stopPropagation();
      return;
    }

    if (event.key === 'Tab' && editCellNavigation?.({
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

    const currentDate = parseGermanDateText(displayedText) ?? toDateValue(params.value) ?? new Date();
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
        value={displayedText}
        placeholder={t('common:dateFormatPlaceholder')}
        sx={{
          '& .MuiInputBase-input': {
            paddingInline: 1,
            paddingInlineEnd: 0,
          },
        }}
        slotProps={{
          htmlInput: {
            tabIndex: params.hasFocus ? 0 : -1,
            inputMode: 'numeric',
            onFocus: (event: FocusEvent<HTMLInputElement>) => {
              if (isProgrammaticFocusRef.current) {
                return;
              }
              selectSegment(getSegmentFromSelection(event.currentTarget.selectionStart));
            },
            onClick: (event: MouseEvent<HTMLInputElement>) => selectSegment(getSegmentFromSelection(event.currentTarget.selectionStart)),
            onKeyDown: handleKeyDown,
          },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={t('dateEditor.openCalendar')}
                  edge="end"
                  size="small"
                  tabIndex={-1}
                  onClick={handleCalendarButtonClick}
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
));
