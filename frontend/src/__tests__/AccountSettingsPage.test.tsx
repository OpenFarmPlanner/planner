import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { updatePublicDisplayName } from '../auth/authApi';
import AccountSettingsPage from '../pages/AccountSettingsPage';
import { DEV_ONBOARDING_PREVIEW_STORAGE_KEY } from '../projects/devOnboardingPreview';

const authState = {
  user: {
    id: 1,
    email: 'demo@example.com',
    display_name: 'Demo',
    display_label: 'Demo',
    public_display_name: '',
    is_active: true,
    default_project_id: null,
    last_project_id: null,
    resolved_project_id: null,
    needs_project_selection: false,
    memberships: [],
    has_password: true,
    account_pending_deletion: false,
    scheduled_deletion_at: null,
  },
  requestAccountDeletion: vi.fn(async () => ({ detail: 'ok', scheduled_deletion_at: new Date().toISOString() })),
  refreshUser: vi.fn(async () => authState.user),
};

vi.mock('../auth/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('../hooks/useNavigationBlocker', () => ({
  useNavigationBlocker: vi.fn(),
}));

const moderatorRequestApiMocks = vi.hoisted(() => ({
  mine: vi.fn(async () => ({ data: { is_moderator: false, request: null } })),
  create: vi.fn(async () => ({ data: { id: 1, user: 1, user_label: 'Demo', motivation: 'I can help.', status: 'pending' } })),
}));

const socialAuthMocks = vi.hoisted(() => ({
  getSocialProviders: vi.fn(async () => []),
  getSocialConnections: vi.fn(async () => []),
  startSocialLogin: vi.fn(),
}));

vi.mock('../api/api', () => ({
  publicLibraryModeratorRequestAPI: moderatorRequestApiMocks,
  apiTokenAPI: {
    list: vi.fn(async () => ({ data: [] })),
    create: vi.fn(),
    revoke: vi.fn(),
  },
}));

vi.mock('../auth/socialAuth', async () => {
  const actual = await vi.importActual<typeof import('../auth/socialAuth')>('../auth/socialAuth');
  return {
    ...actual,
    getSocialProviders: () => socialAuthMocks.getSocialProviders(),
    getSocialConnections: () => socialAuthMocks.getSocialConnections(),
    startSocialLogin: socialAuthMocks.startSocialLogin,
  };
});

vi.mock('../auth/authApi', () => ({
  updateProfile: vi.fn(async () => ({ detail: 'Profil aktualisiert.', user: authState.user })),
  updatePublicDisplayName: vi.fn(async () => ({ detail: 'Profil aktualisiert.', user: authState.user })),
  requestEmailChange: vi.fn(async () => ({ detail: 'Bestätigungslink gesendet.' })),
  changePassword: vi.fn(async () => ({ detail: 'Passwort geändert.' })),
  getAccountDataExport: vi.fn(async () => ({ account: { email: 'demo@example.com' } })),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('AccountSettingsPage', () => {
  const createObjectURLMock = vi.fn(() => 'blob:openfarmplanner-data-export');
  const revokeObjectURLMock = vi.fn();
  const anchorClickMock = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  beforeEach(() => {
    localStorage.clear();
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
    anchorClickMock.mockClear();
    moderatorRequestApiMocks.mine.mockClear();
    moderatorRequestApiMocks.create.mockClear();
    moderatorRequestApiMocks.mine.mockResolvedValue({ data: { is_moderator: false, request: null } });
    socialAuthMocks.getSocialProviders.mockClear();
    socialAuthMocks.getSocialConnections.mockClear();
    socialAuthMocks.startSocialLogin.mockClear();
    socialAuthMocks.getSocialProviders.mockResolvedValue([
      { id: 'google', name: 'Google', login_url: '/api/auth/social/google/login/' },
    ]);
    socialAuthMocks.getSocialConnections.mockResolvedValue([]);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURLMock });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURLMock });
  });

  it('renders compact sections and keeps delete disabled until confirmation phrase is present', async () => {
    render(<MemoryRouter><AccountSettingsPage /></MemoryRouter>);

    expect(screen.getByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Kulturbibliothek')).toBeInTheDocument();
    expect(screen.getByText('Login & Sicherheit')).toBeInTheDocument();
    expect(screen.getByText('Zugangsdaten')).toBeInTheDocument();
    expect(await screen.findByText('Anmeldemethoden')).toBeInTheDocument();
    expect(screen.getByText('Diese Anmeldemethoden sind mit deinem Konto verknüpft.')).toBeInTheDocument();
    expect(screen.getByText('E-Mail & Passwort · Aktiv')).toBeInTheDocument();
    expect(screen.getByText('Datenschutz & Datenexport')).toBeInTheDocument();
    expect(screen.getByText('Konto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anzeigename ändern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Namen festlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E-Mail-Adresse ändern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Passwort ändern' })).toBeInTheDocument();
    expect(screen.getByText(/Projekte ohne verbleibende Mitglieder werden dann einschließlich Projektdaten gelöscht/)).toBeInTheDocument();
    expect(screen.getByText(/veröffentlichte Kulturbibliotheks-Einträge bleiben bestehen/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Neue E-Mail-Adresse')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Neues Passwort')).not.toBeInTheDocument();
    expect(screen.queryByText('Die Sprache der Oberfläche gehört zu deinem Konto')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meine Daten herunterladen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Onboarding erneut anzeigen' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profil' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Login & Sicherheit' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'Konto' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'E-Mail-Adresse ändern' }));
    const sendConfirmationButton = screen.getByRole('button', { name: 'Bestätigungslink senden' });
    expect(sendConfirmationButton).toBeDisabled();
    await userEvent.hover(sendConfirmationButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bitte alle Pflichtfelder ausfüllen.');

    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Anzeigename ändern' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Login & Sicherheit' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sprache' }));
    expect(screen.getByText(/Die Sprache der Oberfläche gehört zu deinem Konto/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meine Daten herunterladen' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Datenschutz & Datenexport' }));
    fireEvent.click(screen.getByRole('button', { name: 'Meine Daten herunterladen' }));
    expect(await screen.findByText('Datenexport wurde erstellt.')).toBeInTheDocument();
    expect(createObjectURLMock).toHaveBeenCalledOnce();
    expect(anchorClickMock).toHaveBeenCalledOnce();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:openfarmplanner-data-export');

    fireEvent.click(screen.getByRole('button', { name: 'Konto löschen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Projekte ohne verbleibende Mitglieder werden dann gelöscht/)).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole('button', { name: 'Konto zur Löschung vormerken' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Aktuelles Passwort'), { target: { value: 'secret' } });
    fireEvent.change(within(dialog).getByLabelText('Bestätigungstext'), { target: { value: 'DELETE' } });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Bestätigungstext'), { target: { value: 'LÖSCHEN' } });
    expect(confirmButton).toBeEnabled();
  });

  it('submits a public library moderator request from account settings', async () => {
    render(<MemoryRouter><AccountSettingsPage /></MemoryRouter>);

    expect(await screen.findByText('Als Moderator mithelfen')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Warum möchtest du moderieren?'), { target: { value: 'Ich kenne mich mit Kulturarten aus.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anfrage senden' }));

    expect(moderatorRequestApiMocks.create).toHaveBeenCalledWith('Ich kenne mich mit Kulturarten aus.');
    expect(await screen.findByText('Deine Anfrage wird geprüft.')).toBeInTheDocument();
  });

  it('saves the public display name with Enter', async () => {
    render(<MemoryRouter><AccountSettingsPage /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'Namen festlegen' }));
    const input = screen.getByLabelText('Name bei Veröffentlichungen');
    await userEvent.clear(input);
    await userEvent.type(input, 'Martin Stipsitz{Enter}');

    expect(updatePublicDisplayName).toHaveBeenCalledWith('Martin Stipsitz');
  });

  it('describes the moderator role in terms of reviewing proposals, not approving all public crop edits (BUG-M03 copy regression guard)', async () => {
    render(<MemoryRouter><AccountSettingsPage /></MemoryRouter>);

    expect(await screen.findByText('Hilf dabei, Vorschläge für neue Kulturarten zu prüfen und die Kulturbibliothek konsistent zu halten.')).toBeInTheDocument();
  });

  it('starts the developer onboarding preview without deleting data', () => {
    localStorage.setItem('activeProjectId', '1');

    render(
      <MemoryRouter initialEntries={['/app/account-settings']}>
        <Routes>
          <Route path="/app/account-settings" element={<><AccountSettingsPage /><LocationProbe /></>} />
          <Route path="/app/project-selection" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Entwickler' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onboarding erneut anzeigen' }));

    expect(localStorage.getItem(DEV_ONBOARDING_PREVIEW_STORAGE_KEY)).toBe('1');
    expect(localStorage.getItem('activeProjectId')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/project-selection');
  });
});
