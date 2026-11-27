import { useState } from 'react';
import { Box, Button, IconButton, Popover, Slider, Stack, TextField, Typography } from '@mui/material';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import type { Season } from '../api/types';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { formatDateToAPI } from '../utils/isoDate';
import {
  cropDateOffset, isCropDateInSeason, isCropRangeInSeason, stepCropDate,
  type CropDateSelection, type CropReference,
} from './graphicalCultivation';
import { formatCropInterval, formatCropTimelineMonths } from './graphicalCropTimeLabels';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';

const target = { minWidth: 44, minHeight: 44 };
const dateInputSx = { minWidth: 0, '& .MuiInputBase-root': { minHeight: 44 } };
const timeChoices = ['today', 'specificDate', 'dateRange', 'entireSeason'] as const;

interface CropTimePanelProps {
  reference: CropReference;
  season: Pick<Season, 'id' | 'start_date' | 'end_date'>;
  onSelect: (selection: CropDateSelection) => void;
  onClose: () => void;
  id: string;
}

function CropTimePanel({ reference, season, onSelect, onClose, id }: CropTimePanelProps) {
  const { t, i18n } = useTranslation('fields');
  const locale = resolveSeasonDateLocale(i18n);
  const mode = reference.kind === 'range' ? 'dateRange' : reference.kind === 'season'
    ? 'entireSeason' : reference.today ? 'today' : 'specificDate';
  const date = reference.kind === 'date' ? reference.date
    : reference.kind === 'range' ? reference.start : season.start_date;
  const fullDate = (value: string) => formatSeasonDate(value, locale);
  const { start_date: start, end_date: end } = season;
  const [range, setRange] = useState(() => reference.kind === 'range'
    ? { start: reference.start, end: reference.end } : { start: date, end: reference.kind === 'season' ? end : date });
  const bounds = { min: start, max: end, lang: locale };
  const steps = cropDateOffset(start, end);
  const monthLabels = formatCropTimelineMonths([start, stepCropDate(start, Math.round(steps / 2), season), end], locale);
  const rangeError = !range.start || !range.end ? 'rangeIncomplete'
    : !isCropDateInSeason(range.start, season) || !isCropDateInSeason(range.end, season) ? 'rangeOutside'
      : range.start > range.end ? 'rangeOrder' : null;

  const selectDate = (value: string) => {
    if (isCropDateInSeason(value, season)) onSelect({ kind: 'date', date: value });
  };
  const updateRange = (next: typeof range) => {
    setRange(next);
    if (isCropRangeInSeason(next.start, next.end, season)) onSelect({ kind: 'range', ...next });
  };
  const selectChoice = (choice: typeof timeChoices[number]) => {
    if (choice === 'specificDate') {
      selectDate(date);
    } else if (choice === 'dateRange') {
      if (mode !== 'dateRange') updateRange({ start: date, end: reference.kind === 'season' ? end : date });
    } else {
      onSelect({ kind: choice === 'today' ? 'today' : 'season' });
      onClose();
    }
  };
  const errorId = `${id}-range-error`;

  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }}>
      <Box role="group" aria-label={t('graphical.display.date')} sx={{
        display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 0.5,
      }}>
        {timeChoices.map(choice => (
          <Button key={choice} size="small" aria-pressed={mode === choice}
            variant={mode === choice ? 'contained' : 'outlined'}
            disabled={choice === 'today' && !isCropDateInSeason(formatDateToAPI(new Date()), season)}
            sx={{ ...target, px: 0.75, lineHeight: 1.2, overflowWrap: 'anywhere' }}
            onClick={() => selectChoice(choice)}>
            {t(`graphical.display.${choice}`)}
          </Button>
        ))}
      </Box>
      {mode === 'specificDate' && <>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <IconButton sx={target} aria-label={t('graphical.display.previousDay')} disabled={date <= start}
            onClick={() => selectDate(stepCropDate(date, -1, season))}>
            <KeyboardArrowLeftIcon />
          </IconButton>
          <TextField type="date" autoFocus size="small" label={t('graphical.display.specificDate')} value={date}
            fullWidth sx={dateInputSx} slotProps={{ inputLabel: { shrink: true }, htmlInput: bounds }}
            onChange={event => selectDate(event.target.value)} />
          <IconButton sx={target} aria-label={t('graphical.display.nextDay')} disabled={date >= end}
            onClick={() => selectDate(stepCropDate(date, 1, season))}>
            <KeyboardArrowRightIcon />
          </IconButton>
        </Stack>
        {steps > 0 && <Box sx={{ mx: 1 }}>
          <Typography variant="body2" sx={{ textAlign: 'center' }} aria-hidden>{fullDate(date)}</Typography>
          <Slider min={0} max={steps} step={1} value={cropDateOffset(start, date)}
            aria-label={t('graphical.display.seasonTimeline')}
            getAriaValueText={offset => fullDate(stepCropDate(start, offset, season))}
            slotProps={{ input: { 'aria-description': formatCropInterval(start, end, locale, t) } }}
            sx={{ minHeight: 4, py: 2.5, touchAction: 'none' }}
            onChange={(_, value) => { if (typeof value === 'number') selectDate(stepCropDate(start, value, season)); }} />
          <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 0.5 }} aria-hidden>
            {monthLabels.map(label => <Typography key={label} variant="caption">{label}</Typography>)}
          </Stack>
        </Box>}
      </>}
      {mode === 'dateRange' && <>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1,
          '@media (max-width: 340px)': { gridTemplateColumns: 'minmax(0, 1fr)' } }}>
          <TextField type="date" autoFocus size="small" label={t('graphical.display.rangeFrom')}
            value={range.start} onChange={event => updateRange({ ...range, start: event.target.value })}
            error={Boolean(rangeError)} sx={dateInputSx} slotProps={{ inputLabel: { shrink: true },
              htmlInput: { ...bounds, 'aria-describedby': rangeError ? errorId : undefined } }} />
          <TextField type="date" size="small" label={t('graphical.display.rangeTo')}
            value={range.end} onChange={event => updateRange({ ...range, end: event.target.value })}
            error={Boolean(rangeError)} sx={dateInputSx} slotProps={{ inputLabel: { shrink: true },
              htmlInput: { ...bounds, 'aria-describedby': rangeError ? errorId : undefined } }} />
        </Box>
        {rangeError && <Typography id={errorId} role="alert" variant="caption" color="error.main">
          {t(`graphical.display.${rangeError}`)}
        </Typography>}
        {reference.kind === 'range' && <Typography variant="body2" color="text.secondary">
          {t('graphical.display.appliedRange', { range: formatCropInterval(reference.start, reference.end, locale, t) })}
        </Typography>}
      </>}
    </Stack>
  );
}

export function GraphicalCropTimePopover({ anchor, ...panel }: CropTimePanelProps & { anchor: HTMLButtonElement | null }) {
  const { t } = useTranslation('fields');
  const { id, season, onClose } = panel;
  return (
    <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={onClose} data-graphical-crop-time=""
      container={getGraphicalPortalContainer()} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { id, role: 'dialog', 'aria-label': t('graphical.display.date'),
        sx: { width: 'min(410px, calc(100% - 32px))', maxWidth: 'calc(100% - 32px)' } } }}>
      {anchor && <CropTimePanel key={season.id} {...panel} />}
    </Popover>
  );
}
