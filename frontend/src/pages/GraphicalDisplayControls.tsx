import { useId, useState } from 'react';
import { Box, Button, IconButton, ListItemText, Menu, MenuItem, Paper } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckIcon from '@mui/icons-material/Check';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import { AppTooltip } from '../components/AppTooltip';
import { useContextMenuOpenRegistration } from '../components/contextMenu/contextMenuOpenState';
import { useTranslation } from '../i18n';
import { resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import type { Season } from '../api/types';
import {
  GRAPHICAL_DISPLAY_MODES,
  type CropDateSelection, type CropReference, type GraphicalDisplayMode,
} from './graphicalCultivation';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';
import { GraphicalCropTimePopover } from './GraphicalCropTimePopover';
import { formatCropReference } from './graphicalCropTimeLabels';

const touchTarget = { minHeight: 44, minWidth: 44 };

export function GraphicalLayersControl({ mode, onMode }: {
  mode: GraphicalDisplayMode;
  onMode: (mode: GraphicalDisplayMode) => void;
}) {
  const { t } = useTranslation('fields');
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  useContextMenuOpenRegistration(Boolean(anchor));
  const label = `${t('graphical.display.layers')} · ${t(`graphical.display.mode.${mode}`)}`;

  return (
    <>
      <Paper elevation={3} data-graphical-annotation-obstacle sx={{ flexShrink: 0, borderRadius: 3 }}>
        <AppTooltip title={label} placement="left" disableInteractive disableFocusListener
          open={anchor ? false : undefined} slotProps={{ popper: { container: getGraphicalPortalContainer } }}>
          <IconButton data-testid="graphical-display-mode" aria-label={label} aria-haspopup="menu"
            aria-expanded={Boolean(anchor)} aria-controls={anchor ? menuId : undefined}
            sx={{ ...touchTarget, borderRadius: 3, color: 'text.primary' }}
            onClick={event => setAnchor(event.currentTarget)}>
            <LayersOutlinedIcon fontSize="small" />
          </IconButton>
        </AppTooltip>
      </Paper>
      <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        container={getGraphicalPortalContainer()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ list: { id: menuId, 'aria-label': t('graphical.display.title') },
          paper: { sx: { maxWidth: 'calc(100% - 32px)' } } }}>
        {GRAPHICAL_DISPLAY_MODES.map(value => (
          <MenuItem key={value} role="menuitemradio" aria-checked={mode === value} selected={mode === value}
            sx={{ minHeight: 44, gap: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
            onClick={() => { onMode(value); setAnchor(null); }}>
            <ListItemText primary={t(`graphical.display.mode.${value}`)} />
            {mode === value && <CheckIcon fontSize="small" aria-hidden />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function GraphicalCropDateControl({ season, reference, onDate, compact = false, fullscreen = false }: {
  season: Season;
  reference: CropReference;
  onDate: (date: CropDateSelection) => void;
  compact?: boolean;
  fullscreen?: boolean;
}) {
  const { t, i18n } = useTranslation('fields');
  const dateId = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  useContextMenuOpenRegistration(Boolean(anchor));
  const locale = resolveSeasonDateLocale(i18n);
  const dateValue = formatCropReference(reference, locale, t);
  const today = reference.kind === 'date' && reference.today;
  const dateText = today ? t('graphical.display.today') : dateValue;
  const dateLabel = [t('graphical.display.date'), reference.kind === 'range' ? t('graphical.display.dateRange') : null,
    dateText, today ? dateValue : null].filter(Boolean).join(' · ');
  const compactLabelWidth = reference.kind === 'range' ? '28rem' : '23rem';

  return (
    <>
      <Button variant="outlined" aria-label={dateLabel} title={compact || fullscreen ? dateLabel : undefined} aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)} aria-controls={anchor ? dateId : undefined}
        data-testid="graphical-crop-date" data-graphical-crop-time="" onClick={event => setAnchor(event.currentTarget)}
        sx={{ ...touchTarget, px: compact ? 0.5 : 1, gap: compact ? 0.5 : 0.75, flexShrink: 0 }}>
        <CalendarMonthOutlinedIcon fontSize="small" aria-hidden />
        {!compact && <Box component="span" aria-hidden sx={fullscreen
          ? { display: 'none', '@media (min-width: 740px)': { display: 'inline' } } : undefined}>
          {dateText}
        </Box>}
        {compact && reference.kind !== 'season' && !today && <Box component="span" aria-hidden
          sx={{ display: 'none', [`@container workspace-topbar (min-width: ${compactLabelWidth})`]: { display: 'inline' } }}>
          {formatCropReference(reference, locale, t, true)}
        </Box>}
      </Button>
      <GraphicalCropTimePopover anchor={anchor} onClose={() => setAnchor(null)}
        id={dateId} season={season} reference={reference} onSelect={onDate} />
    </>
  );
}
