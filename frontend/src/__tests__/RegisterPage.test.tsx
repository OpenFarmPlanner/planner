import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import RegisterPage from '../pages/auth/RegisterPage';

const logoutMock = vi.fn(async () => undefined);
const registerMock = vi.fn(async () => 'Registrierung erfolgreich.');
let authUser: unknown = {
  id: 1,
  email: 'test@example.com',
  display_name: 'Test',
  display_label: 'test@example.com',
  is_active: true,
  default_project_id: 1,
  last_project_id: 1,
  resolved_project_id: 1,
  needs_project_selection: false,
  memberships: [],
  account_pending_deletion: false,
  scheduled_deletion_at: null,
};

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: authUser,
    register: registerMock,
    resendActivation: vi.fn(),
    logout: logoutMock,
  }),
}));

vi.mock('../api/api', () => ({
  projectAPI: {
    getPendingInvitation: vi.fn(async () => ({ data: { code: 'no_pending_invitation' } })),
  },
}));

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { user?: string }) => {
      if (key === 'auth:register.loggedInHint') {
        return `Du bist bereits angemeldet als ${params?.user}. Möchtest du einen neuen Account erstellen?`;
      }
      const map: Record<string, string> = {
        'auth:register.title': 'Registrieren',
        'auth:register.subtitle': 'Erstellen Sie Ihr kostenloses OpenFarmPlanner-Konto.',
        'auth:register.logoutAndCreate': 'Abmelden & neuen Account erstellen',
        'auth:register.backToApp': 'Zur App zurückkehren',
        'auth:register.email': 'E-Mail',
        'auth:register.displayName': 'Anzeigename',
        'auth:register.password': 'Passwort',
        'auth:register.passwordConfirm': 'Passwort bestätigen',
        'auth:register.submit': 'Konto erstellen',
        'auth:register.resendActivation': 'Aktivierungs-E-Mail erneut senden',
        'auth:register.hasAccount': 'Bereits ein Konto? Anmelden',
        'auth:register.showPassword': 'Passwort anzeigen',
        'auth:register.hidePassword': 'Passwort ausblenden',
        'auth:register.termsNoticePrefix': 'Mit dem Erstellen eines Kontos stimmen Sie den ',
        'auth:register.termsNoticeTermsLinkLabel': 'Nutzungsbedingungen',
        'auth:register.termsNoticeMiddle': ' zu. Informationen zur Verarbeitung Ihrer personenbezogenen Daten finden Sie in der ',
        'auth:register.termsNoticePrivacyLinkLabel': 'Datenschutzerklärung',
        'auth:register.termsNoticeSuffix': '.',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('RegisterPage', () => {
  beforeEach(() => {
    logoutMock.mockClear();
    registerMock.mockClear();
    authUser = {
      id: 1,
      email: 'test@example.com',
      display_name: 'Test',
      display_label: 'test@example.com',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
    };
  });

  it('password toggle buttons use translated German aria-labels (BUG-M02 regression guard)', () => {
    authUser = null;

    render(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    const toggleButtons = screen.getAllByRole('button', { name: /Passwort anzeigen/i });
    expect(toggleButtons).toHaveLength(2);
    toggleButtons.forEach((btn) => {
      expect(btn).not.toHaveAttribute('aria-label', 'Show password');
      expect(btn).not.toHaveAttribute('aria-label', 'Hide password');
    });
  });

  it('password fields carry autocomplete="new-password" (BUG-L02 regression guard)', () => {
    authUser = null;

    render(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    const passwordInputs = screen
      .getAllByLabelText(/Passwort/i)
      .filter((el) => el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password');
    expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    passwordInputs.forEach((input) => {
      expect(input).toHaveAttribute('autocomplete', 'new-password');
    });
  });

  it('keeps password visibility toggles keyboard accessible', async () => {
    authUser = null;
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    const toggleButton = screen.getAllByRole('button', { name: 'Passwort anzeigen' })[0];

    for (let tabs = 0; tabs < 10 && document.activeElement !== toggleButton; tabs += 1) {
      await user.tab();
    }

    expect(toggleButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(passwordInput.type).toBe('text');
    expect(toggleButton).toHaveFocus();
    expect(toggleButton).toHaveAccessibleName('Passwort ausblenden');

    await user.keyboard(' ');
    expect(passwordInput.type).toBe('password');
    expect(toggleButton).toHaveFocus();
    expect(toggleButton).toHaveAccessibleName('Passwort anzeigen');
  });

  it('shows logged-in info banner and account-switch actions instead of redirecting', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Registrieren')).toBeInTheDocument();
    expect(screen.getByText(/Du bist bereits angemeldet als/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abmelden & neuen Account erstellen' }));

    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('registers without a terms-acceptance checkbox (account creation implies consent)', async () => {
    authUser = null;
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    const submitButton = screen.getByRole('button', { name: 'Konto erstellen' });
    expect(submitButton).toBeEnabled();

    await user.type(screen.getByLabelText(/E-Mail/i), 'new@example.com');
    const passwordInputs = screen.getAllByLabelText(/^Passwort/i).filter((el) => el.tagName === 'INPUT');
    await user.type(passwordInputs[0], 'new-safe-password-123');
    await user.type(passwordInputs[1], 'new-safe-password-123');

    await user.click(submitButton);

    expect(registerMock).toHaveBeenCalledWith('new@example.com', 'new-safe-password-123', 'new-safe-password-123', '', '');
  }, 20000);

  it('shows a shared legal notice linking to the terms and the privacy policy', () => {
    authUser = null;

    render(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Nutzungsbedingungen' })).toHaveAttribute('href', '/nutzungsbedingungen');
    expect(screen.getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute('href', '/datenschutz');
  });

  it('hides the resend-activation-email action until a registration has succeeded', async () => {
    authUser = null;
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Aktivierungs-E-Mail erneut senden' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/E-Mail/i), 'new@example.com');
    const passwordInputs = screen.getAllByLabelText(/^Passwort/i).filter((el) => el.tagName === 'INPUT');
    await user.type(passwordInputs[0], 'new-safe-password-123');
    await user.type(passwordInputs[1], 'new-safe-password-123');
    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(await screen.findByRole('button', { name: 'Aktivierungs-E-Mail erneut senden' })).toBeInTheDocument();
  }, 20000);
});
