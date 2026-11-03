/**
 * TimingWindowsSection: the crop's Anzucht, Direktsaat and Pflanzung windows,
 * one group per kind with any number of rows (no harvest windows: the harvest
 * follows from planting and growth duration). A row is in thirds of
 * a month or in calendar weeks (docs/timing-windows.md).
 * @remarks Holds only the unit a new row starts with; the windows live in the form.
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
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import {
  MAX_ISO_WEEK,
  TIMING_WINDOW_DECADES,
  TIMING_WINDOW_KINDS,
  emptyTimingWindow,
  wrapsYearEnd,
} from '../timingWindows';

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const WEEKS = Array.from({ length: MAX_ISO_WEEK }, (_, index) => index + 1);

export interface TimingWindowKindHighlight {
  sx?: SxProps<Theme>;
  tooltipTitle?: React.ReactNode;
}

interface TimingWindowsSectionProps {
  windows: CropTimingWindow[];
  errors: Record<string, string>;
  onChange: (windows: CropTimingWindow[]) => void;
  t: TFunction;
  /** Variety highlight per kind (own windows vs. the Kultur's), like the other fields. */
  getKindHighlight?: (kind: TimingWindowKind) => TimingWindowKindHighlight | null;
}

const selectSx = { minWidth: 0 } as const;
const endpointSx = { display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap' } as const;

type EndpointField = 'start_month' | 'start_decade' | 'end_month' | 'end_decade' | 'start_week' | 'end_week';

interface TimingWindowRowProps {
  window: CropTimingWindow;
  error?: string;
  t: TFunction;
  onChange: (window: CropTimingWindow) => void;
  onRemove: () => void;
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
    <Box data-testid="timing-window-row">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
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
        <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 2, rowGap: 1, flexWrap: 'wrap', flex: '1 1 auto' }}>
          {endpoint('start')}
          {endpoint('end')}
        </Box>
        <IconButton color="error" onClick={onRemove} aria-label={t('timingWindows.removeWindow')}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
      {wrapsYearEnd(window) ? (
        <FormHelperText>{t('timingWindows.wrapsYearEnd')}</FormHelperText>
      ) : null}
      {error ? <FormHelperText error>{error}</FormHelperText> : null}
    </Box>
  );
}

export function TimingWindowsSection({ windows, errors, onChange, t, getKindHighlight }: TimingWindowsSectionProps) {
  // A new row starts in the unit of the row last added in this form (as it is
  // now, so switching that row's unit counts), else "Monat". Form state only.
  const [lastAdded, setLastAdded] = useState<{ index: number | null; unit: TimingWindowUnit }>({
    index: null,
    unit: 'decade',
  });

  const removeAt = (index: number): void => {
    onChange(windows.filter((_, currentIndex) => currentIndex !== index));
    setLastAdded((current) => {
      if (current.index === null || index > current.index) return current;
      return { ...current, index: index === current.index ? null : current.index - 1 };
    });
  };
  const addWindow = (kind: TimingWindowKind): void => {
    // Insert after the kind's last row so the list stays grouped by kind.
    const lastIndexOfKind = windows.map((window) => window.kind).lastIndexOf(kind);
    const insertAt = lastIndexOfKind === -1
      ? windows.filter((window) => TIMING_WINDOW_KINDS.indexOf(window.kind) < TIMING_WINDOW_KINDS.indexOf(kind)).length
      : lastIndexOfKind + 1;
    const next = [...windows];
    next.splice(insertAt, 0, emptyTimingWindow(kind, lastAdded.unit));
    onChange(next);
    setLastAdded({ index: insertAt, unit: lastAdded.unit });
  };
  const handleRowChange = (index: number) => (window: CropTimingWindow): void => {
    onChange(windows.map((current, currentIndex) => (currentIndex === index ? window : current)));
    if (index === lastAdded.index && window.unit !== lastAdded.unit) {
      setLastAdded({ index, unit: window.unit });
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
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {TIMING_WINDOW_KINDS.map((kind) => {
          const highlight = getKindHighlight?.(kind) ?? null;
          const rows = windows
            .map((window, index) => ({ window, index }))
            .filter(({ window }) => window.kind === kind);
          const titleId = `timing-window-group-${kind}`;
          return (
            <Box key={kind} role="group" aria-labelledby={titleId} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <VarietyFieldTooltip tooltipTitle={highlight?.tooltipTitle}>
                <Typography id={titleId} variant="subtitle2" sx={{ width: 'fit-content' }}>
                  {t(`timingWindows.kinds.${kind}`)}
                </Typography>
              </VarietyFieldTooltip>
              <Box sx={[{ display: 'flex', flexDirection: 'column', gap: 1 }, ...(highlight?.sx ? [highlight.sx].flat() : [])] as SxProps<Theme>}>
                {rows.map(({ window, index }) => (
                  <TimingWindowRow
                    key={index}
                    window={window}
                    error={errors[`timing_windows.${index}`]}
                    t={t}
                    onChange={handleRowChange(index)}
                    onRemove={() => removeAt(index)}
                  />
                ))}
              </Box>
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
