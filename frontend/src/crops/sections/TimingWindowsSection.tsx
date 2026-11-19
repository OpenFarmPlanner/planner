/**
 * TimingWindowsSection: the crop's Anzucht, Direktsaat and Pflanzung windows,
 * one group per kind with any number of rows (no harvest windows: the harvest
 * follows from planting and growth duration). A row is in thirds of
 * a month or in calendar weeks (docs/timing-windows.md).
 * @remarks Row identities are local to the editor. The windows live in the form.
 */
import { useState, type ChangeEvent } from 'react';
import {
  Box,
  Button,
  FormHelperText,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { TFunction } from 'i18next';

import type { CropTimingWindow, TimingWindowDecade, TimingWindowKind, TimingWindowUnit } from '../../api/types';
import {
  segmentedToggleButtonGroupSx,
  segmentedToggleButtonSx,
} from '../../components/buttons/segmentedControlStyles';
import { FieldInfoIcon } from '../FieldInfoIcon';
import {
  MAX_ISO_WEEK,
  TIMING_WINDOW_DECADES,
  TIMING_WINDOW_KINDS,
  emptyTimingWindow,
  wrapsYearEnd,
} from '../timingWindows';

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const WEEKS = Array.from({ length: MAX_ISO_WEEK }, (_, index) => index + 1);

interface TimingWindowsSectionProps {
  windows: CropTimingWindow[];
  errors: Record<string, string>;
  onChange: (windows: CropTimingWindow[]) => void;
  t: TFunction;
  /** Variety highlight per kind (own windows vs. the Kultur's), like the other fields. */
  getKindHighlightSx?: (kind: TimingWindowKind) => SxProps<Theme> | undefined;
}

const selectSx = {
  flexShrink: 0,
  '& .MuiInputBase-root': { fontSize: '0.875rem', minHeight: (theme: Theme) => theme.spacing(5) },
  '& .MuiNativeSelect-select.MuiInputBase-input': { paddingInlineStart: 1, paddingInlineEnd: 3.5 },
} as const;
const endpointSx = { display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' } as const;
const categoryGridSx = {
  display: 'grid',
  // A column needs room for a month plus a month-third selector and their label.
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16.75rem), 1fr))',
  alignItems: 'start',
  gap: 2,
} as const;

type EndpointField = 'start_month' | 'start_decade' | 'end_month' | 'end_decade' | 'start_week' | 'end_week';

interface TimingWindowRowProps {
  window: CropTimingWindow;
  error?: string;
  t: TFunction;
  onChange: (window: CropTimingWindow) => void;
  onRemove: () => void;
}

interface TimingWindowDraftRow {
  id: number;
  window: CropTimingWindow;
}

interface TimingWindowRows {
  rows: TimingWindowDraftRow[];
  nextId: number;
}

function TimingWindowRow({ window, error, t, onChange, onRemove }: TimingWindowRowProps) {
  const setField = (field: EndpointField) => (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value;
    const value = raw === '' ? null : field.endsWith('_decade') ? raw as TimingWindowDecade : Number(raw);
    onChange({ ...window, [field]: value });
  };
  const nativeSelect = (field: EndpointField, label: string, options: Array<{ value: string; label: string }>) => (
    <TextField
      select
      size="small"
      value={window[field] ?? ''}
      onChange={setField(field)}
      error={Boolean(error) && window[field] === null}
      sx={selectSx}
      slotProps={{
        select: { native: true },
        htmlInput: { 'aria-label': label },
      }}
    >
      <option value="">–</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </TextField>
  );
  const monthOptions = MONTH_KEYS.map((key, index) => ({ value: String(index + 1), label: t(`common:months.${key}`) }));
  const decadeOptions = TIMING_WINDOW_DECADES.map((decade) => ({ value: decade, label: t(`timingWindows.decades.${decade}`) }));
  const weekOptions = WEEKS.map((week) => ({ value: String(week), label: t('timingWindows.weekOption', { week }) }));

  const endpoint = (side: 'start' | 'end') => {
    const sideLabel = t(side === 'start' ? 'timingWindows.from' : 'timingWindows.to');
    return (
      <Box sx={endpointSx}>
        <Typography variant="body2" component="span" sx={{ minWidth: 32 }}>{sideLabel}</Typography>
        {window.unit === 'decade' ? (
          <>
            {nativeSelect(`${side}_decade`, `${sideLabel}: ${t('timingWindows.decade')}`, decadeOptions)}
            {nativeSelect(`${side}_month`, `${sideLabel}: ${t('timingWindows.month')}`, monthOptions)}
          </>
        ) : (
          nativeSelect(`${side}_week`, `${sideLabel}: ${t('timingWindows.week')}`, weekOptions)
        )}
      </Box>
    );
  };

  return (
    <Box data-testid="timing-window-row" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <ToggleButtonGroup
          value={window.unit}
          exclusive
          size="small"
          color="primary"
          aria-label={t('timingWindows.unitLabel')}
          sx={segmentedToggleButtonGroupSx}
          onChange={(_, unit: TimingWindowUnit | null) => {
            if (unit !== null && unit !== window.unit) {
              onChange(emptyTimingWindow(window.kind, unit));
            }
          }}
        >
          <ToggleButton value="decade" sx={segmentedToggleButtonSx}>{t('timingWindows.unitMonth')}</ToggleButton>
          <ToggleButton value="iso_week" sx={segmentedToggleButtonSx}>{t('timingWindows.unitWeek')}</ToggleButton>
        </ToggleButtonGroup>
        <IconButton color="error" onClick={onRemove} aria-label={t('timingWindows.removeWindow')}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 2, rowGap: 1, flexWrap: 'wrap' }}>
        {endpoint('start')}
        {endpoint('end')}
      </Box>
      {wrapsYearEnd(window) ? (
        <FormHelperText>{t('timingWindows.wrapsYearEnd')}</FormHelperText>
      ) : null}
      {error ? <FormHelperText error>{error}</FormHelperText> : null}
    </Box>
  );
}

export function TimingWindowsSection({ windows, errors, onChange, t, getKindHighlightSx }: TimingWindowsSectionProps) {
  const [rowState, setRowState] = useState<TimingWindowRows>(() => ({
    rows: windows.map((window, id) => ({ id, window })),
    nextId: windows.length,
  }));
  // A new row starts in the unit of the row last added in this form (as it is
  // now, so switching that row's unit counts), else "Monat". Form state only.
  const [lastAdded, setLastAdded] = useState<{ id: number | null; unit: TimingWindowUnit }>({
    id: null,
    unit: 'decade',
  });

  let { rows, nextId } = rowState;
  if (rows.length !== windows.length || windows.some((window, index) => window !== rows[index].window)) {
    // The parent can replace the draft, for example when another crop opens.
    const previous = new Map(rows.map((row) => [row.window, row]));
    rows = windows.map((window) => previous.get(window) ?? { id: nextId++, window });
    setRowState({ rows, nextId });
  }

  const updateRows = (updated: TimingWindowDraftRow[], updatedNextId = nextId): void => {
    setRowState({ rows: updated, nextId: updatedNextId });
    onChange(updated.map(({ window }) => window));
  };
  const removeAt = (index: number): void => {
    updateRows(rows.filter((_, currentIndex) => currentIndex !== index));
  };
  const addWindow = (kind: TimingWindowKind): void => {
    // Insert after the kind's last row so the list stays grouped by kind.
    const lastIndexOfKind = windows.map((window) => window.kind).lastIndexOf(kind);
    const insertAt = lastIndexOfKind === -1
      ? windows.filter((window) => TIMING_WINDOW_KINDS.indexOf(window.kind) < TIMING_WINDOW_KINDS.indexOf(kind)).length
      : lastIndexOfKind + 1;
    const next = [...rows];
    next.splice(insertAt, 0, { id: nextId, window: emptyTimingWindow(kind, lastAdded.unit) });
    updateRows(next, nextId + 1);
    setLastAdded({ id: nextId, unit: lastAdded.unit });
  };
  const handleRowChange = (index: number) => (window: CropTimingWindow): void => {
    const { id } = rows[index];
    updateRows(rows.map((row, currentIndex) => (currentIndex === index ? { id, window } : row)));
    if (id === lastAdded.id && window.unit !== lastAdded.unit) {
      setLastAdded({ id, unit: window.unit });
    }
  };

  return (
    <>
      {/* Heading plus info icon as in BasicInfoSection's crop-rotation heading:
          the icon stays beside the last word and outside the heading's name. */}
      <Box sx={{ mt: 1, typography: 'h6' }}>
        <Typography variant="h6" sx={{ display: 'inline' }}>{t('timingWindows.sectionTitle')}</Typography>
        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
          {'\u00A0'}
          <FieldInfoIcon title={t('timingWindows.sectionHelp')} />
        </Box>
      </Box>
      <Box sx={categoryGridSx}>
        {TIMING_WINDOW_KINDS.map((kind) => {
          const highlightSx = getKindHighlightSx?.(kind);
          const kindRows = rows
            .map((row, index) => ({ ...row, index }))
            .filter(({ window }) => window.kind === kind);
          return (
            <Box key={kind} role="group" aria-label={t(`timingWindows.kinds.${kind}`)} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
              <Typography variant="subtitle2">
                {t(`timingWindows.categoryHeadings.${kind}`)}
              </Typography>
              {kindRows.length > 0 ? (
                <Box sx={[{ display: 'flex', flexDirection: 'column', gap: 1 }, ...(highlightSx ? [highlightSx].flat() : [])] as SxProps<Theme>}>
                  {kindRows.map(({ id, window, index }) => (
                    <TimingWindowRow
                      key={id}
                      window={window}
                      error={errors[`timing_windows.${index}`]}
                      t={t}
                      onChange={handleRowChange(index)}
                      onRemove={() => removeAt(index)}
                    />
                  ))}
                </Box>
              ) : null}
              <Box>
                <Button
                  type="button"
                  variant="text"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    addWindow(kind);
                  }}
                >
                  {t('timingWindows.addWindow')}
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
    </>
  );
}

export type { TimingWindowsSectionProps };
