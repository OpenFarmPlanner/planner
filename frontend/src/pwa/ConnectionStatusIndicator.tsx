import { Box } from '@mui/material';
import WifiIcon from '@mui/icons-material/Wifi';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import { AppTooltip } from '../components/AppTooltip';
import { useTranslation } from '../i18n';
import { useOnlineStatus } from './useOnlineStatus';

interface ConnectionStatusIndicatorProps {
  /** Square size in px, so the indicator lines up with its topbar neighbours. */
  size: number;
  /**
   * Render nothing while the connection is up. Used by the compact topbar,
   * which has no room for a permanently present status icon — it already
   * folded the notification bell into the "Mehr" menu for the same reason.
   */
  hideWhenOnline?: boolean;
}

/**
 * Topbar indicator for the browser's network connection.
 *
 * OpenFarmPlanner states its status rather than letting the user infer it from
 * a failing action, so the connection is shown even while everything works:
 * a muted icon when online, the error colour when not. It is always rendered
 * at a fixed size on the full topbar so the state change recolours an icon
 * instead of reflowing the trailing controls.
 *
 * It reports the *browser's* link state, not backend reachability — the
 * wording in the tooltip is deliberately about the connection, not the server.
 * There is no offline mode behind it: the service worker caches build assets
 * only, so an offline session cannot load or save project data (see
 * `docs/pwa.md`).
 */
export function ConnectionStatusIndicator({ size, hideWhenOnline = false }: ConnectionStatusIndicatorProps) {
  const { t } = useTranslation('navigation');
  const isOnline = useOnlineStatus();

  if (isOnline && hideWhenOnline) {
    return null;
  }

  const label = isOnline ? t('connectionStatus.online') : t('connectionStatus.offline');
  const Icon = isOnline ? WifiIcon : WifiOffIcon;

  return (
    <AppTooltip title={label} enterTouchDelay={0}>
      <Box
        role="status"
        aria-live="polite"
        aria-label={label}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          flexShrink: 0,
          color: isOnline ? 'text.secondary' : 'error.main',
        }}
      >
        <Icon fontSize="small" />
      </Box>
    </AppTooltip>
  );
}
