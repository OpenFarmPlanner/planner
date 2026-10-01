import { Box, Button, MenuItem, Typography } from '@mui/material';
import type { ReactElement } from 'react';
import { AppTooltip } from '../components/AppTooltip';
import { useTranslation } from '../i18n';
import { NOTIFICATION_MENU_HEADER_ACTION_SX } from './notificationStyles';

interface MarkAllNotificationsReadButtonProps {
  /** The badge's count: the action covers exactly what it counts. */
  unreadCount: number;
  isPending: boolean;
  onClick: () => void;
  /**
   * Inside the bell's `Menu` the action has to be a `MenuItem`: MUI's menu
   * only lets registered items take arrow-key focus and closes itself on Tab,
   * so a plain button there would be unreachable from the keyboard.
   */
  inMenu?: boolean;
}

/**
 * "Alle als gelesen markieren", shared by the bell dropdown header and the
 * history page header. Stays visible with nothing unread — disabled, with a
 * tooltip saying why — so the header does not reflow as the count changes.
 */
export function MarkAllNotificationsReadButton({
  unreadCount,
  isPending,
  onClick,
  inMenu = false,
}: MarkAllNotificationsReadButtonProps): ReactElement {
  const { t } = useTranslation('notifications');
  const disabled = unreadCount === 0 || isPending;
  const label = t('markAllRead.label');

  return (
    // A disabled control fires no pointer events, so the tooltip hangs on a
    // wrapper; an empty title renders no tooltip while the action is enabled.
    <AppTooltip title={unreadCount === 0 ? t('markAllRead.nothingUnread') : ''}>
      <Box sx={{ display: 'inline-flex', flexShrink: 0 }}>
        {inMenu ? (
          <MenuItem component="div" disabled={disabled} onClick={onClick} sx={NOTIFICATION_MENU_HEADER_ACTION_SX}>
            <Typography variant="body2" color="primary.main">{label}</Typography>
          </MenuItem>
        ) : (
          <Button size="small" variant="text" disabled={disabled} onClick={onClick}>
            {label}
          </Button>
        )}
      </Box>
    </AppTooltip>
  );
}
