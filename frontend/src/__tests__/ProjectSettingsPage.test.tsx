import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import ProjectSettingsPage from '../pages/ProjectSettingsPage';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';

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
    seasonPatternAPI: {
      ...actual.seasonPatternAPI,
      get: (...args: unknown[]) => seasonPatternGetMock(...args),
      preview: (...args: unknown[]) => seasonPatternPreviewMock(...args),
      update: (...args: unknown[]) => seasonPatternUpdateMock(...args),
    },
  };
});

describe('ProjectSettingsPage', () => {
  beforeEach(() => {
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

  it('invites a user from project settings page', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(1));
    await waitFor(() => expect(listMembersMock).toHaveBeenCalledWith(1));

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'invitee@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Einladung senden' }));

    await waitFor(() => expect(inviteMock).toHaveBeenCalledWith(1, { email: 'invitee@example.com', role: 'member' }));
  });

  it('updates member roles and removes members from project settings page', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    await screen.findByText('Member Name');
    fireEvent.mouseDown(screen.getByLabelText('Projektrolle'));
    fireEvent.click(await screen.findByRole('option', { name: 'Admin' }));
    await waitFor(() => expect(updateMemberMock).toHaveBeenCalledWith(1, 11, 'admin'));

    fireEvent.click(screen.getByRole('button', { name: 'Aus Projekt entfernen' }));
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

    expect(await screen.findByText('martin.stipsitz@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('Ohne Anzeigenamen')).not.toBeInTheDocument();
    expect(screen.getByText('Die eigene Rolle kann hier nicht geändert werden.')).toBeInTheDocument();
    const removeSelfButton = screen.getByRole('button', { name: 'Aus Projekt entfernen' });
    expect(removeSelfButton).toBeDisabled();
    fireEvent.mouseOver(removeSelfButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Du kannst dich hier nicht selbst aus dem Projekt entfernen.',
    );
  });

  it('shows a neutral no-access state for invitations when the user is not an admin', async () => {
    authState.user = {
      id: 1,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'member' }],
    };

    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    await waitFor(() => expect(listMembersMock).toHaveBeenCalledWith(1));
    await waitFor(() => expect(listMock).not.toHaveBeenCalled());
    expect(await screen.findByText('Nur Admins können Einladungen sehen und verwalten.')).toBeInTheDocument();
    expect(screen.getByText('Nur Admins können Einladungen senden und verwalten.')).toBeInTheDocument();
    expect(screen.queryByText('Es gibt aktuell keine Einladungen.')).not.toBeInTheDocument();
    expect(screen.queryByText('Einladungen konnten nicht geladen werden.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Einladung senden' })).toBeDisabled();
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
    fireEvent.click(screen.getByRole('button', { name: 'Einladung senden' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Einladung senden' }));

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
    expect(await screen.findByText('Projektname aktualisiert.')).toBeInTheDocument();
  });

  it('updates the regional terminology setting', async () => {
    authState.user = {
      id: 1,
      memberships: [{ project_id: 1, project_name: 'Alpha', project_region: 'germany', role: 'admin' }],
    };
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);

    fireEvent.mouseDown(await screen.findByLabelText('Regionale Begriffe'));
    fireEvent.click(await screen.findByRole('option', { name: 'Österreich' }));

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledWith(1, { region: 'austria' }));
    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
    expect(await screen.findByText('Regionale Begriffe aktualisiert.')).toBeInTheDocument();
  });

  it('prevents empty project name saves and restores the old name with feedback', async () => {
    render(<MemoryRouter><ProjectSettingsPage /></MemoryRouter>);
    const projectNameInput = await screen.findByLabelText('Projektname');

    fireEvent.change(projectNameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(updateProjectMock).not.toHaveBeenCalled();
    expect(projectNameInput).toHaveValue('Alpha');
    expect(screen.getAllByText('Projektname darf nicht leer sein.').length).toBeGreaterThan(0);
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
    fireEvent.keyDown(projectNameInput, { key: 'Enter', code: 'Enter' });

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
