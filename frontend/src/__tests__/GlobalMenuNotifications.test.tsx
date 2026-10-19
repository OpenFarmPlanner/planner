import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GlobalMenu } from '../navigation/GlobalMenu';
import { useNotifications } from '../notifications/useNotifications';
import { useNotificationMenuItems } from '../notifications/useNotificationMenuItems';
import i18n from '../i18n/config';
import type { AppNotification } from '../api/types';

const { notificationListMock, notificationMarkReadMock, navigateMock } = vi.hoisted(() => ({
  notificationListMock: vi.fn(),
  notificationMarkReadMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    notificationAPI: { list: notificationListMock, markRead: notificationMarkReadMock },
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

/** Mirrors RootLayout's compact branch: the entries are built outside the menu and passed in. */
function MenuHarness({ compact }: { compact: boolean }) {
  const controller = useNotifications(true);
  const items = useNotificationMenuItems(controller, () => {});
  return (
    <GlobalMenu
      anchorEl={document.body}
      open
      historyLoading={false}
      userLabel=""
      isMobile={compact}
      notificationItems={compact ? items : undefined}
      onClose={() => {}}
      onOpenProjectSwitcher={() => {}}
      onOpenCreateProject={() => {}}
      onOpenProjectSettings={() => {}}
      onOpenProjectHistory={async () => {}}
      onOpenAccountSettings={() => {}}
      onOpenShortcuts={() => {}}
      onOpenHelp={() => {}}
      onOpenFeedback={() => {}}
      canLeaveDemoProject={false}
      isGuestDemoSession={false}
      onLeaveDemoProject={async () => {}}
      onLogout={async () => {}}
      t={(key: string) => i18n.t(key, { ns: 'navigation' })}
    />
  );
}

const renderMenu = (compact = true) => render(
  <MemoryRouter>
    <MenuHarness compact={compact} />
  </MemoryRouter>,
);

describe('GlobalMenu notifications section', () => {
  beforeEach(() => {
    notificationListMock.mockReset();
    notificationMarkReadMock.mockReset();
    navigateMock.mockReset();
    notificationMarkReadMock.mockResolvedValue({ data: notification({ is_read: true }) });
    notificationListMock.mockResolvedValue({
      data: { count: 1, next: null, previous: null, results: [notification()], unread_count: 1 },
    });
  });

  it('lists the notifications inside the compact topbar menu', async () => {
    renderMenu();

    expect(await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.')).toBeInTheDocument();
    expect(screen.getByText(/vor 2 Tagen/)).toBeInTheDocument();
    expect(screen.getByText('Benachrichtigungen')).toBeInTheDocument();
  });

  it('marks the clicked entry as read and navigates', async () => {
    renderMenu();

    fireEvent.click(await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.'));

    await waitFor(() => expect(notificationMarkReadMock).toHaveBeenCalledWith(1));
    expect(navigateMock).toHaveBeenCalledWith('/app/crop-library?cropId=42');
  });

  it('shows a subtle hint when nothing is unread, and still links to the history', async () => {
    notificationListMock.mockResolvedValue({
      data: { count: 0, next: null, previous: null, results: [], unread_count: 0 },
    });

    renderMenu();

    expect(await screen.findByText('Keine neuen Benachrichtigungen')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Alle Benachrichtigungen anzeigen'));

    expect(navigateMock).toHaveBeenCalledWith('/app/notifications');
  });

  it('drops entries that were marked read since the last load', async () => {
    notificationListMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          notification(),
          notification({ id: 2, notification_type: 'crop_species_proposal_rejected', context: { name: 'Rote Bete' }, is_read: true }),
        ],
        unread_count: 1,
      },
    });

    renderMenu();

    expect(await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.')).toBeInTheDocument();
    expect(screen.queryByText('Dein Vorschlag für die Kulturart „Rote Bete“ wurde abgelehnt.')).not.toBeInTheDocument();
  });

  it('opens with focus in its first section instead of further down the list', async () => {
    renderMenu();

    await screen.findByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.');

    // MUI's default `selectedMenu` variant hands the initial focus to a
    // *selected* item further down (originally the active language), and
    // focusing it scrolls the menu there, which made the dropdown open showing
    // its bottom. Focus has to stay in the first section.
    const menuItems = Array.from(screen.getByRole('menu').querySelectorAll('li'));
    const secondSectionLabel = screen.getByRole('menuitem', { name: 'Projektaktionen' });

    await waitFor(() => expect(menuItems).toContain(document.activeElement));
    expect(menuItems.indexOf(document.activeElement as HTMLElement))
      .toBeLessThan(menuItems.indexOf(secondSectionLabel));
  });

  it('omits the section entirely on the full topbar, where the bell owns it', async () => {
    renderMenu(false);

    await waitFor(() => expect(notificationListMock).toHaveBeenCalled());
    expect(screen.queryByText('Dein Vorschlag für die Kulturart „Kürbis“ wurde angenommen.')).not.toBeInTheDocument();
    expect(screen.queryByText('Benachrichtigungen')).not.toBeInTheDocument();
  });
});
