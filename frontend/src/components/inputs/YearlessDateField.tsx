import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { Box, Button, IconButton, InputAdornment, Popover, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createMonthDayFormat, daysInMonth, MONTH_DAY_REFERENCE_YEAR, parseMonthDay, toMonthDay } from '../../utils/monthDay';

const DAYS_PER_ROW = 7;

interface YearlessDateFieldProps {
  label: string;
  pickerLabel: string;
  monthLabel: string;
  daysLabel: string;
  locale: string;
  /** A canonical MM-DD value, an empty string, or null for invalid input. */
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string;
  actions?: ReactNode;
  sx?: SxProps<Theme>;
}

export function YearlessDateField({
  label, pickerLabel, monthLabel, daysLabel, locale, value, onChange, error, actions, sx,
}: YearlessDateFieldProps) {
  const pickerId = useId();
  const [draft, setDraft] = useState<{ value: string | null; text: string } | null>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [month, setMonth] = useState(1);
  const [activeDay, setActiveDay] = useState(1);
  const dayButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const format = useMemo(() => createMonthDayFormat(locale), [locale]);
  const monthFormat = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }), [locale]);
  const dayLabelFormat = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: 'long', day: 'numeric', timeZone: 'UTC',
  }), [locale]);
  const selectedDate = value === null ? null : parseMonthDay(value);
  if (draft && draft.value !== value) setDraft(null);
  const text = draft?.value === value ? draft.text : selectedDate ? format.format(...selectedDate) : value ?? '';
  const monthDays = daysInMonth(month);

  const handleDayNavigation = (event: KeyboardEvent<HTMLButtonElement>, day: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const offsets: Record<string, number> = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -DAYS_PER_ROW, ArrowDown: DAYS_PER_ROW,
    };
    let target: number;
    if (event.key === 'Home') target = 1;
    else if (event.key === 'End') target = monthDays;
    else if (Object.hasOwn(offsets, event.key)) target = Math.min(monthDays, Math.max(1, day + offsets[event.key]));
    else return;
    event.preventDefault();
    dayButtons.current[target - 1]?.focus();
  };

  return (
    <>
      <TextField
        sx={sx}
        label={label}
        placeholder={format.example}
        value={text}
        onChange={event => {
          const next = format.parse(event.target.value);
          setDraft({ value: next, text: event.target.value });
          onChange(next);
        }}
        onBlur={() => { if (value !== null) setDraft(null); }}
        error={Boolean(error)}
        helperText={error}
        slotProps={{
          inputLabel: { shrink: true },
          input: { endAdornment: (
            <InputAdornment position="end" sx={{ gap: 0.25 }}>
              <IconButton
                type="button"
                size="small"
                aria-label={pickerLabel}
                aria-haspopup="dialog"
                aria-expanded={Boolean(anchor)}
                aria-controls={anchor ? pickerId : undefined}
                onClick={event => {
                  setMonth(selectedDate?.[0] ?? new Date().getMonth() + 1);
                  setActiveDay(selectedDate?.[1] ?? 1);
                  setAnchor(event.currentTarget);
                }}
              >
                <CalendarTodayIcon fontSize="small" />
              </IconButton>
              {actions}
            </InputAdornment>
          ) },
        }}
      />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: {
          id: pickerId, role: 'dialog', 'aria-label': pickerLabel,
          sx: { p: 1.5, width: 320 },
        } }}
      >
        <TextField
          autoFocus
          fullWidth
          select
          size="small"
          label={monthLabel}
          value={month}
          onChange={event => {
            const next = Number(event.target.value);
            setMonth(next);
            setActiveDay(selectedDate?.[0] === next ? selectedDate[1] : 1);
          }}
          slotProps={{ select: { native: true } }}
        >
          {Array.from({ length: 12 }, (_, index) => (
            <option value={index + 1} key={index}>
              {monthFormat.format(Date.UTC(MONTH_DAY_REFERENCE_YEAR, index, 1))}
            </option>
          ))}
        </TextField>
        <Box
          role="grid"
          aria-label={daysLabel}
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 1 }}
        >
          {Array.from({ length: Math.ceil(monthDays / DAYS_PER_ROW) }, (_, row) => {
            const firstDay = row * DAYS_PER_ROW + 1;
            const rowLength = Math.min(DAYS_PER_ROW, monthDays - firstDay + 1);
            return (
              <Box key={row} role="row" sx={{ display: 'grid', gridTemplateColumns: `repeat(${DAYS_PER_ROW}, minmax(0, 1fr))`, gap: 0.25 }}>
                {Array.from({ length: rowLength }, (_, column) => {
                  const day = firstDay + column;
                  const selected = selectedDate?.[0] === month && selectedDate[1] === day;
                  return (
                    <Box key={day} role="gridcell" aria-selected={selected}>
                      <Button
                        fullWidth
                        type="button"
                        variant={selected ? 'contained' : 'text'}
                        aria-label={dayLabelFormat.format(Date.UTC(MONTH_DAY_REFERENCE_YEAR, month - 1, day))}
                        tabIndex={day === activeDay ? 0 : -1}
                        ref={element => { dayButtons.current[day - 1] = element; }}
                        onFocus={() => setActiveDay(day)}
                        onKeyDown={event => handleDayNavigation(event, day)}
                        onClick={() => {
                          setDraft(null);
                          onChange(toMonthDay(month, day));
                          setAnchor(null);
                        }}
                        sx={{ minWidth: 0, minHeight: 40, px: 0 }}
                      >
                        {day}
                      </Button>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Popover>
    </>
  );
}
