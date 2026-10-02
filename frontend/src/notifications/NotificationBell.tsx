import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  Badge,
  Box,
  CircularProgress,
  Divider,
  IconButton,
  ListItemButton,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { AppTooltip } from '../components/AppTooltip';
import { NavEmojiIcon } from '../navigation/NavEmojiIcon';
import { useTranslation } from '../i18n';
import { MarkAllNotificationsReadButton } from './MarkAllNotificationsReadButton';
import { NOTIFICATION_HISTORY_ROUTE } from './notificationDisplay';
import { NotificationItemContent } from './NotificationItemContent';
import { NOTIFICATION_DROPDOWN_ROW_SX, NOTIFICATION_HINT_SX, NOTIFICATION_MENU_HEADER_SX } from './notificationStyles';
import {
  useMarkAllNotificationsRead,
  useNotificationSelection,
  type NotificationsController,
} from './useNotifications';
import { TOPBAR_BADGE_SX } from '../navigation/topbarMenuStyles';
import type { AppNotification } from '../api/types';

interface NotificationBellProps {
  controller: NotificationsController;
  /** Topbar icon buttons share one square size; passed in so the bell matches its neighbours. */
  buttonSize?: number;
}

/**
 * Topbar bell with an unread badge and a dropdown of the user's notifications.
 *
 * Only rendered on the full topbar. The compact topbar has no room for another
 * icon next to the page actions (it collapsed the page title to a single
 * letter), so there the same notifications live inside the "Mehr" menu — see
 * `useNotificationMenuItems`.
 *
 * The list shows **unread** entries only: it is the "what is new" surface, and
 * everything else lives one click away on the history page it links to. Rows
 * read while the menu is open (through "Alle als gelesen markieren") stay in
 * place in the read style until the next open.
 *
 * Opening the menu deliberately marks nothing as read — only clicking a single
 * entry does (which then navigates to the object the notification is about),
 * or the explicit "mark all" action in the header.
 */
export function NotificationBell({ controller, buttonSize }: NotificationBellProps) {
  const { t } = useTranslation('notifications');
  const [anchorElement, setAnchorElement] = useState<null | HTMLElement>(null);
  const isOpen = Boolean(anchorElement);
  const { notifications, unreadCount, isLoading, hasError, refresh, isMarkingAllRead } = controller;
  const selectNotification = useNotificationSelection(controller);
  const markAllRead = useMarkAllNotificationsRead(controller);
  const navigate = useNavigate();

  const handleOpen = (event: MouseEvent<HTMLElement>): void => {
    setAnchorElement(event.currentTarget);
    refresh();
  };

  const handleSelect = (notification: AppNotification): void => {
    setAnchorElement(null);
    selectNotification(notification);
  };

  const handleShowAll = (): void => {
    setAnchorElement(null);
    void navigate(NOTIFICATION_HISTORY_ROUTE);
  };

  const label = unreadCount > 0
    // Named `unread` rather than `count` on purpose: an i18next `count`
    // switches the key into plural resolution, which these two bundles do not
    // define suffixes for.
    ? t('bell.unreadAriaLabel', { unread: unreadCount })
    : t('bell.ariaLabel');

  return (
    <>
      <AppTooltip title={t('bell.title')} enterTouchDelay={0}>
        <IconButton
          aria-label={label}
          aria-haspopup="true"
          aria-expanded={isOpen}
          onClick={handleOpen}
          size="small"
          sx={{
            color: 'text.primary',
            flexShrink: 0,
            ...(buttonSize ? { width: buttonSize, height: buttonSize } : {}),
          }}
        >
          <Badge badgeContent={unreadCount} color="error" overlap="circular" sx={TOPBAR_BADGE_SX}>
            <NavEmojiIcon emoji="🔔" />
          </Badge>
        </IconButton>
      </AppTooltip>
      <Menu
        anchorEl={anchorElement}
        open={isOpen}
        onClose={() => setAnchorElement(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 0.5, width: { xs: 280, sm: 360 }, maxWidth: '100vw' } } }}
      >
        <Box sx={NOTIFICATION_MENU_HEADER_SX}>
          <Typography variant="subtitle2">{t('bell.title')}</Typography>
          <MarkAllNotificationsReadButton
            inMenu
            unreadCount={unreadCount}
            isPending={isMarkingAllRead}
            onClick={() => { void markAllRead(); }}
          />
        </Box>
        <Divider />
        {isLoading && notifications.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        ) : null}
        {hasError ? (
          <Typography variant="body2" color="error.main" sx={NOTIFICATION_HINT_SX}>
            {t('bell.loadError')}
          </Typography>
        ) : null}
        {!isLoading && !hasError && notifications.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={NOTIFICATION_HINT_SX}>
            {t('bell.noUnread')}
          </Typography>
        ) : null}
        {notifications.map((notification) => (
          <ListItemButton
            key={notification.id}
            onClick={() => handleSelect(notification)}
            sx={NOTIFICATION_DROPDOWN_ROW_SX}
          >
            <NotificationItemContent notification={notification} showUnreadDot />
          </ListItemButton>
        ))}
        <Divider />
        <MenuItem onClick={handleShowAll}>
          <Typography variant="body2" color="primary.main">{t('bell.showAll')}</Typography>
        </MenuItem>
      </Menu>
    </>
  );
}
