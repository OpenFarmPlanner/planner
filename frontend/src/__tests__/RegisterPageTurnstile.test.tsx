import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import RegisterPage from '../pages/auth/RegisterPage';
import { AuthApiError } from '../auth/authApi';
import type { TurnstileApi, TurnstileRenderOptions } from '../auth/turnstile';

const registerMock = vi.fn<(...args: unknown[]) => Promise<{ detail: string }>>();
const loadTurnstileScriptMock = vi.fn<() => Promise<TurnstileApi>>();

vi.mock('../auth/turnstile', () => ({
  resolveTurnstileSiteKey: () => 'test-site-key',
  loadTurnstileScript: () => loadTurnstileScriptMock(),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: null,
    register: registerMock,
    resendActivation: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../api/api', () => ({
  projectAPI: {
    getPendingInvitation: vi.fn(async () => ({ data: { code: 'no_pending_invitation' } })),
  },
}));

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'auth:register.email': 'E-Mail',
        'auth:register.password': 'Passwort',
        'auth:register.passwordConfirm': 'Passwort bestätigen',
        'auth:register.submit': 'Konto erstellen',
      };
      return map[key] ?? key;
    },
    i18n: { resolvedLanguage: 'de' },
  }),
}));

function createTurnstileApi() {
  let options: TurnstileRenderOptions | undefined;
  const api = {
    render: vi.fn((_container: HTMLElement, renderOptions: TurnstileRenderOptions) => {
      options = renderOptions;
      return 'widget-1';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return {
    api,
    renderOptions: (): TurnstileRenderOptions => {
      if (!options) {
        throw new Error('Turnstile widget was not rendered');
      }
      return options;
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <RegisterPage />
    </MemoryRouter>,
  );
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/E-Mail/i), 'new@example.com');
  const passwordInputs = screen.getAllByLabelText(/^Passwort/i).filter((el) => el.tagName === 'INPUT');
  await user.type(passwordInputs[0], 'new-safe-password-123');
  await user.type(passwordInputs[1], 'new-safe-password-123');
}

describe('RegisterPage with Turnstile', () => {
  beforeEach(() => {
    registerMock.mockReset();
    registerMock.mockResolvedValue({ detail: 'Registrierung erfolgreich.' });
    loadTurnstileScriptMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an invisible, full-width widget and sends its token with the registration', async () => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
    expect(turnstile.renderOptions()).toMatchObject({
      sitekey: 'test-site-key',
      action: 'register',
      appearance: 'interaction-only',
      size: 'flexible',
      language: 'de',
    });

    act(() => turnstile.renderOptions().callback?.('token-123'));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(registerMock).toHaveBeenCalledWith(
      'new@example.com',
      'new-safe-password-123',
      'new-safe-password-123',
      '',
      '',
      'token-123',
    );
    // A successful registration swaps the form for the confirmation view, so
    // the widget is removed and its single-use token discarded with it.
    expect(await screen.findByRole('button', { name: 'auth:activationEmail.resend' })).toBeInTheDocument();
    expect(turnstile.api.remove).toHaveBeenCalledWith('widget-1');
  }, 20000);

  it('blocks submission with a hint while no token is available yet', async () => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(registerMock).not.toHaveBeenCalled();
    expect(screen.getByText('auth:register.turnstile.pending')).toBeInTheDocument();
  }, 20000);

  it('drops an expired token so it is never sent', async () => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    act(() => turnstile.renderOptions().callback?.('token-123'));
    act(() => turnstile.renderOptions()['expired-callback']?.());
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(registerMock).not.toHaveBeenCalled();
    expect(screen.getByText('auth:register.turnstile.pending')).toBeInTheDocument();
  }, 20000);

  it('shows a notice while the widget errors and clears it once a new token arrives', async () => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    renderPage();
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    act(() => turnstile.renderOptions()['error-callback']?.('300010'));
    expect(screen.getByText('auth:register.turnstile.challengeFailed')).toBeInTheDocument();

    act(() => turnstile.renderOptions().callback?.('token-456'));
    expect(screen.queryByText('auth:register.turnstile.challengeFailed')).not.toBeInTheDocument();
  });

  it.each([
    ['turnstile_failed', 'auth:register.turnstile.rejected'],
    ['turnstile_unavailable', 'auth:register.turnstile.unavailable'],
  ])('maps the backend %s error to a localized message and restarts the check', async (code, messageKey) => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    registerMock.mockRejectedValue(new AuthApiError('backend detail', { code, status: 400 }));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    act(() => turnstile.renderOptions().callback?.('token-123'));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(await screen.findByText(messageKey)).toBeInTheDocument();
    expect(screen.queryByText('backend detail')).not.toBeInTheDocument();
    expect(turnstile.api.reset).toHaveBeenCalledWith('widget-1');
  }, 20000);

  it.each([
    ['error-callback' as const, 'a failed challenge'],
    ['expired-callback' as const, 'an expired token'],
    ['timeout-callback' as const, 'a timed-out token'],
  ])('drops the token on %s, so %s is never submitted', async (callbackName) => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    act(() => turnstile.renderOptions().callback?.('token-123'));
    await fillForm(user);

    // Turnstile tokens are single-use and each of these three means the one
    // in hand is no longer good for anything. Submitting it anyway would
    // send the backend a token it must reject -- the notice alone is not the
    // point, dropping the token is.
    act(() => (turnstile.renderOptions()[callbackName] as (code?: string) => void)?.('300010'));
    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(registerMock).not.toHaveBeenCalled();
    expect(screen.getByText('auth:register.turnstile.pending')).toBeInTheDocument();
  }, 20000);

  it('keeps the invisible widget out of the form until a challenge appears', async () => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    renderPage();
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    // `display: contents` so the empty container adds neither a row nor the
    // form Stack's spacing while the check passes in the background.
    const container = screen.getByTestId('turnstile-widget');
    expect(container).toHaveStyle({ display: 'contents' });

    act(() => turnstile.renderOptions()['before-interactive-callback']?.());

    // Once Cloudflare actually asks for an interaction it needs its own row.
    expect(container).toHaveStyle({ display: 'block' });

    act(() => turnstile.renderOptions()['after-interactive-callback']?.());

    expect(container).toHaveStyle({ display: 'contents' });
  }, 20000);

  it('renders the widget in the active theme', async () => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    renderPage();
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    // Asserts that a theme is passed at all -- dropping the option would
    // leave Cloudflare to pick one. It cannot tell `themeMode` from a
    // hardcoded 'light': the app ships a single light theme with no dark
    // mode, so the two are the same value today. The widget reads
    // `palette.mode` for the dark mode the app does not have yet, and only
    // introducing one could make that distinction observable.
    expect(turnstile.renderOptions().theme).toBe('light');
  }, 20000);

  it('retries loading the script automatically after a load failure', async () => {
    vi.useFakeTimers();
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValue(turnstile.api);
    renderPage();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('auth:register.turnstile.loadFailed')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(loadTurnstileScriptMock).toHaveBeenCalledTimes(2);
    expect(turnstile.api.render).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('auth:register.turnstile.loadFailed')).not.toBeInTheDocument();
  });

  it('removes the widget when the page unmounts', async () => {
    const turnstile = createTurnstileApi();
    loadTurnstileScriptMock.mockResolvedValue(turnstile.api);
    const { unmount } = renderPage();
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    unmount();

    expect(turnstile.api.remove).toHaveBeenCalledWith('widget-1');
  });
});
