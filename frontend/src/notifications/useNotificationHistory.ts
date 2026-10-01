/**
 * Paginated loader behind the notification history page.
 *
 * Separate from `useNotifications` (the topbar controller) on purpose: that one
 * holds the newest page for the dropdowns and owns the badge, while this one
 * walks the whole archive a page at a time and is discarded when the page is
 * left. Mark-read still goes through the topbar controller so the badge follows.
 */

import { useCallback, useEffect, useState } from 'react';
import { notificationAPI } from '../api/api';
import type { AppNotification } from '../api/types';

/** Rows per page — a readable list length that keeps the page under one fetch. */
export const NOTIFICATION_HISTORY_PAGE_SIZE = 20;

export interface NotificationHistory {
  notifications: AppNotification[];
  unreadCount: number;
  totalCount: number;
  page: number;
  pageCount: number;
  isLoading: boolean;
  hasError: boolean;
  goToPage: (page: number) => void;
  /** Reflects a row the user just opened, without refetching the page. */
  applyRead: (notification: AppNotification) => void;
  /** Reflects a successful "mark all as read", without refetching the page. */
  applyAllRead: () => void;
}

/**
 * @param allReadVersion - The topbar controller's counter of successful
 *   "mark all as read" calls; a change restyles every loaded row as read, so
 *   the action taken from the bell dropdown shows on this page too.
 */
export function useNotificationHistory(allReadVersion = 0): NotificationHistory {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [appliedAllReadVersion, setAppliedAllReadVersion] = useState(allReadVersion);

  useEffect(() => {
    let cancelled = false;
    // Deferred like `useNotifications` so the fetch doesn't set state
    // synchronously inside the effect body.
    queueMicrotask(() => {
      if (!cancelled) setIsLoading(true);
    });
    notificationAPI.list({ page, page_size: NOTIFICATION_HISTORY_PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        setNotifications(response.data.results);
        setUnreadCount(response.data.unread_count);
        setTotalCount(response.data.count);
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
  }, [page]);

  const applyRead = useCallback((notification: AppNotification): void => {
    if (notification.is_read) {
      return;
    }
    setNotifications((previous) => previous.map(
      (entry) => (entry.id === notification.id ? { ...entry, is_read: true } : entry),
    ));
    setUnreadCount((count) => Math.max(0, count - 1));
  }, []);

  const applyAllRead = useCallback((): void => {
    setNotifications((previous) => previous.map(
      (entry) => (entry.is_read ? entry : { ...entry, is_read: true }),
    ));
    setUnreadCount(0);
  }, []);

  // Adjusted during render rather than in an effect (React's pattern for
  // state that follows a prop), so the rows never paint unread in between.
  if (allReadVersion !== appliedAllReadVersion) {
    setAppliedAllReadVersion(allReadVersion);
    applyAllRead();
  }

  return {
    notifications,
    unreadCount,
    totalCount,
    page,
    pageCount: Math.max(1, Math.ceil(totalCount / NOTIFICATION_HISTORY_PAGE_SIZE)),
    isLoading,
    hasError,
    goToPage: setPage,
    applyRead,
    applyAllRead,
  };
}
