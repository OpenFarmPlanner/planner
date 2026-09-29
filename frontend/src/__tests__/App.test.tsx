import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { AuthApiError } from '../auth/authApi';
import { resolveRouterBasename } from '../routerBasename';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';
import translations from '@/test-utils/translations';
import type { AuthUser } from '../auth/types';
import i18n from '../i18n/config';

const originalMatchMedia = window.matchMedia;

function createGuestDemoUser(): AuthUser {
  return {
    id: 99,
    email: 'guest-demo@example.com',
    display_name: 'Demo',
    display_label: 'Demo',
    public_display_name: 'Demo',
    is_active: true,
    default_project_id: 9,
    last_project_id: 9,
    resolved_project_id: 9,
    needs_project_selection: false,
    memberships: [{ project_id: 9, project_name: 'Solawi Sonnenacker', role: 'admin', is_demo_project: true }],
    account_pending_deletion: false,
    scheduled_deletion_at: null,
    pending_consents: [],
    public_library_terms_accepted: false,
    is_guest_demo: true,
    guest_demo_session_id: 123,
  };
}

function createAuthenticatedUser(
  memberships: AuthUser['memberships'] = [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
  resolvedProjectId = memberships[0]?.project_id ?? null,
): AuthUser {
  return {
    id: 1,
    email: 'demo@example.com',
    display_name: 'Demo',
    display_label: 'Demo',
    public_display_name: 'Demo',
    is_active: true,
    default_project_id: resolvedProjectId,
    last_project_id: resolvedProjectId,
    resolved_project_id: resolvedProjectId,
    needs_project_selection: false,
    memberships,
    account_pending_deletion: false,
    scheduled_deletion_at: null,
    pending_consents: [],
    public_library_terms_accepted: false,
    is_guest_demo: false,
    guest_demo_session_id: null,
  };
}

function mockMobileTopbarViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width') || query.includes('down'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const authState = {
  user: null as AuthUser | null,
  isLoading: false,
  activeProjectId: null as number | null,
  login: vi.fn(async () => (({}) as AuthUser)),
  logout: vi.fn(async () => {}),
  register: vi.fn(async () => ({ detail: 'ok' })),
  activate: vi.fn(async () => {}),
  resendActivation: vi.fn(async () => ({ detail: 'ok' })),
  requestPasswordReset: vi.fn(async () => 'ok'),
  confirmPasswordReset: vi.fn(async () => 'ok'),
  requestAccountDeletion: vi.fn(async () => ({ detail: 'ok', scheduled_deletion_at: new Date().toISOString() })),
  restoreAccount: vi.fn(async () => (({}) as AuthUser)),
  switchActiveProject: vi.fn(async () => {}),
  startGuestDemo: vi.fn(async () => createGuestDemoUser()),
  endGuestDemo: vi.fn(async () => {}),
};

const projectApiMocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({
    data: {
      id: 2,
      name: 'Beta',
      slug: 'beta',
      description: '',
      is_active: true,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  })),
  createDemo: vi.fn(async () => ({
    data: {
      id: 9,
      name: 'Solawi Sonnenacker',
      slug: 'solawi-sonnenacker',
      description: '',
      is_active: true,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  })),
  listDeleted: vi.fn(async () => ({ data: [] })),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    projectAPI: {
      ...actual.projectAPI,
      create: projectApiMocks.create,
      createDemo: projectApiMocks.createDemo,
      listDeleted: projectApiMocks.listDeleted,
    },
  };
});

vi.mock('../commands/useCommandContext', () => ({
  useCommandContext: () => ({
    openPalette: vi.fn(),
    closePalette: vi.fn(),
    registerCommands: vi.fn(() => () => {}),
    registerCreateActions: vi.fn(() => () => {}),
    setContextTag: vi.fn(),
    currentContextTags: ['global'],
    activeCreateActions: [],
    runPrimaryCreateAction: vi.fn(),
  }),
  useCommandContextTag: vi.fn(),
  useRegisterCommands: vi.fn(),
  useRegisterCreateActions: vi.fn(),
}));

describe('App', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    authState.user = null;
    authState.isLoading = false;
    authState.activeProjectId = null;
    authState.switchActiveProject.mockClear();
    authState.startGuestDemo.mockClear();
    authState.endGuestDemo.mockClear();
    authState.logout.mockClear();
    authState.startGuestDemo.mockResolvedValue(createGuestDemoUser());
    projectApiMocks.create.mockClear();
    projectApiMocks.createDemo.mockClear();
    projectApiMocks.listDeleted.mockClear();
    projectApiMocks.listDeleted.mockResolvedValue({ data: [] });
    projectApiMocks.createDemo.mockResolvedValue({
      data: {
        id: 9,
        name: 'Solawi Sonnenacker',
        slug: 'solawi-sonnenacker',
        description: '',
        is_active: true,
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    });
    await i18n.changeLanguage('de');
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('renders public home page on root path', async () => {
    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByText('OpenFarmPlanner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Impressum' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Datenschutzerklärung' })).toBeInTheDocument();
  });

  it('switches the public landing page product tour screenshot by tab', async () => {
    const user = userEvent.setup();

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByRole('tab', { name: 'Flächen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Flächen',
      'Kulturen',
      'Anbaupläne',
      'Kalender',
      'Erträge',
      'Saatgut',
    ]);
    expect(screen.getByRole('img', {
      name: 'Tabellenansicht der Anbauflächen mit Standorten, Parzellen und Beeten',
    })).toHaveAttribute('src', '/landing/screenshots/demo-areas.webp');

    await user.click(screen.getByRole('tab', { name: 'Saatgut' }));

    expect(screen.getByRole('tab', { name: 'Saatgut' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Saatgutbedarf aus den Plänen ableiten' })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: 'Saatgutbedarf-Tabelle mit Kulturen, Lieferanten, benötigter Menge und Packungsvorschlägen',
    })).toHaveAttribute('src', '/landing/screenshots/demo-seed-demand.webp');

    await user.click(screen.getByRole('tab', { name: 'Erträge' }));

    expect(screen.getByRole('tab', { name: 'Erträge' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Erwartete Ernten im Blick behalten' })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: 'Ertragsübersicht mit erwarteten Erntemengen nach Kalenderwochen und Kulturen',
    })).toHaveAttribute('src', '/landing/screenshots/demo-yield-overview.webp');
  });

  it('uses English product tour screenshots when the landing page is displayed in English', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('en');
    localStorage.setItem('ui.language', 'en');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByRole('tab', { name: 'Areas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Areas',
      'Crops',
      'Planting plans',
      'Calendar',
      'Yields',
      'Seeds',
    ]);
    expect(screen.getByRole('img', {
      name: 'Table view of growing areas with locations, fields, and beds',
    })).toHaveAttribute('src', '/landing/screenshots/demo-areas-en.webp');

    await user.click(screen.getByRole('tab', { name: 'Seeds' }));

    expect(screen.getByRole('tab', { name: 'Seeds' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Derive seed demand from plans' })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: 'Seed demand table with crops, suppliers, required amount, and package suggestions',
    })).toHaveAttribute('src', '/landing/screenshots/demo-seed-demand-en.webp');

    await user.click(screen.getByRole('tab', { name: 'Yields' }));

    expect(screen.getByRole('tab', { name: 'Yields' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Keep expected harvests in view' })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: 'Yield overview with expected harvest quantities by calendar week and crop',
    })).toHaveAttribute('src', '/landing/screenshots/demo-yield-overview-en.webp');
  });

  it('starts the public guest demo from the landing page', async () => {
    const user = userEvent.setup();

    authState.startGuestDemo.mockImplementationOnce(async () => {
      const demoUser = createGuestDemoUser();
      authState.user = demoUser;
      authState.activeProjectId = demoUser.resolved_project_id;
      return demoUser;
    });

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await user.click(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' }));

    await waitFor(() => {
      expect(authState.startGuestDemo).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe('/app/fields-beds');
    });
  });

  it('renders the shareable demo link without starting a session automatically', async () => {
    window.history.pushState({}, '', '/demo');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByRole('heading', { name: 'Demo ausprobieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo jetzt starten' })).toBeInTheDocument();
    expect(authState.startGuestDemo).not.toHaveBeenCalled();
  });

  it('starts the public guest demo from the shareable demo link', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/demo');

    authState.startGuestDemo.mockImplementationOnce(async () => {
      const demoUser = createGuestDemoUser();
      authState.user = demoUser;
      authState.activeProjectId = demoUser.resolved_project_id;
      return demoUser;
    });

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await user.click(await screen.findByRole('button', { name: 'Demo jetzt starten' }));

    await waitFor(() => {
      expect(authState.startGuestDemo).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe('/app/fields-beds');
    });
  });

  it('prevents duplicate public guest demo requests while one is running', async () => {
    let resolveRequest: (value: AuthUser) => void = () => {};
    authState.startGuestDemo.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    const button = await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(authState.startGuestDemo).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /Demo wird gestartet/ })).toBeDisabled();

    act(() => {
      const demoUser = createGuestDemoUser();
      authState.user = demoUser;
      authState.activeProjectId = demoUser.resolved_project_id;
      resolveRequest(demoUser);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/app/fields-beds');
    });
  });

  it('shows a rate-limit message and re-enables the demo button after the retry window', async () => {
    authState.startGuestDemo.mockRejectedValueOnce(new AuthApiError('Request was throttled.', {
      status: 429,
      retryAfterSeconds: 1,
      payload: { retry_after: 1 },
    }));

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' }));

    expect(await screen.findByText(
      'Die Demo wurde vor Kurzem bereits gestartet. Bitte versuche es in weniger als einer Minute erneut.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo wieder verfügbar in < 1 Min.' })).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Demo ohne Registrierung ansehen' })).not.toBeDisabled();
    }, { timeout: 2500 });
  });

  it('uses a less-than-one-minute rate-limit message for short retry windows', async () => {
    authState.startGuestDemo.mockRejectedValueOnce(new AuthApiError('Request was throttled.', {
      status: 429,
      retryAfterSeconds: 30,
      payload: { retry_after: 30 },
    }));

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' }));

    expect(await screen.findByText(
      'Die Demo wurde vor Kurzem bereits gestartet. Bitte versuche es in weniger als einer Minute erneut.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo wieder verfügbar in < 1 Min.' })).toBeDisabled();
  });

  it('shows a generic rate-limit message when retry duration is missing or invalid', async () => {
    authState.startGuestDemo.mockRejectedValueOnce(new AuthApiError('Request was throttled.', {
      status: 429,
      payload: { retry_after: 'later' },
    }));

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' }));

    expect(await screen.findByText(
      'Die Demo wurde vor Kurzem bereits gestartet. Bitte versuche es später erneut.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo ohne Registrierung ansehen' })).not.toBeDisabled();
  });

  it('shows a network-specific error when the public guest demo is unreachable', async () => {
    authState.startGuestDemo.mockRejectedValueOnce(new AuthApiError('network', { isNetworkError: true }));

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' }));

    expect(await screen.findByText(
      'Die Demo ist derzeit nicht erreichbar. Bitte prüfe deine Internetverbindung und versuche es später erneut.',
    )).toBeInTheDocument();
  });

  it('shows a server-specific error when the public guest demo fails on the backend', async () => {
    authState.startGuestDemo.mockRejectedValueOnce(new AuthApiError('server', { status: 500 }));

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' }));

    expect(await screen.findByText(
      'Die Demo konnte wegen eines Serverfehlers nicht gestartet werden. Bitte versuche es später erneut.',
    )).toBeInTheDocument();
  });

  it('shows an unexpected-response error when the public guest demo response cannot be read', async () => {
    authState.startGuestDemo.mockRejectedValueOnce(new AuthApiError('unexpected', {
      status: 200,
      code: 'unexpected_response',
    }));

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' }));

    expect(await screen.findByText(
      'Die Demo konnte nicht gestartet werden, weil die Serverantwort unerwartet war. Bitte versuche es erneut.',
    )).toBeInTheDocument();
  });

  it('shows an error when the public guest demo cannot be started', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authState.startGuestDemo.mockRejectedValueOnce(new Error('boom'));

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await user.click(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' }));

    expect(await screen.findByText('Demo konnte nicht gestartet werden. Bitte versuche es erneut.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    consoleErrorSpy.mockRestore();
  });

  it('renders imprint route', async () => {
    window.history.pushState({}, '', '/impressum');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByRole('heading', { name: 'Impressum' })).toBeInTheDocument();
  });

  it('renders privacy route', async () => {
    window.history.pushState({}, '', '/datenschutz');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByRole('heading', { name: 'Datenschutzerklärung' })).toBeInTheDocument();
  });

  it('renders navigation for authenticated users in /app', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: null,
      last_project_id: null,
      resolved_project_id: null,
      needs_project_selection: false,
      memberships: [],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = null;
    window.history.pushState({}, '', '/app/anbauplaene');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    // Without any project, project-dependent nav items stay visible for
    // onboarding but are disabled — not real navigable links — until a
    // project exists. See "disables project-dependent navigation..." below
    // for the full disabled-state assertions.
    expect(await screen.findByText('Anbauflächen')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: translations.navigation.locations })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Übersicht' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Zur Übersicht' }).length).toBeGreaterThan(0);
    expect(screen.getByText(translations.navigation.crops)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: translations.navigation.plantingPlans })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktives Projekt wechseln' })).toBeInTheDocument();
  });

  it('disables project-dependent navigation but keeps it visible when the user has no project (onboarding)', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: null,
      last_project_id: null,
      resolved_project_id: null,
      needs_project_selection: false,
      memberships: [],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = null;
    window.history.pushState({}, '', '/app/anbauplaene');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    // Still visible, so new users can see what OpenFarmPlanner offers...
    const cropLabel = await screen.findByText(translations.navigation.crops);
    expect(cropLabel).toBeInTheDocument();
    // ...but not a navigable link, and exposed as disabled for assistive tech.
    // (The interactive sidebar row itself — including its hover tooltip and
    // click/keyboard guards — is exercised directly against real pointer/
    // keyboard events in NavListItem.test.tsx; this only has to confirm the
    // wiring from RootLayout produces a disabled, non-link entry.)
    expect(screen.queryByRole('link', { name: translations.navigation.crops })).not.toBeInTheDocument();
    const disabledCropControl = cropLabel.closest('[aria-disabled]');
    expect(disabledCropControl).toHaveAttribute('aria-disabled', 'true');
  });

  it('links logo to dashboard when an active project is selected', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/locations');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    const logoLinks = await screen.findAllByRole('link', { name: 'Zur Übersicht' });
    expect(logoLinks[0]).toHaveAttribute('href', '/app/dashboard');
  });

  it('shows account settings and project settings in three-dot menu on desktop', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: null,
      last_project_id: null,
      resolved_project_id: null,
      needs_project_selection: false,
      memberships: [],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    window.history.pushState({}, '', '/app');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    fireEvent.click(await screen.findByLabelText('Mehr'));
    expect(await screen.findByText('Kontoeinstellungen')).toBeInTheDocument();
    expect(screen.getByText('Projekteinstellungen')).toBeInTheDocument();
  });

  it.each([
    ['/app/project-settings', 'Projekteinstellungen'],
    ['/app/project-selection', 'Projektauswahl'],
    ['/app/public-library-moderation', 'Kulturbibliothek moderieren'],
  ])('shows the app-route title in the topbar for %s', async (path, title) => {
    authState.user = createAuthenticatedUser();
    authState.activeProjectId = 1;
    window.history.pushState({}, '', path);

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });

  it('redirects the deprecated /app/cultures route to /app/crops', async () => {
    authState.user = createAuthenticatedUser();
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/cultures');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await screen.findByRole('heading', { level: 1, name: 'Kulturen' });
    expect(window.location.pathname).toBe('/app/crops');
  });

  it('keeps the selection when redirecting a bookmarked /app/cultures?cultureId= link', async () => {
    authState.user = createAuthenticatedUser();
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/cultures?cultureId=1&tab=details');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await screen.findByRole('heading', { level: 1, name: 'Kulturen' });
    expect(window.location.pathname).toBe('/app/crops');
    expect(window.location.search).toContain('cultureId=1');
    expect(window.location.search).toContain('tab=details');
  });

  it('does not duplicate the project settings page title inside the page content', async () => {
    authState.user = createAuthenticatedUser();
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/project-settings');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await screen.findByRole('heading', { level: 1, name: 'Projekteinstellungen' });
    expect(screen.getAllByRole('heading', { name: 'Projekteinstellungen' })).toHaveLength(1);
  });

  it('keeps the project settings title in the mobile topbar without duplicating it in content', async () => {
    mockMobileTopbarViewport();
    authState.user = createAuthenticatedUser();
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/project-settings');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await screen.findByRole('heading', { level: 1, name: 'Projekteinstellungen' });
    expect(screen.getAllByRole('heading', { name: 'Projekteinstellungen' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Menü öffnen' })).toBeInTheDocument();
  });

  // Regression coverage for a routing bug: a user with zero projects who
  // opened a project-independent page (e.g. account settings) from the
  // global menu was bounced straight back to "Erstes Projekt starten" —
  // caused by a useEffect-based redirect that fired on every pathname
  // change and only special-cased `/app/project-selection`. The redirect is
  // now a render-time guard driven by the central
  // PROJECT_INDEPENDENT_APP_ROUTES list in mainNavigation.ts.
  describe('project-selection redirect guard (no-project onboarding)', () => {
    function zeroProjectUser(): AuthUser {
      return {
        id: 1,
        email: 'demo@example.com',
        display_name: 'Demo',
        display_label: 'Demo',
        is_active: true,
        default_project_id: null,
        last_project_id: null,
        resolved_project_id: null,
        needs_project_selection: false,
        memberships: [],
        account_pending_deletion: false,
        scheduled_deletion_at: null,
        pending_consents: [],
      };
    }

    it('1) opens account settings from the menu and stays there instead of bouncing back to onboarding', async () => {
      authState.user = zeroProjectUser();
      window.history.pushState({}, '', '/app/project-selection');

      render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
      expect(await screen.findByRole('heading', { name: 'Erstes Projekt starten' })).toBeInTheDocument();

      fireEvent.click(await screen.findByLabelText('Mehr'));
      fireEvent.click(await screen.findByText('Kontoeinstellungen'));

      // AccountSettingsPage is a larger lazy chunk (profile/social/data-export
      // cards); give it enough room when this file runs under the full suite.
      expect(await screen.findByRole('heading', { name: 'Kontoeinstellungen' }, { timeout: 15000 })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/app/account-settings');

      // It must not bounce back after the initial navigation settles.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(window.location.pathname).toBe('/app/account-settings');
      expect(screen.getByRole('heading', { name: 'Kontoeinstellungen' })).toBeInTheDocument();
    });

    it('2) keeps rendering the other project-independent route (project-selection) without looping', async () => {
      authState.user = zeroProjectUser();
      window.history.pushState({}, '', '/app/project-selection');

      render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

      expect(await screen.findByRole('heading', { name: 'Erstes Projekt starten' })).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(window.location.pathname).toBe('/app/project-selection');
      expect(screen.getByRole('heading', { name: 'Erstes Projekt starten' })).toBeInTheDocument();
    });

    it('3) still redirects project-scoped routes to project-selection for users without a project', async () => {
      authState.user = zeroProjectUser();
      window.history.pushState({}, '', '/app/fields-beds');

      render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

      expect(await screen.findByRole('heading', { name: 'Erstes Projekt starten' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/app/project-selection');
    });

    it('4) renders a project-independent route correctly on a direct/cold URL load', async () => {
      authState.user = zeroProjectUser();
      window.history.pushState({}, '', '/app/account-settings');

      render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

      expect(await screen.findByRole('heading', { name: 'Kontoeinstellungen' }, { timeout: 5000 })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/app/account-settings');
    });

    it('5) leaves routing for users with an active project unaffected', async () => {
      authState.user = {
        id: 1,
        email: 'demo@example.com',
        display_name: 'Demo',
        display_label: 'Demo',
        is_active: true,
        default_project_id: 1,
        last_project_id: 1,
        resolved_project_id: 1,
        needs_project_selection: false,
        memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
        account_pending_deletion: false,
        scheduled_deletion_at: null,
        pending_consents: [],
      };
      authState.activeProjectId = 1;
      window.history.pushState({}, '', '/app/account-settings');

      render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

      expect(await screen.findByRole('heading', { name: 'Kontoeinstellungen' }, { timeout: 5000 })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/app/account-settings');
    });
  });

  it('returns guest demo sessions to the public landing page when leaving the demo', async () => {
    authState.user = createGuestDemoUser();
    authState.activeProjectId = 9;
    window.history.pushState({}, '', '/app/fields-beds');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByLabelText('Mehr'));
    expect(await screen.findByText('Demo verlassen')).toBeInTheDocument();
    expect(screen.queryByText(/Abmelden/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Demo verlassen'));

    await waitFor(() => {
      expect(authState.endGuestDemo).toHaveBeenCalledTimes(1);
      expect(authState.logout).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe('/');
    });
    expect(await screen.findByRole('button', { name: 'Demo ohne Registrierung ansehen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrieren' })).toBeInTheDocument();
  });

  it('does not show "Demo verlassen" for authenticated users on their personal demo project', async () => {
    authState.user = createAuthenticatedUser([
      { project_id: 9, project_name: 'Solawi Sonnenacker', role: 'admin', is_demo_project: true },
      { project_id: 1, project_name: 'Alpha', role: 'admin', is_demo_project: false },
    ], 9);
    authState.activeProjectId = 9;
    window.history.pushState({}, '', '/app/fields-beds');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByLabelText('Mehr'));
    expect(await screen.findByText(/Abmelden/)).toBeInTheDocument();
    expect(screen.queryByText('Demo verlassen')).not.toBeInTheDocument();
  });

  it('only signs out authenticated users through the explicit logout action', async () => {
    authState.user = createAuthenticatedUser();
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/dashboard');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    fireEvent.click(await screen.findByLabelText('Mehr'));
    expect(screen.queryByText('Demo verlassen')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText(/Abmelden/));

    await waitFor(() => {
      expect(authState.logout).toHaveBeenCalledTimes(1);
      expect(authState.endGuestDemo).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe('/login');
    });
  });



  it('shows project actions in project switcher menu', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/anbauplaene');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aktives Projekt wechseln' }));
    expect(await screen.findByText('Projekteinstellungen')).toBeInTheDocument();
    expect(screen.queryByText('Mitglieder verwalten')).not.toBeInTheDocument();
    expect(await screen.findByText('Neues Projekt')).toBeInTheDocument();
    expect(screen.getByText('Demo-Projekt laden')).toBeInTheDocument();
    expect(screen.queryByText('Einführung erneut starten')).not.toBeInTheDocument();
    expect(screen.queryByText(/Papierkorb/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Neues Projekt'));
    expect(await screen.findByRole('heading', { name: 'Projekt anlegen' })).toBeInTheDocument();
  });

  it('stays on the current page when switching the active project from the project switcher menu', async () => {
    authState.user = createAuthenticatedUser([
      { project_id: 1, project_name: 'Alpha', role: 'admin' },
      { project_id: 2, project_name: 'Beta', role: 'admin' },
    ], 1);
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/anbauplaene');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aktives Projekt wechseln' }));
    fireEvent.click(await screen.findByText('Beta'));

    await waitFor(() => {
      expect(authState.switchActiveProject).toHaveBeenCalledWith(2);
    });
    expect(window.location.pathname).toBe('/app/anbauplaene');
  });

  it('opens the project trash from the project switcher when deleted projects exist', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = 1;
    projectApiMocks.listDeleted.mockResolvedValue({
      data: [{
        id: 7,
        name: 'Gelöscht',
        slug: 'geloescht',
        description: '',
        is_active: false,
        deleted_at: '2026-01-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }],
    });
    window.history.pushState({}, '', '/app/dashboard');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aktives Projekt wechseln' }));
    fireEvent.click(await screen.findByText('Papierkorb (1)'));

    expect(await screen.findByRole('heading', { name: 'Papierkorb' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/app/project-selection');
    expect(window.location.search).toBe('?trash=1');
  });

  it('loads the demo project directly from the project switcher menu', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/dashboard');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aktives Projekt wechseln' }));
    fireEvent.click(await screen.findByText('Demo-Projekt laden'));

    await waitFor(() => {
      expect(projectApiMocks.createDemo).toHaveBeenCalledTimes(1);
      expect(authState.switchActiveProject).toHaveBeenCalledWith(9);
    });
  });

  it('opens project settings from the project switcher menu', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/anbauplaene');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aktives Projekt wechseln' }));
    fireEvent.click(await screen.findByText('Projekteinstellungen'));

    expect(window.location.pathname).toBe('/app/project-settings');
  });

  it('opens the create-project dialog from the project switcher for users without projects', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: null,
      last_project_id: null,
      resolved_project_id: null,
      needs_project_selection: false,
      memberships: [],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = null;
    window.history.pushState({}, '', '/app/fields-beds');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aktives Projekt wechseln' }));
    fireEvent.click(await screen.findByText('Neues Projekt'));
    expect(await screen.findByRole('heading', { name: 'Projekt anlegen' })).toBeInTheDocument();
  });

  it('creates a project from the dialog with only a project name', async () => {
    const user = userEvent.setup();
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/dashboard');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aktives Projekt wechseln' }));
    fireEvent.click(await screen.findByText('Neues Projekt'));

    const projectNameInput = await screen.findByRole('textbox', { name: 'Projektname' });
    await waitFor(() => expect(projectNameInput).toHaveFocus());
    expect(screen.queryByRole('textbox', { name: 'Beschreibung' })).not.toBeInTheDocument();

    await user.type(projectNameInput, 'Beta{Enter}');

    await waitFor(() => {
      expect(projectApiMocks.create).toHaveBeenCalledWith({
        name: 'Beta',
        description: '',
      });
    });
    expect(authState.switchActiveProject).toHaveBeenCalledWith(2);
  });

  it('automatically opens onboarding for users without projects', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: null,
      last_project_id: null,
      resolved_project_id: null,
      needs_project_selection: false,
      memberships: [],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = null;
    window.history.pushState({}, '', '/app/crops');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByRole('heading', { name: 'Erstes Projekt starten' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/app/project-selection');
    expect(screen.queryByText('Fehler beim Laden der Kulturen')).not.toBeInTheDocument();
  });

  it('opens onboarding instead of supplier creation from query intent for users without projects', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: null,
      last_project_id: null,
      resolved_project_id: null,
      needs_project_selection: false,
      memberships: [],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = null;
    window.history.pushState({}, '', '/app/suppliers?create=1');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByRole('heading', { name: 'Erstes Projekt starten' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Lieferant anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
  });

  it('navigates from split/detail pages through the sidebar without URL and content diverging', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = 1;

    for (const { initialPath, previousHeading } of [
      { initialPath: '/app/crops', previousHeading: 'Kulturbibliothek' },
      { initialPath: '/app/planting-plans', previousHeading: 'Anbaupläne' },
    ]) {
      if (initialPath === '/app/crops') {
        localStorage.setItem('selectedCropId', '1');
      }
      window.history.pushState({}, '', initialPath);
      const { unmount } = render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

      await screen.findByText('Anbauflächen');
      const fieldsBedsLink = screen
        .getAllByRole('link', { name: 'Anbauflächen' })
        .find((link) => link.getAttribute('href') === '/app/fields-beds');
      expect(fieldsBedsLink).toBeDefined();
      if (!fieldsBedsLink) {
        throw new Error('Fields and beds sidebar link was not found');
      }
      fireEvent.click(fieldsBedsLink);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/app/fields-beds');
      }, { timeout: 3000 });
      expect(await screen.findByRole('heading', { name: 'Anbauflächen' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: previousHeading })).not.toBeInTheDocument();

      unmount();
      localStorage.clear();
    }
  });


  it('resolves basename only when current path matches configured base', () => {
    expect(resolveRouterBasename('/openfarmplanner', '/openfarmplanner/invite/abc')).toBe('/openfarmplanner');
    expect(resolveRouterBasename('/openfarmplanner', '/invite/abc')).toBe('');
  });

  it('redirects unauthenticated users from /app to login', async () => {
    window.history.pushState({}, '', '/app');
    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);
    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('redirects authenticated users from unknown /app/* routes to dashboard (BUG-M01 regression guard)', async () => {
    authState.user = {
      id: 1,
      email: 'demo@example.com',
      display_name: 'Demo',
      display_label: 'Demo',
      is_active: true,
      default_project_id: 1,
      last_project_id: 1,
      resolved_project_id: 1,
      needs_project_selection: false,
      memberships: [{ project_id: 1, project_name: 'Alpha', role: 'admin' }],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };
    authState.activeProjectId = 1;
    window.history.pushState({}, '', '/app/this-does-not-exist');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await screen.findByText('Anbauflächen');
    expect(window.location.pathname).toBe('/app/dashboard');
  });

  it('redirects unknown top-level routes to home', async () => {
    window.history.pushState({}, '', '/this-page-does-not-exist');

    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    expect(await screen.findByText('OpenFarmPlanner')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
