import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GLOBAL_SNACKBAR_EVENT, type GlobalSnackbarDetail } from '../utils/globalSnackbar';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import ProjectSettingsPage from '../pages/ProjectSettingsPage';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';
import { AuthContext, type AuthContextValue } from '../auth/authContextShared';

const inviteMock = vi.fn(async () => ({ data: { code: 'invitation_sent', mail_sent: true } }));
const listMock = vi.fn(async () => ({ data: [] }));
const listMembersMock = vi.fn(async () => ({
  data: [
    {
      id: 11,
      user: 2,
      user_email: 'member@example.com',
      user_display_name: 'Member Name',
      project: 1,
      role: 'member',
      created_at: '2026-03-18T08:00:00Z',
    },
  ],
}));
const updateMemberMock = vi.fn(async () => ({ data: { id: 11, role: 'admin' } }));
const removeMemberMock = vi.fn(async () => ({}));
const revokeInvitationMock = vi.fn();
const updateProjectMock = vi.fn(async () => ({ data: { id: 1, name: 'Beta' } }));
const deleteProjectMock = vi.fn(async () => ({}));
const restoreProjectMock = vi.fn(async () => ({ data: { id: 1, name: 'Alpha' } }));
const refreshUserMock = vi.fn(async () => null);
const seasonPatternGetMock = vi.fn(async () => ({ data: { start_day: 1, start_month: 1 } }));
const seasonPatternPreviewMock = vi.fn(async () => ({
  data: { periods: [], reference_season: null, transition: null },
}));
const seasonPatternUpdateMock = vi.fn(async () => ({ data: { start_day: 1, start_month: 3 } }));

const authState = {
  user: {
    id: 1,
    memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' as const }],
  },
  refreshUser: refreshUserMock,
};

vi.mock('../auth/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    projectAPI: {
      ...actual.projectAPI,
      invite: (...args: unknown[]) => inviteMock(...args),
      listInvitations: (...args: unknown[]) => listMock(...args),
      listMembers: (...args: unknown[]) => listMembersMock(...args),
      updateMember: (...args: unknown[]) => updateMemberMock(...args),
      removeMember: (...args: unknown[]) => removeMemberMock(...args),
      revokeInvitation: (...args: unknown[]) => revokeInvitationMock(...args),
      update: (...args: unknown[]) => updateProjectMock(...args),
      delete: (...args: unknown[]) => deleteProjectMock(...args),
      restore: (...args: unknown[]) => restoreProjectMock(...args),
    },
    seasonAPI: {
      ...actual.seasonAPI,
      list: async () => ({ data: { count: 0, next: null, previous: null, results: [] } }),
    },
    seasonPatternAPI: {
      ...actual.seasonPatternAPI,
      get: (...args: unknown[]) => seasonPatternGetMock(...args),
      preview: (...args: unknown[]) => seasonPatternPreviewMock(...args),
      update: (...args: unknown[]) => seasonPatternUpdateMock(...args),
    },
  };
});

let snackbars: GlobalSnackbarDetail[] = [];
const recordSnackbar = (event: Event) => snackbars.push((event as CustomEvent<GlobalSnackbarDetail>).detail);
const expectSuccessSnackbar = (message: string) =>
  waitFor(() => expect(snackbars).toContainEqual({ message, severity: 'success' }));

describe('ProjectSettingsPage', () => {
  afterEach(() => {
    window.removeEventListener(GLOBAL_SNACKBAR_EVENT, recordSnackbar);
  });

  beforeEach(() => {
    snackbars = [];
    window.addEventListener(GLOBAL_SNACKBAR_EVENT, recordSnackbar);
    window.localStorage.setItem('activeProjectId', '1');
    authState.user = {
      id: 1,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
    };
    inviteMock.mockClear();
    listMock.mockClear();
    listMembersMock.mockClear();
    updateMemberMock.mockClear();
    removeMemberMock.mockClear();
    revokeInvitationMock.mockClear();
    updateProjectMock.mockClear();
    deleteProjectMock.mockClear();
    restoreProjectMock.mockClear();
    refreshUserMock.mockClear();
    seasonPatternGetMock.mockClear();
    seasonPatternPreviewMock.mockClear();
    seasonPatternUpdateMock.mockClear();
    listMock.mockResolvedValue({ data: [] });
    listMembersMock.mockResolvedValue({
      data: [
        {
          id: 11,
          user: 2,
          user_email: 'member@example.com',
          user_display_name: 'Member Name',
          project: 1,
          role: 'member',
          created_at: '2026-03-18T08:00:00Z',
        },
      ],
    });
  });

  it('lays the settings out as tabbed sections in a fixed order', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    await screen.findByText('Member Name');

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Allgemein',
      'Saison-Muster',
      'Mitglieder',
      'Projekt löschen',
    ]);
    const nav = screen.getByRole('navigation', { name: 'Abschnitte' });
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '#general',
      '#season-pattern',
      '#members',
      '#delete-project',
    ]);
    const members = screen.getByRole('region', { name: 'Mitglieder' });
    expect(within(members).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Person einladen',
      'Mitglieder (1)',
      'Offene Einladungen',
    ]);
  });

  it('offers project deletion as the danger section with the existing confirmation dialog', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    const dangerSection = await screen.findByRole('region', { name: 'Projekt löschen' });
    expect(within(dangerSection).getByText('Gelöschte Projekte lassen sich 30 Tage lang wiederherstellen.')).toBeInTheDocument();
    fireEvent.click(within(dangerSection).getByRole('button', { name: 'Projekt löschen …' }));

    const dialog = await screen.findByRole('dialog', { name: 'Projekt wirklich löschen?' });
    expect(within(dialog).getByRole('button', { name: 'Projekt löschen' })).toBeDisabled();
  });

  it('lists only open invitations and says so plainly when there are none', async () => {
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: 3,
          email: 'accepted@example.com',
          role: 'member',
          token: 'accepted-token',
          status: 'accepted',
          resolved_status: 'accepted',
          expires_at: '2026-04-11T13:07:30Z',
          accepted_at: '2026-04-01T13:07:30Z',
          revoked_at: null,
          created_at: '2026-03-28T13:07:30Z',
        },
      ],
    });
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    const emptyText = await screen.findByText('Keine offenen Einladungen.');
    // Plain grey text, not an info box.
    expect(emptyText.closest('.MuiAlert-root')).toBeNull();
    expect(screen.queryByText('accepted@example.com')).not.toBeInTheDocument();
  });

  it('revokes an open invitation and confirms it in a snackbar', async () => {
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: 4,
          email: 'open@example.com',
          role: 'admin',
          token: 'open-token',
          status: 'pending',
          resolved_status: 'pending',
          expires_at: '2026-04-11T13:07:30Z',
          accepted_at: null,
          revoked_at: null,
          created_at: '2026-03-28T13:07:30Z',
        },
      ],
    });
    revokeInvitationMock.mockResolvedValueOnce({});
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    const row = (await screen.findByText('open@example.com')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Einladung widerrufen' }));

    await waitFor(() => expect(revokeInvitationMock).toHaveBeenCalledWith(1, 4));
    await expectSuccessSnackbar('Einladung widerrufen.');
  });

  it('invites a user from project settings page', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(1));
    await waitFor(() => expect(listMembersMock).toHaveBeenCalledWith(1));

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'invitee@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Einladen' }));

    await waitFor(() => expect(inviteMock).toHaveBeenCalledWith(1, { email: 'invitee@example.com', role: 'member' }));
    await expectSuccessSnackbar('Einladung gesendet.');
    expect(screen.getByLabelText('E-Mail')).toHaveValue('');
  });

  it('keeps the invite button enabled and explains an empty or invalid email at the field', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(1));

    const inviteButton = screen.getByRole('button', { name: 'Einladen' });
    expect(inviteButton).toBeEnabled();
    fireEvent.click(inviteButton);
    expect(await screen.findByText('Bitte gib eine E-Mail-Adresse ein.')).toBeInTheDocument();
    expect(screen.getByLabelText('E-Mail')).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'not-an-email' } });
    fireEvent.click(inviteButton);
    expect(await screen.findByText('Bitte gib eine gültige E-Mail-Adresse ein.')).toBeInTheDocument();
    expect(inviteMock).not.toHaveBeenCalled();
  });

  it('updates member roles and removes members from project settings page', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    await screen.findByText('Member Name');
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Member Name' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Zum Admin machen' }));
    await waitFor(() => expect(updateMemberMock).toHaveBeenCalledWith(1, 11, 'admin'));
    await expectSuccessSnackbar('Mitgliedsrolle aktualisiert.');

    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Member Name' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Aus Projekt entfernen' }));
    expect(await screen.findByText('Mitglied wirklich entfernen?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt entfernen' }));
    await waitFor(() => expect(removeMemberMock).toHaveBeenCalledWith(1, 11));
  });

  it('uses the member email as the primary label when the display name is empty', async () => {
    listMembersMock.mockResolvedValueOnce({
      data: [
        {
          id: 12,
          user: 1,
          user_email: 'martin.stipsitz@gmail.com',
          user_display_name: '',
          project: 1,
          role: 'admin',
          created_at: '2026-03-18T08:00:00Z',
        },
      ],
    });

    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    const ownRow = (await screen.findByText('martin.stipsitz@gmail.com')).closest('li') as HTMLElement;
    expect(screen.queryByText('Ohne Anzeigenamen')).not.toBeInTheDocument();
    // The own row shows a badge and the role as text only: the backend allows
    // neither changing your own role nor leaving, so it offers no action at all.
    expect(within(ownRow).getByText('Ich')).toBeInTheDocument();
    expect(within(ownRow).getByText('Admin')).toBeInTheDocument();
    expect(within(ownRow).getByText('MS')).toBeInTheDocument();
    expect(within(ownRow).queryByRole('button')).not.toBeInTheDocument();
    expect(within(ownRow).queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Mitglieder (1)' })).toBeInTheDocument();
  });

  it('explains in the guest demo that invitations are unavailable instead of sending one', async () => {
    const guestAuth = { user: { ...authState.user, is_guest_demo: true } } as unknown as AuthContextValue;
    render(
      <AuthContext.Provider value={guestAuth}>
        <MemoryRouter><ProjectSettingsPage /></MemoryRouter>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(listMembersMock).toHaveBeenCalledWith(1));

    expect(screen.getByTestId('guest-demo-notice')).toHaveTextContent('In der Demo kannst du keine Personen in das Projekt einladen.');
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'invitee@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Einladen' }));
    await waitFor(() => expect(snackbars).toHaveLength(1));
    expect(snackbars[0].severity).toBe('info');
    expect(inviteMock).not.toHaveBeenCalled();
  });

  it('shows a neutral no-access state for invitations when the user is not an admin', async () => {
    authState.user = {
      id: 1,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'member' }],
    };

    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    await waitFor(() => expect(listMembersMock).toHaveBeenCalledWith(1));
    await waitFor(() => expect(listMock).not.toHaveBeenCalled());
    expect(await screen.findByText(/Für die Mitgliederverwaltung benötigst du Admin-Rechte/)).toBeInTheDocument();
    // Members can neither invite nor see invitations, and get no member actions.
    expect(screen.queryByRole('heading', { name: 'Person einladen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Offene Einladungen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktionen für/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Einladungen konnten nicht geladen werden.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Projekt löschen' })).not.toBeInTheDocument();
  });

  it('shows invitation load errors only for admins when the API fails', async () => {
    listMock.mockRejectedValueOnce(new Error('boom'));

    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    expect(await screen.findByText('Einladungen konnten nicht geladen werden.')).toBeInTheDocument();
  });

  it('shows a warning alert when invitation mail delivery fails', async () => {
    inviteMock.mockResolvedValueOnce({
      data: {
        code: 'invitation_sent',
        mail_sent: false,
        invite_link: 'https://example.org/openfarmplanner/invite/accept?token=test-token',
      },
    });

    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(1));

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'invitee@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Einladen' }));

    const warningMessage = await screen.findByText(/Einladung erstellt, aber E-Mail konnte nicht zugestellt werden\./);
    const alertElement = warningMessage.closest('.MuiAlert-root');
    expect(alertElement).not.toBeNull();
    expect(alertElement?.className).toContain('MuiAlert-colorWarning');
  });

  it('prefers structured backend message for invitation errors and hides HTML details', async () => {
    inviteMock.mockRejectedValueOnce({
      response: {
        data: {
          code: 'email_send_failed',
          message: 'Die E-Mail konnte nicht gesendet werden. Bitte kontaktiere info@openfarmplanner.org.',
          detail: '<!DOCTYPE html><html><body>500 Internal Server Error</body></html>',
        },
      },
    });

    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(1));

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'invitee@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Einladen' }));

    expect(await screen.findByText(/Die E-Mail konnte nicht gesendet werden\./)).toBeInTheDocument();
    expect(screen.getByText(/info@openfarmplanner.org/)).toBeInTheDocument();
    expect(screen.queryByText(/Internal Server Error/)).not.toBeInTheDocument();
  });

  it('sorts invitations by expiry date descending', async () => {
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: 2,
          email: 'older@example.com',
          role: 'member',
          token: 'older-token',
          status: 'pending',
          resolved_status: 'pending',
          expires_at: '2026-04-11T13:07:30Z',
          accepted_at: null,
          revoked_at: null,
          created_at: '2026-03-28T13:07:30Z',
        },
        {
          id: 1,
          email: 'newer@example.com',
          role: 'member',
          token: 'newer-token',
          status: 'pending',
          resolved_status: 'pending',
          expires_at: '2026-04-12T08:58:52Z',
          accepted_at: null,
          revoked_at: null,
          created_at: '2026-03-29T08:58:52Z',
        },
      ],
    });

    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    const newerInvitation = await screen.findByText('newer@example.com');
    const olderInvitation = screen.getByText('older@example.com');
    expect(
      newerInvitation.compareDocumentPosition(olderInvitation) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('shows project name as an inline editable field', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    expect(await screen.findByLabelText('Projektname')).toHaveValue('Alpha');
    expect(screen.queryByRole('button', { name: 'Projekt umbenennen' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Regionale Begriffe')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: 'Speichern' });
    expect(saveButton).toBeDisabled();
    fireEvent.mouseOver(saveButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Es gibt keine ungespeicherten Änderungen.');
  });

  it('keeps inline project name changes unsaved when the field loses focus', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    const projectNameInput = await screen.findByLabelText('Projektname');
    expect(projectNameInput).toHaveValue('Alpha');

    fireEvent.change(projectNameInput, { target: { value: 'Beta' } });
    fireEvent.blur(projectNameInput);

    expect(updateProjectMock).not.toHaveBeenCalled();
    expect(projectNameInput).toHaveValue('Beta');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled();
  });

  it('allows renaming via PATCH from the explicit save button', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    const projectNameInput = await screen.findByLabelText('Projektname');

    fireEvent.change(projectNameInput, { target: { value: 'Beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledWith(1, { name: 'Beta' }));
    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
    await expectSuccessSnackbar('Projekteinstellungen gespeichert.');
  });

  it('updates the regional terminology setting', async () => {
    authState.user = {
      id: 1,
      memberships: [{ project_id: 1, project_name: 'Alpha', project_region: 'germany', role: 'admin' }],
    };
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    fireEvent.mouseDown(await screen.findByLabelText('Regionale Begriffe'));
    fireEvent.click(await screen.findByRole('option', { name: 'Österreich' }));
    // Name and region share one form: choosing a region alone saves nothing.
    expect(updateProjectMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledWith(1, { region: 'austria' }));
    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
    await expectSuccessSnackbar('Projekteinstellungen gespeichert.');
  });

  it('saves a changed name and region together in one request', async () => {
    authState.user = {
      id: 1,
      memberships: [{ project_id: 1, project_name: 'Alpha', project_region: 'germany', role: 'admin' }],
    };
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('Projektname'), { target: { value: 'Beta' } });
    fireEvent.mouseDown(screen.getByLabelText('Regionale Begriffe'));
    fireEvent.click(await screen.findByRole('option', { name: 'Schweiz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledWith(1, { name: 'Beta', region: 'switzerland' }));
    expect(updateProjectMock).toHaveBeenCalledTimes(1);
  });

  it('cancels unsaved general changes back to the stored values', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    const projectNameInput = await screen.findByLabelText('Projektname');

    fireEvent.change(projectNameInput, { target: { value: 'Beta' } });
    const generalSection = screen.getByRole('region', { name: 'Allgemein' });
    fireEvent.click(within(generalSection).getByRole('button', { name: 'Abbrechen' }));

    expect(projectNameInput).toHaveValue('Alpha');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('prevents empty project name saves and explains why at the field', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    const projectNameInput = await screen.findByLabelText('Projektname');

    fireEvent.change(projectNameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(updateProjectMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Projektname darf nicht leer sein.')).toBeInTheDocument();
    expect(projectNameInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('ignores unchanged project name saves', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    expect(await screen.findByLabelText('Projektname')).toHaveValue('Alpha');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();

    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('submits rename on Enter key', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    const projectNameInput = await screen.findByLabelText('Projektname');
    fireEvent.change(projectNameInput, { target: { value: 'Gamma' } });
    // Enter submits the general form (a native form submit in a browser).
    fireEvent.submit(projectNameInput.closest('form') as HTMLFormElement);

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledWith(1, { name: 'Gamma' }));
  });

  it('restores the previous inline project name on Escape without API call', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    const projectNameInput = await screen.findByLabelText('Projektname');

    fireEvent.change(projectNameInput, { target: { value: 'Delta' } });
    fireEvent.keyDown(projectNameInput, { key: 'Escape', code: 'Escape' });

    expect(updateProjectMock).not.toHaveBeenCalled();
    expect(projectNameInput).toHaveValue('Alpha');
  });

  it('offers a developer shortcut to delete the active project without typing its name', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Dev: ohne Namensbestätigung löschen' }));

    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledWith(1));
    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
  });

  it('scrolls the season-pattern section into view when deep-linked with #season-pattern', async () => {
    const original = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(
        <MemoryRouter initialEntries={['/app/project-settings#season-pattern']}>
          <ProjectSettingsPage />
        </MemoryRouter>,
      );

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      expect(document.getElementById('season-pattern')).not.toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('refreshes the active-season suggestion after the season pattern is saved', async () => {
    const reloadActiveSeason = vi.fn();
    render(
      <MemoryRouter>
        <Routes>
          <Route
            element={<Outlet context={{ reloadActiveSeason } as unknown as RootLayoutOutletContext} />}
          >
            <Route index element={<ProjectSettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.mouseDown(await screen.findByLabelText('Monat'));
    fireEvent.click(await screen.findByRole('option', { name: 'März' }));
    fireEvent.click(screen.getByRole('button', { name: 'Saison-Muster speichern' }));

    await waitFor(() => expect(seasonPatternUpdateMock).toHaveBeenCalledWith({ start_day: 1, start_month: 3 }));
    await waitFor(() => expect(reloadActiveSeason).toHaveBeenCalledTimes(1));
  });

  it('shows the last existing season and a gap row in the season-pattern preview', async () => {
    seasonPatternPreviewMock.mockResolvedValue({
      data: {
        periods: [{ start_date: '2026-01-01', end_date: '2026-12-31', is_current: true }],
        reference_season: { start_date: '2024-09-01', end_date: '2025-08-31', label: '24/25' },
        transition: { kind: 'gap', start_date: '2025-09-01', end_date: '2025-12-31' },
      },
    });

    render(
      <MemoryRouter>
        <ProjectSettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('24/25')).toBeInTheDocument();
    expect(screen.getByText('(zuletzt bestehende Saison)')).toBeInTheDocument();
    expect(screen.getByText('Lücke')).toBeInTheDocument();
    expect(screen.getByText('Optionen beim Anlegen wählbar')).toBeInTheDocument();
  });
});
