/**
 * Loads the signed-in user's **unread** notifications for the topbar bell.
 *
 * Fetched once on mount, whenever the dropdown is opened, and when the
 * authenticated user's WebSocket stream reports that notifications changed.
 * Rows marked read locally survive a background reload until the dropdown is
 * opened again, so a bulk "mark all as read" restyles the open list instead of
 * emptying it the moment the resulting invalidation arrives.
 *
 * The unread filter is applied by the backend, not here: picking the unread
 * rows out of one page of the full history would show an empty dropdown next
 * to a non-zero badge as soon as the newest page holds no unread row. The full
 * archive lives on the history page (`useNotificationHistory`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { notificationAPI } from '../api/api';
import type { AppNotification } from '../api/types';
import { useTranslation } from '../i18n';
import { useWebSocket, type WebSocketEvent } from '../realtime/useWebSocket';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { getNotificationLink } from './notificationDisplay';

/** How many unread rows the dropdown loads; the badge always counts them all. */
export const NOTIFICATION_DROPDOWN_PAGE_SIZE = 20;

export interface NotificationsController {
  /**
   * The loaded page of unread notifications, newest first, plus the ones
   * marked read since the dropdown was last opened (with `is_read: true`).
   */
  notifications: AppNotification[];
  /** `notifications` minus the ones marked read since the last load. */
  unreadNotifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  hasError: boolean;
  /** Background refresh; keeps rows already marked read in place. */
  reload: () => void;
  /** Fresh start for a dropdown being opened: drops read rows, then reloads. */
  refresh: () => void;
  markRead: (notification: AppNotification) => void;
  /**
   * Marks everything the badge counts as read in one request. Resolves to
   * whether it succeeded; on failure nothing local has changed.
   */
  markAllRead: () => Promise<boolean>;
  isMarkingAllRead: boolean;
  /**
   * Bumped after every successful `markAllRead`, so a separately loaded list
   * (the history page) can restyle its rows too.
   */
  allReadVersion: number;
}

const asRead = (notification: AppNotification): AppNotification => (
  notification.is_read ? notification : { ...notification, is_read: true }
);

/**
 * The freshly loaded unread rows plus every row this controller already marked
 * read and the backend therefore no longer returns, still newest first.
 */
function mergeKeepingLocallyRead(
  loaded: AppNotification[],
  previous: AppNotification[],
): AppNotification[] {
  const loadedIds = new Set(loaded.map((notification) => notification.id));
  const keptRead = previous.filter((notification) => notification.is_read && !loadedIds.has(notification.id));
  if (keptRead.length === 0) {
    return loaded;
  }
  return [...loaded, ...keptRead].sort((left, right) => (
    right.created_at.localeCompare(left.created_at) || right.id - left.id
  ));
}

export function useNotifications(enabled: boolean): NotificationsController {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [allReadVersion, setAllReadVersion] = useState(0);
  // Ids whose mark-read request is in flight or done, so the same notification
  // reached through a second, independently loaded copy is a no-op.
  const markedReadIdsRef = useRef<Set<number>>(new Set());

  const reload = useCallback((): void => {
    setReloadToken((token) => token + 1);
  }, []);

  const refresh = useCallback((): void => {
    setNotifications((previous) => previous.filter((notification) => !notification.is_read));
    reload();
  }, [reload]);

  const handleNotificationEvent = useCallback((event: WebSocketEvent): void => {
    if (event.type === 'notifications.updated') {
      reload();
    }
  }, [reload]);

  useWebSocket({
    path: enabled ? 'ws/notifications/' : null,
    onEvent: handleNotificationEvent,
    onFallbackPoll: reload,
  });

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;
    // Deferred like the other loaders in this codebase so the fetch doesn't
    // set state synchronously inside the effect body.
    queueMicrotask(() => {
      if (!cancelled) setIsLoading(true);
    });
    notificationAPI.list({ is_read: false, page_size: NOTIFICATION_DROPDOWN_PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        setNotifications((previous) => mergeKeepingLocallyRead(response.data.results, previous));
        setUnreadCount(response.data.unread_count);
        setHasError(false);
      })
      .catch(() => {
        if (!cancelled) setHasError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadToken]);

  // Takes the notification rather than its id so the history page can mark a
  // row this controller never loaded (anything past the dropdown's page) and
  // still have the topbar badge follow along. Because that caller's copy can be
  // stale — it was fetched separately and still says `is_read: false` — the ids
  // already handled are remembered here, so a second click on the same
  // notification cannot decrement the badge twice or re-POST.
  const markRead = useCallback((notification: AppNotification): void => {
    if (notification.is_read || markedReadIdsRef.current.has(notification.id)) {
      return;
    }
    markedReadIdsRef.current.add(notification.id);
    // Applied locally first so the badge reacts immediately; a failing request
    // only means the row reappears as unread on the next load, and is then
    // retryable again.
    setNotifications((previous) => previous.map(
      (entry) => (entry.id === notification.id ? asRead(entry) : entry),
    ));
    setUnreadCount((count) => Math.max(0, count - 1));
    void notificationAPI.markRead(notification.id).catch(() => {
      markedReadIdsRef.current.delete(notification.id);
    });
  }, []);

  // Not optimistic, unlike `markRead`: a failure has to leave every row and
  // the badge exactly as they were rather than roll back a partial guess.
  const markAllRead = useCallback(async (): Promise<boolean> => {
    setIsMarkingAllRead(true);
    try {
      await notificationAPI.markAllRead();
    } catch {
      return false;
    } finally {
      setIsMarkingAllRead(false);
    }
    setNotifications((previous) => previous.map(asRead));
    setUnreadCount(0);
    setAllReadVersion((version) => version + 1);
    return true;
  }, []);

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.is_read),
    [notifications],
  );

  // Stable identity across renders that don't actually change any of these
  // fields, so consumers (NotificationBell, useNotificationMenuItems) can
  // memoize off the controller instead of re-deriving on every RootLayout
  // render.
  return useMemo(
    () => ({
      notifications,
      unreadNotifications,
      unreadCount,
      isLoading,
      hasError,
      reload,
      refresh,
      markRead,
      markAllRead,
      isMarkingAllRead,
      allReadVersion,
    }),
    [
      notifications,
      unreadNotifications,
      unreadCount,
      isLoading,
      hasError,
      reload,
      refresh,
      markRead,
      markAllRead,
      isMarkingAllRead,
      allReadVersion,
    ],
  );
}

/**
 * What clicking a single notification does, shared by the desktop bell, the
 * compact topbar's menu section and the history page: mark exactly that one as
 * read, then open the object it refers to (if it still has one).
 */
export function useNotificationSelection(
  controller: NotificationsController | null,
): (notification: AppNotification) => void {
  const navigate = useNavigate();
  const markRead = controller?.markRead ?? null;

  return useCallback((notification: AppNotification): void => {
    if (markRead) {
      markRead(notification);
    } else if (!notification.is_read) {
      // Rendered without the topbar's controller (no badge to keep in sync);
      // the row itself still has to be marked read.
      void notificationAPI.markRead(notification.id).catch(() => undefined);
    }
    const link = getNotificationLink(notification);
    if (link) {
      void navigate(link);
    }
  }, [markRead, navigate]);
}

/**
 * The "Alle als gelesen markieren" action shared by the bell dropdown and the
 * history page: one bulk request, and the standard error snackbar if it fails.
 */
export function useMarkAllNotificationsRead(
  controller: NotificationsController | null,
): () => Promise<boolean> {
  const { t } = useTranslation('notifications');
  const controllerMarkAllRead = controller?.markAllRead ?? null;

  return useCallback(async (): Promise<boolean> => {
    // Without the topbar's controller there is no badge to keep in sync; the
    // rows themselves still have to be marked read.
    const succeeded = controllerMarkAllRead
      ? await controllerMarkAllRead()
      : await notificationAPI.markAllRead().then(() => true, () => false);
    if (!succeeded) {
      showGlobalSnackbar({ message: t('markAllRead.error'), severity: 'error' });
    }
    return succeeded;
  }, [controllerMarkAllRead, t]);
}
