import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import App from '../App';
import theme from '../theme';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';
import { createAuthStateMock, createTestUser } from '../test-utils/appHarness';
import { LAST_PROJECT_ROUTE_STORAGE_KEY } from '../navigation/lastProjectRoute';

// Account settings belong to the account, not the project: on desktop the page
// hides the project sidebar and links back to the last project page instead.

const authState = createAuthStateMock();

vi.mock('../auth/useAuth', () => ({
  useAuth: () => authState,
}));

/** Desktop viewport: only min-width (`up`) queries match. */
const stubDesktopViewport = () => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
};

const renderApp = () =>
  // The desktop sidebar reads the app theme's surface palette.
  render(<ThemeProvider theme={theme}><FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider></ThemeProvider>);

describe('RootLayout on the account settings page', () => {
  beforeEach(() => {
    authState.user = createTestUser();
    authState.activeProjectId = 1;
    window.localStorage.clear();
    window.sessionStorage.clear();
    stubDesktopViewport();
  });

  it('hides the project sidebar on account settings but keeps the topbar', async () => {
    window.history.pushState({}, '', '/app/account-settings');
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Kontoeinstellungen' }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('keeps the project sidebar on other pages and remembers project pages for the back link', async () => {
    window.history.pushState({}, '', '/app/project-settings');
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Projekteinstellungen' }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(LAST_PROJECT_ROUTE_STORAGE_KEY)).toBe('/app/project-settings');
  });
});
