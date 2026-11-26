import { useId, useRef, useState } from 'react';
import { Box, Button, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Popover, Stack, TextField, Typography } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import StraightenIcon from '@mui/icons-material/Straighten';
import { useTranslation } from '../i18n';
import { formatDateToAPI } from '../utils/isoDate';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import type { Season } from '../api/types';
import {
  GRAPHICAL_DISPLAY_MODES, includesCrops, stepCropDate,
  type CropDateSelection, type CropReference, type GraphicalDisplayMode,
} from './graphicalCultivation';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';
import type { OpenGraphicalSpacing } from './GraphicalSpacingControl';

interface DisplayControlsProps {
  mode: GraphicalDisplayMode;
  onMode: (mode: GraphicalDisplayMode) => void;
  season?: Season;
  reference?: CropReference;
  onDate: (date: CropDateSelection) => void;
  onOpenLegend: (anchor: HTMLButtonElement) => void;
  compact?: boolean;
  onOpenSpacing?: OpenGraphicalSpacing;
}

const touchTarget = { minHeight: 44, minWidth: 44 };

export function GraphicalDisplayControls({
  mode, onMode, season, reference, onDate, onOpenLegend, compact = false, onOpenSpacing,
}: DisplayControlsProps) {
  const { t, i18n } = useTranslation(['fields', 'common']);
  const menuId = useId();
  const dateId = useId();
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [dateAnchor, setDateAnchor] = useState<HTMLButtonElement | null>(null);
  const afterMenuClose = useRef<(() => void) | null>(null);
  const full = reference?.kind === 'season';
  const today = formatDateToAPI(new Date());
  const canChooseToday = Boolean(season && today >= season.start_date && today <= season.end_date);
  const date = reference?.kind === 'date' ? reference.date : season?.start_date ?? '';
  const dateText = full ? t('graphical.display.entireSeason') : reference?.kind === 'date' && reference.today
    ? t('graphical.display.today')
    : formatSeasonDate(date, resolveSeasonDateLocale(i18n));
  const title = t('graphical.display.title');
  const modeLabel = t(`graphical.display.mode.${mode}`);
  const container = getGraphicalPortalContainer();

  return (
    <Stack direction="row" useFlexGap spacing={1}
      sx={{ display: compact ? 'contents' : 'flex', flexShrink: 0, maxWidth: '100%' }}>
      <Button variant="outlined" aria-label={`${title} · ${modeLabel}`}
        aria-description={onOpenSpacing ? t('graphical.spacing.button') : undefined}
        title={compact ? t('common:actions.moreActions') : modeLabel}
        aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} aria-controls={menuAnchor ? menuId : undefined}
        onClick={event => setMenuAnchor(event.currentTarget)} sx={{
          ...touchTarget, px: 1, gap: 0.75, flexShrink: 0,
          '& [data-display-label]': { display: 'none' },
          '@container workspace-topbar (min-width: 112rem)': { '& [data-display-label]': { display: 'inline' } },
        }}>
        {compact ? <MoreVertIcon fontSize="small" aria-hidden /> : <LayersOutlinedIcon fontSize="small" aria-hidden />}
        <Box component="span" data-display-label aria-hidden>{modeLabel}</Box>
      </Button>
      {season && reference && includesCrops(mode) && <Button variant="outlined" sx={{ ...touchTarget, px: 1, gap: 0.75, flexShrink: 0 }}
        aria-label={`${t('graphical.display.date')} · ${dateText}`} aria-haspopup="dialog"
        aria-expanded={Boolean(dateAnchor)} aria-controls={dateAnchor ? dateId : undefined}
        onClick={event => setDateAnchor(event.currentTarget)}>
        <CalendarMonthOutlinedIcon fontSize="small" aria-hidden />
        <Box component="span" aria-hidden>{dateText}</Box>
      </Button>}
      <Menu
        open={Boolean(menuAnchor)}
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        container={container}
        slotProps={{
          list: { id: menuId, 'aria-label': title },
          transition: { onExited: () => {
            const action = afterMenuClose.current;
            afterMenuClose.current = null;
            action?.();
          } },
        }}>
        {GRAPHICAL_DISPLAY_MODES.map(value => <MenuItem key={value} role="menuitemradio"
          aria-checked={mode === value} selected={mode === value} sx={{ minHeight: 44 }}
          onClick={() => { onMode(value); setMenuAnchor(null); setDateAnchor(null); }}>
          {t(`graphical.display.mode.${value}`)}
        </MenuItem>)}
        <MenuItem sx={{ minHeight: 44 }} onClick={() => {
          if (menuAnchor) afterMenuClose.current = () => onOpenLegend(menuAnchor);
          setMenuAnchor(null);
        }}>{t('graphical.display.legend')}</MenuItem>
        {onOpenSpacing && <Divider />}
        {onOpenSpacing && <MenuItem aria-haspopup="dialog" sx={{ minHeight: 44 }} onClick={event => {
          if (menuAnchor) {
            const keyboard = event.detail === 0;
            afterMenuClose.current = () => {
              menuAnchor.focus({ preventScroll: true });
              onOpenSpacing(menuAnchor, keyboard);
            };
          }
          setMenuAnchor(null);
        }}>
          <ListItemIcon><StraightenIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t('graphical.spacing.button')} />
        </MenuItem>}
      </Menu>
      {season && reference && includesCrops(mode) && (
        <Popover open={Boolean(dateAnchor)} anchorEl={dateAnchor} onClose={() => setDateAnchor(null)}
          container={container} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{ paper: { id: dateId, role: 'dialog', 'aria-label': t('graphical.display.date'),
            sx: { maxWidth: 'calc(100% - 32px)' } } }}>
          <Stack spacing={1} sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button sx={touchTarget} disabled={!canChooseToday} aria-pressed={reference.kind === 'date' && reference.today}
                onClick={() => { onDate({ kind: 'today' }); setDateAnchor(null); }}>{t('graphical.display.today')}</Button>
              <Button sx={touchTarget} aria-pressed={full} onClick={() => { onDate({ kind: 'season' }); setDateAnchor(null); }}>
                {t('graphical.display.entireSeason')}
              </Button>
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <IconButton sx={touchTarget} aria-label={t('graphical.display.previousDay')} disabled={date <= season.start_date}
                onClick={() => onDate({ kind: 'date', date: stepCropDate(date, -1, season) })}>
                <KeyboardArrowLeftIcon />
              </IconButton>
              <TextField type="date" autoFocus size="small" label={t('graphical.display.date')} value={date}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: season.start_date, max: season.end_date } }}
                onChange={event => {
                  const selected = event.target.value;
                  if (selected >= season.start_date && selected <= season.end_date) onDate({ kind: 'date', date: selected });
                }} />
              <IconButton sx={touchTarget} aria-label={t('graphical.display.nextDay')} disabled={date >= season.end_date}
                onClick={() => onDate({ kind: 'date', date: stepCropDate(date, 1, season) })}>
                <KeyboardArrowRightIcon />
              </IconButton>
            </Stack>
            <Typography variant="caption" color="text.secondary">{t('graphical.display.taskDateNote')}</Typography>
          </Stack>
        </Popover>
      )}
    </Stack>
  );
}
