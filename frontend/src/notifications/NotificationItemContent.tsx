import { Box, Typography } from '@mui/material';
import type { ReactElement } from 'react';
import { useTranslation } from '../i18n';
import { formatRelativeTime } from '../utils/relativeTime';
import { getNotificationMessage } from './notificationDisplay';
import { NOTIFICATION_UNREAD_DOT_SX } from './notificationStyles';
import type { AppNotification } from '../api/types';

interface NotificationItemContentProps {
  notification: AppNotification;
  /**
   * Whether to reserve and paint the unread dot. The dropdowns list unread
   * entries only, where a dot on every row carries no information; the history
   * page mixes both states and needs it.
   */
  showUnreadDot?: boolean;
}

/**
 * The message + relative time of one notification, shared by every surface
 * that lists notifications (bell dropdown, compact "Mehr" menu, history page)
 * so unread emphasis and timestamp formatting cannot drift apart.
 */
export function NotificationItemContent({
  notification,
  showUnreadDot = false,
}: NotificationItemContentProps): ReactElement {
  const { t, i18n } = useTranslation('notifications');
  const language = i18n.resolvedLanguage ?? i18n.language;
  // Field labels and values inside a message come from the crop library's own
  // diff formatter, which resolves its keys in the `crops` namespace.
  const tCrops = i18n.getFixedT(null, 'crops');

  const text = (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="body2"
        sx={{ whiteSpace: 'normal', fontWeight: notification.is_read ? 400 : 600 }}
      >
        {getNotificationMessage(notification, t, tCrops)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatRelativeTime(notification.created_at, language)}
      </Typography>
    </Box>
  );

  if (!showUnreadDot) {
    return text;
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0, width: '100%' }}>
      <Box
        aria-hidden
        sx={{
          ...NOTIFICATION_UNREAD_DOT_SX,
          bgcolor: notification.is_read ? 'transparent' : 'primary.main',
        }}
      />
      {text}
    </Box>
  );
}
