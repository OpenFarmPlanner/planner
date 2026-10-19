import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AccountSettingsSocialMethods as AccountSettingsSocialCard } from '../pages/accountSettingsSocialCard';
import type { SocialConnection, SocialProvider } from '../auth/socialAuth';

const authUser = { is_guest_demo: false, has_password: true };

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: authUser }),
}));

const getSocialProvidersMock = vi.fn();
const getSocialConnectionsMock = vi.fn();
const startSocialLoginMock = vi.fn();

vi.mock('../auth/socialAuth', async () => {
  const actual = await vi.importActual<typeof import('../auth/socialAuth')>('../auth/socialAuth');
  return {
    ...actual,
    getSocialProviders: () => getSocialProvidersMock(),
    getSocialConnections: () => getSocialConnectionsMock(),
    startSocialLogin: (provider: SocialProvider, options?: { process?: string }) =>
      startSocialLoginMock(provider, options),
  };
});

const providers: SocialProvider[] = [
  { id: 'google', name: 'Google', login_url: '/api/auth/social/google/login/' },
  { id: 'microsoft', name: 'Microsoft', login_url: '/api/auth/social/microsoft/login/' },
];

function connection(overrides: Partial<SocialConnection> = {}): SocialConnection {
  return {
    id: 1,
    provider: 'google',
    provider_name: 'Google',
    email: 'google-user@example.com',
    connected_at: '2026-07-01T10:00:00Z',
    can_disconnect: true,
    ...overrides,
  };
}

function renderCard(initialPath = '/app/account-settings') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AccountSettingsSocialCard />
    </MemoryRouter>,
  );
}

describe('AccountSettingsSocialCard', () => {
  beforeEach(() => {
    getSocialProvidersMock.mockReset();
    getSocialConnectionsMock.mockReset();
    startSocialLoginMock.mockReset();
    authUser.is_guest_demo = false;
    authUser.has_password = true;
  });

  it('lists linked identities and offers the missing provider', async () => {
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([connection()]);

    renderCard();

    expect(await screen.findByText(/Google · google-user@example.com · verknüpft seit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mit Microsoft verknüpfen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mit Google verknüpfen' })).not.toBeInTheDocument();
  });

  it('keeps the previous linked identity text when no provider email is available', async () => {
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([connection({ email: null })]);

    renderCard();

    expect(await screen.findByText(/Google · verknüpft seit/)).toBeInTheDocument();
    expect(screen.queryByText(/google-user@example.com/)).not.toBeInTheDocument();
  });

  it('starts the connect flow for a provider that is not linked yet', async () => {
    const user = userEvent.setup();
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([]);
    startSocialLoginMock.mockReturnValue(new Promise(() => {}));

    renderCard();
    await user.click(await screen.findByRole('button', { name: 'Mit Google verknüpfen' }));

    expect(startSocialLoginMock).toHaveBeenCalledWith(providers[0], { process: 'connect' });
  });

  it('shows a provider-neutral description that does not announce unavailable providers', async () => {
    getSocialProvidersMock.mockResolvedValue([providers[0]]);
    getSocialConnectionsMock.mockResolvedValue([connection()]);

    renderCard();

    expect(await screen.findByText('Diese Anmeldemethoden sind mit deinem Konto verknüpft.')).toBeInTheDocument();
    expect(screen.queryByText(/Microsoft/)).not.toBeInTheDocument();
  });

  it('shows email/password as an active login method when the account has a usable password', async () => {
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([connection()]);

    renderCard();

    expect(await screen.findByText('E-Mail & Passwort · Aktiv')).toBeInTheDocument();
  });

  it('renders linked login methods as non-interactive status rows', async () => {
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([connection()]);

    renderCard();

    expect(await screen.findByText('E-Mail & Passwort · Aktiv')).toBeInTheDocument();
    expect(screen.getByText(/Google · google-user@example.com · verknüpft seit/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /E-Mail & Passwort/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Google · google-user@example.com · verknüpft seit/ }),
    ).not.toBeInTheDocument();
  });

  it('does not offer disconnecting a linked login method', async () => {
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([connection()]);

    renderCard();

    await screen.findByText(/Google · google-user@example.com · verknüpft seit/);
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
  });

  it('confirms a completed connect reported by the backend redirect', async () => {
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([connection()]);

    renderCard('/app/account-settings?social_status=connected');

    expect(await screen.findByText('Die Anmeldemethode wurde verknüpft.')).toBeInTheDocument();
  });

  it('explains an identity that already belongs to another account', async () => {
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([]);

    renderCard('/app/account-settings?social_error=identity_already_linked');

    expect(
      await screen.findByText(/bereits mit einem anderen OpenFarmPlanner-Konto verknüpft/),
    ).toBeInTheDocument();
  });

  it('stays hidden in a guest demo session', async () => {
    authUser.is_guest_demo = true;
    getSocialProvidersMock.mockResolvedValue(providers);
    getSocialConnectionsMock.mockResolvedValue([]);

    const { container } = renderCard();

    await waitFor(() => expect(getSocialProvidersMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no provider is configured and none is linked', async () => {
    getSocialProvidersMock.mockResolvedValue([]);
    getSocialConnectionsMock.mockResolvedValue([]);

    const { container } = renderCard();

    await waitFor(() => expect(getSocialConnectionsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
