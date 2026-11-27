import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { Box, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack, useTheme, type IconButtonProps } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined';
import RemoveIcon from '@mui/icons-material/Remove';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import { AppTooltip } from '../components/AppTooltip';
import { useContextMenuOpenRegistration } from '../components/contextMenu/contextMenuOpenState';
import { useTranslation } from '../i18n';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';

const touchTarget = { width: 44, height: 44, borderRadius: 0 };
const compactStripHeight = 290;

interface CanvasToolsProps {
  width: number;
  height: number;
  fullscreen: boolean;
  onZoom: (direction: -1 | 1) => void;
  onFit: () => void;
  onFullscreen: () => void;
  onRotate: (direction: -1 | 1) => void;
  onPan: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onTriggerChange: (button: HTMLButtonElement | null) => void;
  warnings: ReactNode;
  individualPlants?: { active: boolean; toggle: () => void; add?: () => void };
}

interface Tool {
  label: string;
  icon: ReactNode;
  action: () => void;
  active?: boolean;
  opensPanel?: boolean;
}

function CanvasToolButton({ label, icon, active, ref, ...buttonProps }: Pick<Tool, 'label' | 'icon' | 'active'>
  & Pick<IconButtonProps, 'aria-haspopup' | 'aria-expanded' | 'aria-controls' | 'onClick'>
  & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <AppTooltip title={label} placement="left" disableInteractive
      slotProps={{ popper: { container: getGraphicalPortalContainer } }}>
      <IconButton ref={ref} aria-label={label} aria-pressed={active} color={active ? 'success' : 'default'}
        sx={touchTarget} {...buttonProps}>{icon}</IconButton>
    </AppTooltip>
  );
}

export function GraphicalCanvasTools({
  width, height, fullscreen, onZoom, onFit, onFullscreen, onRotate, onPan, onTriggerChange,
  warnings, individualPlants,
}: CanvasToolsProps) {
  const { t } = useTranslation('fields');
  const theme = useTheme();
  const compact = width < theme.breakpoints.values.lg;
  const short = height < compactStripHeight && width >= theme.breakpoints.values.sm;
  const menuId = useId();
  const [nextAction, setNextAction] = useState<(() => void) | null>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const title = t('graphical.moreTools');

  const rotation: Tool[] = [
    { label: t('graphical.rotateLeft'), icon: <RotateLeftIcon fontSize="small" />, action: () => onRotate(-1) },
    { label: t('graphical.rotateRight'), icon: <RotateRightIcon fontSize="small" />, action: () => onRotate(1) },
  ];
  const pan: Tool[] = [
    { label: t('graphical.panUp'), icon: <KeyboardArrowUpIcon fontSize="small" />, action: () => onPan('up') },
    { label: t('graphical.panLeft'), icon: <KeyboardArrowLeftIcon fontSize="small" />, action: () => onPan('left') },
    { label: t('graphical.panRight'), icon: <KeyboardArrowRightIcon fontSize="small" />, action: () => onPan('right') },
    { label: t('graphical.panDown'), icon: <KeyboardArrowDownIcon fontSize="small" />, action: () => onPan('down') },
  ];
  const core: Tool[] = [
    { label: t('graphical.zoomIn'), icon: <AddIcon fontSize="small" />, action: () => onZoom(1) },
    { label: t('graphical.zoomOut'), icon: <RemoveIcon fontSize="small" />, action: () => onZoom(-1) },
    { label: t('graphical.fitToView'), icon: <FitScreenIcon fontSize="small" />, action: onFit },
    { label: t(fullscreen ? 'graphical.exitFullscreen' : 'graphical.enterFullscreen'),
      icon: fullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />, action: onFullscreen },
  ];
  const additional: Tool[] = [];
  if (individualPlants) additional.push({
    label: t(individualPlants.add ? 'individualPlants.addPlants' : 'individualPlants.title'),
    icon: <ParkOutlinedIcon fontSize="small" />, active: individualPlants.active, opensPanel: true,
    action: individualPlants.add ?? individualPlants.toggle,
  });
  const groups = (compact ? [rotation, pan, additional] : [additional]).filter(group => group.length > 0);
  const overflowTools = groups.flat();
  const hasMenu = overflowTools.length > 1;
  const promoted = overflowTools.length === 1 ? overflowTools[0] : undefined;
  const [hadMenu, setHadMenu] = useState(hasMenu);
  if (hadMenu !== hasMenu) {
    setHadMenu(hasMenu);
    setMenuOpen(false);
  }
  useContextMenuOpenRegistration(hasMenu && menuOpen);

  const toolButton = (tool: Tool) => (
    <CanvasToolButton key={tool.label} label={tool.label} icon={tool.icon} onClick={tool.action} />
  );
  const menuItem = (tool: Tool) => (
    <MenuItem key={tool.label} sx={{ minHeight: { xs: 44, sm: 44 }, whiteSpace: 'normal' }}
      aria-description={tool.active ? t('graphical.toolActive') : undefined}
      onClick={() => {
        setMenuOpen(false);
        if (tool.opensPanel) setNextAction(() => tool.action);
        else tool.action();
      }}>
      <ListItemIcon sx={{ color: tool.active ? 'success.main' : undefined }}>{tool.icon}</ListItemIcon>
      <ListItemText primary={tool.label} />
      {tool.active && <CheckIcon sx={{ ml: 1, color: 'success.main' }} fontSize="small" />}
    </MenuItem>
  );

  return (
    <>
      <Paper elevation={3} data-testid="graphical-canvas-tools" role="group" aria-label={t('graphical.canvasTools')}
        sx={{ position: 'absolute', top: 12, right: 12, zIndex: 2, borderRadius: 3, overflow: 'auto',
          maxHeight: 'calc(100% - 24px)', bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: short ? 'repeat(2, 44px)' : '44px', justifyContent: 'center' }}>
          {(hasMenu || promoted) && (
            <CanvasToolButton ref={onTriggerChange} label={promoted?.label ?? title}
              icon={promoted?.icon ?? <MoreVertIcon fontSize="small" />} active={promoted?.active}
              aria-haspopup={hasMenu ? 'menu' : undefined} aria-expanded={hasMenu ? menuOpen : undefined}
              aria-controls={hasMenu && menuOpen ? menuId : undefined}
              onClick={promoted?.action ?? (event => { setAnchor(event.currentTarget); setMenuOpen(true); })} />
          )}
          {warnings}
        </Box>
        {!compact && (
          <Stack sx={{ alignItems: 'center' }}>
            <Stack direction="row">{rotation.map(toolButton)}</Stack>
            {toolButton(pan[0])}
            <Stack direction="row">{pan.slice(1, 3).map(toolButton)}</Stack>
            {toolButton(pan[3])}
          </Stack>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: short || !compact ? 'repeat(2, 44px)' : '44px', justifyContent: 'center' }}>
          <CanvasToolButton ref={zoomButtonRef} label={core[0].label} icon={core[0].icon} onClick={core[0].action} />
          {core.slice(1).map(toolButton)}
        </Box>
      </Paper>
      <Menu open={hasMenu && menuOpen} anchorEl={anchor} onClose={() => setMenuOpen(false)}
        container={getGraphicalPortalContainer()} anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ list: { id: menuId, 'aria-label': title }, paper: { sx: { maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)' } },
          transition: { onExited: () => {
            if (anchor && !anchor.isConnected) zoomButtonRef.current?.focus({ preventScroll: true });
            setNextAction(null);
            nextAction?.();
          } } }}>
        {groups.flatMap((group, index) => [
          ...(index ? [<Divider key={`group-${index}`} />] : []),
          ...group.map(menuItem),
        ])}
      </Menu>
    </>
  );
}
