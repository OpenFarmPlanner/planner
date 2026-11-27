import { useId, useState } from 'react';
import { Box, Button, Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Stack } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckIcon from '@mui/icons-material/Check';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import StraightenIcon from '@mui/icons-material/Straighten';
import { WORKSPACE_TOOLBAR_LABEL_QUERY } from '../components/buttons/ResponsiveToolbarAction';
import { GrowingAreaWorkspaceMenu } from '../components/hierarchy/GrowingAreaWorkspaceMenu';
import { useContextMenuOpenRegistration } from '../components/contextMenu/contextMenuOpenState';
import { useTranslation } from '../i18n';
import { resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import type { Season } from '../api/types';
import {
  GRAPHICAL_DISPLAY_MODES, includesCrops,
  type CropDateSelection, type CropReference, type GraphicalDisplayMode,
} from './graphicalCultivation';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';
import type { OpenGraphicalSpacing } from './GraphicalSpacingControl';
import { GraphicalCropTimePopover } from './GraphicalCropTimePopover';
import { formatCropReference } from './graphicalCropTimeLabels';

interface DisplayControlsProps {
  mode: GraphicalDisplayMode;
  onMode: (mode: GraphicalDisplayMode) => void;
  season?: Season;
  reference?: CropReference;
  onDate: (date: CropDateSelection) => void;
  compact?: boolean;
  fullscreen?: boolean;
  onOpenSpacing?: OpenGraphicalSpacing;
  editing?: { active: boolean; disabled: boolean; toggle: () => void };
}

const touchTarget = { minHeight: 44, minWidth: 44 };

export function GraphicalDisplayControls({
  mode, onMode, season, reference, onDate, compact = false, fullscreen = false, onOpenSpacing, editing,
}: DisplayControlsProps) {
  const { t, i18n } = useTranslation(['fields', 'common']);
  const menuId = useId();
  const dateId = useId();
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [dateAnchor, setDateAnchor] = useState<HTMLButtonElement | null>(null);
  useContextMenuOpenRegistration(Boolean(menuAnchor || dateAnchor));
  const locale = resolveSeasonDateLocale(i18n);
  const dateValue = reference ? formatCropReference(reference, locale, t) : '';
  const today = reference?.kind === 'date' && reference.today;
  const dateText = today ? t('graphical.display.today') : dateValue;
  const title = t('graphical.display.title');
  const modeLabel = t(`graphical.display.mode.${mode}`);
  const container = getGraphicalPortalContainer();
  const dateLabel = [t('graphical.display.date'), reference?.kind === 'range' ? t('graphical.display.dateRange') : null,
    dateText, today ? dateValue : null].filter(Boolean).join(' · ');
  const compactLabelWidth = reference?.kind === 'range' ? '28rem' : '23rem';
  const dateButton = season && reference && includesCrops(mode) && (
    <Button variant="outlined" aria-label={dateLabel} title={compact || fullscreen ? dateLabel : undefined} aria-haspopup="dialog"
      aria-expanded={Boolean(dateAnchor)} aria-controls={dateAnchor ? dateId : undefined}
      data-testid="graphical-crop-date" data-graphical-crop-time="" onClick={event => setDateAnchor(event.currentTarget)}
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
  );
  const selectMode = (value: GraphicalDisplayMode) => {
    onMode(value);
    setMenuAnchor(null);
    setDateAnchor(null);
  };
  const renderModes = (select: (value: GraphicalDisplayMode) => void) => GRAPHICAL_DISPLAY_MODES.map(value => (
    <MenuItem key={value} role="menuitemradio" aria-checked={mode === value} selected={mode === value}
      sx={{ minHeight: 44, gap: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' }} onClick={() => select(value)}>
      <ListItemText primary={t(`graphical.display.mode.${value}`)} />
      {mode === value && <CheckIcon fontSize="small" aria-hidden />}
    </MenuItem>
  ));

  return (
    <Stack direction="row" useFlexGap spacing={1}
      sx={{ display: compact ? 'contents' : 'flex', flexShrink: 0, maxWidth: '100%', flexWrap: fullscreen ? 'wrap' : undefined }}>
      {compact && dateButton}
      {compact ? (
        <GrowingAreaWorkspaceMenu editing={editing?.active}
          description={editing?.active ? `${t('graphical.editMode')} · ${modeLabel}` : modeLabel}>
          {select => [
            ...(editing ? [
              <MenuItem key="edit" role="menuitemcheckbox" aria-checked={editing.active} selected={editing.active}
                disabled={editing.disabled} onClick={() => select(editing.toggle)} sx={{ minHeight: 44 }}>
                <ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary={t(editing.active ? 'graphical.locationEditModeExit' : 'graphical.locationEditModeAction')} />
                {editing.active && <CheckIcon fontSize="small" aria-hidden />}
              </MenuItem>,
              <Divider key="edit-divider" />,
            ] : []),
            <ListSubheader key="display" disableSticky>{title}</ListSubheader>,
            ...renderModes(value => select(() => selectMode(value))),
            ...(onOpenSpacing ? [
              <Divider key="spacing-divider" />,
              <MenuItem key="spacing" aria-haspopup="dialog" sx={{ minHeight: 44 }}
                onClick={event => select(onOpenSpacing, event.detail === 0)}>
                <ListItemIcon><StraightenIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary={t('graphical.spacing.button')} />
              </MenuItem>,
            ] : []),
          ]}
        </GrowingAreaWorkspaceMenu>
      ) : <Button variant="outlined" aria-label={`${title} · ${modeLabel}`}
        title={modeLabel}
        data-testid="graphical-display-mode"
        aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} aria-controls={menuAnchor ? menuId : undefined}
        onClick={event => setMenuAnchor(event.currentTarget)} sx={{
          ...touchTarget, px: 0.75, gap: 0.5, flexShrink: 0,
          '& [data-display-label]': { display: 'none' },
          [fullscreen ? '@media (min-width: 900px)' : WORKSPACE_TOOLBAR_LABEL_QUERY]: {
            '& [data-display-label]': { display: 'inline' },
          },
        }}>
        <LayersOutlinedIcon sx={{ fontSize: 20 }} aria-hidden />
        <Box component="span" data-display-label aria-hidden>{modeLabel}</Box>
        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} aria-hidden data-testid="graphical-display-chevron" />
      </Button>}
      {!compact && dateButton}
      {!compact && <Menu
        open={Boolean(menuAnchor)}
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        container={container}
        slotProps={{ list: { id: menuId, 'aria-label': title } }}>
        {renderModes(selectMode)}
      </Menu>}
      {season && reference && includesCrops(mode) && (
        <GraphicalCropTimePopover anchor={dateAnchor} onClose={() => setDateAnchor(null)}
          id={dateId} season={season} reference={reference} onSelect={onDate} />
      )}
    </Stack>
  );
}
