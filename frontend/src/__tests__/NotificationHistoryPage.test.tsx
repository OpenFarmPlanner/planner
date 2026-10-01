import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { useEffect } from 'react';
import NotificationHistoryPage from '../notifications/pages/NotificationHistoryPage';
import { useNotifications, type NotificationsController } from '../notifications/useNotifications';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';
import type { AppNotification } from '../api/types';

const {
  notificationListMock,
  notificationMarkReadMock,
  notificationMarkAllReadMock,
  navigateMock,
} = vi.hoisted(() => ({
  notificationListMock: vi.fn(),
  notificationMarkReadMock: vi.fn(),
  notificationMarkAllReadMock: vi.fn(),
  navigateMock: vi.fn(),
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

const page = (results: AppNotification[], count = results.length, unreadCount = 0) => ({
  data: { count, next: null, previous: null, results, unread_count: unreadCount },
});

/** Mirrors RootLayout: the topbar owns the controller and passes it down the outlet. */
let layoutController: NotificationsController | null = null;

function LayoutHarness() {
  const notifications = useNotifications(true);
  useEffect(() => { layoutController = notifications; }, [notifications]);
  return <Outlet context={{
    setTopbarContextActions: () => {},
    setTopbarTitleActions: () => {},
    activeSeasonYear: null,
    activeSeason: null,
    activeSeasonLoading: false,
    activeSeasonLoaded: true,
    hasSeasons: false,
    requestSeasonCreation: () => {},
    notifications,
  } satisfies RootLayoutOutletContext}
  />;
}

const renderPage = (options: { entry?: object; withLayout?: boolean } = {}) => {
  const { entry = '/app/notifications', withLayout = true } = options;
  const pageRoute = <Route path="/app/notifications" element={<NotificationHistoryPage />} />;
  return render(
    <MemoryRouter initialEntries={[entry as string]}>
      <Routes>
        {withLayout ? <Route element={<LayoutHarness />}>{pageRoute}</Route> : pageRoute}
      </Routes>
    </MemoryRouter>,
  );
};

describe('NotificationHistoryPage', () => {
  beforeEach(() => {
    notificationListMock.mockReset();
    notificationMarkReadMock.mockReset();
    notificationMarkAllReadMock.mockReset();
    navigateMock.mockReset();
    notificationMarkReadMock.mockResolvedValue({ data: notification({ is_read: true }) });
    notificationMarkAllReadMock.mockResolvedValue({ data: { marked_read: 1 } });
  });

  it('lists read and unread notifications with an unread count subtitle', async () => {
    notificationListMock.mockResolvedValue(page([
      notification(),
      notification({ id: 2, notification_type: 'crop_species_proposal_rejected', context: { name: 'Rote Bete' }, is_read: true }),
    ], 2, 1));

    renderPage();

    expect(await screen.findByText('Alle Benachrichtigungen')).toBeInTheDocument();
    expect(screen.getByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.')).toBeInTheDocument();
    expect(screen.getByText('Dein Vorschlag für die Kulturart „Rote Bete“ wurde abgelehnt.')).toBeInTheDocument();
    expect(screen.getByText('1 ungelesen')).toBeInTheDocument();
  });

  it('omits the unread subtitle when everything has been read', async () => {
    notificationListMock.mockResolvedValue(page([notification({ is_read: true })], 1, 0));

    renderPage();

    await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.');
    expect(screen.queryByText(/ungelesen/)).not.toBeInTheDocument();
  });

  it('marks a clicked row as read and opens what it refers to', async () => {
    notificationListMock.mockResolvedValue(page([notification()], 1, 1));

    renderPage();

    fireEvent.click(await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.'));

    await waitFor(() => expect(notificationMarkReadMock).toHaveBeenCalledWith(1));
    expect(navigateMock).toHaveBeenCalledWith('/app/crop-library?cropId=42');
    // The row is read now, so the unread subtitle is gone.
    await waitFor(() => expect(screen.queryByText(/ungelesen/)).not.toBeInTheDocument());
  });

  it('guides the user when no notification was ever received', async () => {
    notificationListMock.mockResolvedValue(page([], 0, 0));

    renderPage();

    expect(await screen.findByText('Noch keine Benachrichtigungen')).toBeInTheDocument();
    expect(screen.getByText(/Entscheidungen zu deinen Vorschlägen/)).toBeInTheDocument();
  });

  it('goes back to the previous view when the page was opened from inside the app', async () => {
    notificationListMock.mockResolvedValue(page([notification()], 1, 1));

    // A real in-app navigation carries a history key; only the very first
    // entry of a session is keyed 'default'.
    renderPage({ entry: { pathname: '/app/notifications', key: 'from-the-dropdown' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Zurück' }));

    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('falls back to the dashboard when the page was opened directly', async () => {
    notificationListMock.mockResolvedValue(page([notification()], 1, 1));

    // Bookmark, shared link or a reload: there is no previous entry, so
    // navigate(-1) would leave the app or do nothing at all.
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Zurück' }));

    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard');
  });

  it('marks a row read on its own when rendered without the topbar controller', async () => {
    notificationListMock.mockResolvedValue(page([notification()], 1, 1));

    renderPage({ withLayout: false });

    fireEvent.click(await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.'));

    await waitFor(() => expect(notificationMarkReadMock).toHaveBeenCalledWith(1));
    expect(navigateMock).toHaveBeenCalledWith('/app/crop-library?cropId=42');
  });

  it('gives the pagination ellipsis no accessible name of its own', async () => {
    // Ten pages is enough for MUI to collapse the middle into an ellipsis item,
    // which has no translation key — and must not be labelled with one.
    notificationListMock.mockResolvedValue(page([notification()], 200, 0));

    renderPage();

    await screen.findByRole('button', { name: 'Seite 2' });
    expect(screen.queryByText(/PageAriaLabel/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/PageAriaLabel/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nächste Seite' })).toBeInTheDocument();
  });

  it('pages through the history', async () => {
    notificationListMock.mockResolvedValue(page([notification()], 25, 0));

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Seite 2' }));

    await waitFor(() => expect(notificationListMock).toHaveBeenCalledWith({ page: 2, page_size: 20 }));
  });

  it('marks everything read from the page header in one request', async () => {
    notificationListMock.mockResolvedValue(page([
      notification(),
      notification({ id: 2, context: { name: 'Rote Bete' }, is_read: true }),
    ], 2, 1));

    renderPage();

    const kuerbis = await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.');
    expect(kuerbis).toHaveStyle({ fontWeight: 600 });
    fireEvent.click(await screen.findByRole('button', { name: 'Alle als gelesen markieren' }));

    await waitFor(() => expect(screen.queryByText(/ungelesen/)).not.toBeInTheDocument());
    expect(notificationMarkAllReadMock).toHaveBeenCalledTimes(1);
    expect(notificationMarkReadMock).not.toHaveBeenCalled();
    expect(kuerbis).toHaveStyle({ fontWeight: 400 });
    expect(screen.getByRole('button', { name: 'Alle als gelesen markieren' })).toBeDisabled();
  });

  it('disables the action when the badge counts nothing unread', async () => {
    notificationListMock.mockResolvedValue(page([notification({ is_read: true })], 1, 0));

    renderPage();

    await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.');
    expect(screen.getByRole('button', { name: 'Alle als gelesen markieren' })).toBeDisabled();
  });

  it('follows a "mark all as read" taken from the bell dropdown', async () => {
    notificationListMock.mockResolvedValue(page([notification()], 1, 1));

    renderPage();

    const kuerbis = await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.');
    expect(kuerbis).toHaveStyle({ fontWeight: 600 });

    await act(async () => { await layoutController?.markAllRead(); });

    expect(kuerbis).toHaveStyle({ fontWeight: 400 });
    expect(screen.queryByText(/ungelesen/)).not.toBeInTheDocument();
  });
});
