import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useEffect } from 'react';
import { NotificationBell } from '../notifications/NotificationBell';
import { useNotifications, type NotificationsController } from '../notifications/useNotifications';
import type { AppNotification } from '../api/types';
import { GLOBAL_SNACKBAR_EVENT, type GlobalSnackbarDetail } from '../utils/globalSnackbar';

const {
  notificationListMock,
  notificationMarkReadMock,
  notificationMarkAllReadMock,
  navigateMock,
  webSocketSubscriptions,
} = vi.hoisted(() => ({
  notificationListMock: vi.fn(),
  notificationMarkReadMock: vi.fn(),
  notificationMarkAllReadMock: vi.fn(),
  navigateMock: vi.fn(),
  webSocketSubscriptions: [] as Array<{
    onEvent: (event: { type: string; [key: string]: unknown }) => void;
    path: string | null;
  }>,
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    notificationAPI: {
      list: notificationListMock,
      markRead: notificationMarkReadMock,
      markAllRead: notificationMarkAllReadMock,
    },
  };
});

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../realtime/useWebSocket', () => ({
  useWebSocket: vi.fn((options: {
    onEvent: (event: { type: string; [key: string]: unknown }) => void;
    path: string | null;
  }) => {
    webSocketSubscriptions.push({ onEvent: options.onEvent, path: options.path });
  }),
}));

const notification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 1,
  notification_type: 'crop_species_proposal_accepted',
  message: 'Your proposal for the crop species "Kürbis" was accepted.',
  context: { name: 'Kürbis' },
  target_type: 'public_crop',
  target_id: 42,
  is_read: false,
  created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

/** Mirrors RootLayout, which owns the controller and hands it to the bell. */
function BellHarness({ onReady }: { onReady?: (controller: NotificationsController) => void }) {
  const controller = useNotifications(true);
  useEffect(() => { onReady?.(controller); }, [controller, onReady]);
  return <NotificationBell controller={controller} />;
}

const renderBell = (onReady?: (controller: NotificationsController) => void) => render(
  <MemoryRouter>
    <BellHarness onReady={onReady} />
  </MemoryRouter>,
);

describe('NotificationBell', () => {
  beforeEach(() => {
    notificationListMock.mockReset();
    notificationMarkReadMock.mockReset();
    notificationMarkAllReadMock.mockReset();
    navigateMock.mockReset();
    webSocketSubscriptions.length = 0;
    notificationMarkReadMock.mockResolvedValue({ data: notification({ is_read: true }) });
    notificationMarkAllReadMock.mockResolvedValue({ data: { marked_read: 1 } });
    notificationListMock.mockResolvedValue({
      data: { count: 1, next: null, previous: null, results: [notification()], unread_count: 1 },
    });
  });

  it('shows the unread count on the bell and renders the localized message with a relative time', async () => {
    renderBell();

    const bell = await screen.findByRole('button', { name: /Benachrichtigungen \(1 ungelesen\)/i });
    fireEvent.click(bell);

    expect(await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.')).toBeInTheDocument();
    expect(screen.getByText(/vor 2 Tagen/)).toBeInTheDocument();
  });

  it('does not mark anything as read just by opening the dropdown', async () => {
    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: /Benachrichtigungen/i }));
    await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.');

    expect(notificationMarkReadMock).not.toHaveBeenCalled();
    // The open menu is a modal, so the bell behind it is aria-hidden — the
    // unread count is still what its label reports.
    expect(screen.getByRole('button', { name: /1 ungelesen/i, hidden: true })).toBeInTheDocument();
  });

  it('marks exactly the clicked entry as read and navigates to the linked object', async () => {
    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: /Benachrichtigungen/i }));
    fireEvent.click(await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.'));

    await waitFor(() => expect(notificationMarkReadMock).toHaveBeenCalledWith(1));
    expect(navigateMock).toHaveBeenCalledWith('/app/crop-library?cropId=42');
    // The unread count is gone once the only unread entry was read.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Benachrichtigungen' })).toBeInTheDocument());
  });

  it('renders no badge and a subtle hint when nothing is unread', async () => {
    notificationListMock.mockResolvedValue({
      data: { count: 0, next: null, previous: null, results: [], unread_count: 0 },
    });

    renderBell();

    const bell = await screen.findByRole('button', { name: 'Benachrichtigungen' });
    fireEvent.click(bell);

    expect(await screen.findByText('Keine neuen Benachrichtigungen')).toBeInTheDocument();
  });

  it('asks the backend for unread rows only, so the list cannot disagree with the badge', async () => {
    renderBell();

    // Filtering client-side would leave the dropdown empty next to a non-zero
    // badge as soon as no unread row is on the newest page of the history.
    await waitFor(() => expect(notificationListMock).toHaveBeenCalledWith({ is_read: false, page_size: 20 }));
  });

  it('ignores a second mark-read for the same notification, however stale the copy', async () => {
    notificationListMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [notification(), notification({ id: 2, context: { name: 'Rote Bete' } })],
        unread_count: 2,
      },
    });

    let controller: NotificationsController | null = null;
    renderBell((ready) => { controller = ready; });

    fireEvent.click(await screen.findByRole('button', { name: /2 ungelesen/i }));
    fireEvent.click(await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.'));
    await waitFor(() => expect(notificationMarkReadMock).toHaveBeenCalledWith(1));

    // The history page holds its own copy of the same row, fetched before the
    // click, so it still reads `is_read: false`. Replaying it must not
    // decrement the badge a second time or re-POST.
    act(() => (controller as NotificationsController | null)?.markRead(notification()));

    await waitFor(() => expect(screen.getByRole('button', { name: /1 ungelesen/i, hidden: true })).toBeInTheDocument());
    expect(notificationMarkReadMock).toHaveBeenCalledTimes(1);
  });

  it('always offers the link to the full history, also with nothing unread', async () => {
    notificationListMock.mockResolvedValue({
      data: { count: 0, next: null, previous: null, results: [], unread_count: 0 },
    });

    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen' }));
    fireEvent.click(await screen.findByText('Alle Benachrichtigungen anzeigen'));

    expect(navigateMock).toHaveBeenCalledWith('/app/notifications');
    expect(notificationMarkReadMock).not.toHaveBeenCalled();
  });

  it('reports a failed load instead of rendering an empty dropdown', async () => {
    notificationListMock.mockRejectedValue(new Error('network'));

    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen' }));

    expect(await screen.findByText('Benachrichtigungen konnten nicht geladen werden.')).toBeInTheDocument();
  });

  it('reloads when the notification WebSocket reports a change', async () => {
    notificationListMock
      .mockResolvedValueOnce({
        data: { count: 0, next: null, previous: null, results: [], unread_count: 0 },
      })
      .mockResolvedValueOnce({
        data: { count: 1, next: null, previous: null, results: [notification()], unread_count: 1 },
      });

    renderBell();

    await screen.findByRole('button', { name: 'Benachrichtigungen' });
    expect(webSocketSubscriptions.at(-1)?.path).toBe('ws/notifications/');

    webSocketSubscriptions.at(-1)?.onEvent({
      type: 'notifications.updated',
      notification_id: 1,
    });

    await waitFor(() => expect(notificationListMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /Benachrichtigungen \(1 ungelesen\)/i })).toBeInTheDocument();
  });

  describe('mark all as read', () => {
    const KUERBIS = 'Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.';
    const ROTE_BETE = 'Dein Vorschlag für die Kulturart „Rote Bete“ wurde angenommen.';

    const twoUnread = () => ({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [notification(), notification({ id: 2, context: { name: 'Rote Bete' } })],
        unread_count: 2,
      },
    });

    it('is visible but disabled with an explanatory tooltip when nothing is unread', async () => {
      notificationListMock.mockResolvedValue({
        data: { count: 0, next: null, previous: null, results: [], unread_count: 0 },
      });

      renderBell();

      fireEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen' }));
      const action = await screen.findByRole('menuitem', { name: 'Alle als gelesen markieren' });

      expect(action).toHaveAttribute('aria-disabled', 'true');
      fireEvent.mouseOver(action.parentElement as HTMLElement);
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Keine ungelesenen Benachrichtigungen');
    });

    it('marks everything read in one request, clears the badge and keeps the dropdown open', async () => {
      notificationListMock.mockResolvedValue(twoUnread());

      renderBell();

      fireEvent.click(await screen.findByRole('button', { name: /2 ungelesen/i }));
      expect(await screen.findByText(KUERBIS)).toHaveStyle({ fontWeight: 600 });
      fireEvent.click(screen.getByRole('menuitem', { name: 'Alle als gelesen markieren' }));

      await waitFor(() => expect(screen.getByRole('button', { name: 'Benachrichtigungen', hidden: true })).toBeInTheDocument());
      expect(notificationMarkAllReadMock).toHaveBeenCalledTimes(1);
      expect(notificationMarkReadMock).not.toHaveBeenCalled();
      // Still open, with both rows switched to the read style in place.
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByText(KUERBIS)).toHaveStyle({ fontWeight: 400 });
      expect(screen.getByText(ROTE_BETE)).toHaveStyle({ fontWeight: 400 });
      expect(screen.getByRole('menuitem', { name: 'Alle als gelesen markieren' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('keeps the read rows in place when the resulting invalidation reloads the list', async () => {
      // Mount and dropdown open both load; the invalidation after the bulk
      // update finds nothing unread any more.
      notificationListMock.mockResolvedValueOnce(twoUnread()).mockResolvedValueOnce(twoUnread()).mockResolvedValue({
        data: { count: 0, next: null, previous: null, results: [], unread_count: 0 },
      });

      renderBell();

      fireEvent.click(await screen.findByRole('button', { name: /2 ungelesen/i }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Alle als gelesen markieren' }));
      await waitFor(() => expect(screen.getByText(KUERBIS)).toHaveStyle({ fontWeight: 400 }));

      act(() => webSocketSubscriptions.at(-1)?.onEvent({ type: 'notifications.updated', notification_id: null }));

      await waitFor(() => expect(notificationListMock).toHaveBeenCalledTimes(3));
      expect(screen.getByText(KUERBIS)).toBeInTheDocument();
      expect(screen.getByText(ROTE_BETE)).toBeInTheDocument();
      expect(screen.queryByText('Keine neuen Benachrichtigungen')).not.toBeInTheDocument();
    });

    it('reports a failure and leaves badge and rows untouched', async () => {
      notificationListMock.mockResolvedValue(twoUnread());
      notificationMarkAllReadMock.mockRejectedValue(new Error('network'));
      const snackbars: GlobalSnackbarDetail[] = [];
      const listener = (event: Event) => snackbars.push((event as CustomEvent<GlobalSnackbarDetail>).detail);
      window.addEventListener(GLOBAL_SNACKBAR_EVENT, listener);

      try {
        renderBell();

        fireEvent.click(await screen.findByRole('button', { name: /2 ungelesen/i }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Alle als gelesen markieren' }));

        await waitFor(() => expect(snackbars).toEqual([{
          message: 'Benachrichtigungen konnten nicht als gelesen markiert werden.',
          severity: 'error',
        }]));
        expect(screen.getByRole('button', { name: /2 ungelesen/i, hidden: true })).toBeInTheDocument();
        expect(screen.getByText(KUERBIS)).toHaveStyle({ fontWeight: 600 });
        expect(screen.getByRole('menuitem', { name: 'Alle als gelesen markieren' })).not.toHaveAttribute('aria-disabled');
      } finally {
        window.removeEventListener(GLOBAL_SNACKBAR_EVENT, listener);
      }
    });
  });
});
