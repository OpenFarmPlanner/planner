import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import LoginPage from '../pages/auth/LoginPage';
import RegisterPage from '../pages/auth/RegisterPage';
import type { AuthUser } from '../auth/types';

const endGuestDemoMock = vi.fn(async () => undefined);
const logoutMock = vi.fn(async () => undefined);
let authUser: AuthUser | null = null;

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: authUser,
    login: vi.fn(),
    register: vi.fn(),
    restoreAccount: vi.fn(),
    endGuestDemo: endGuestDemoMock,
    logout: logoutMock,
  }),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    projectAPI: {
      ...actual.projectAPI,
      getPendingInvitation: vi.fn(async () => ({ data: { code: 'no_pending_invitation' } })),
    },
  };
});

function makeUser(isGuestDemo: boolean): AuthUser {
  return {
    id: 1,
    email: isGuestDemo ? 'guest@demo.invalid' : 'real@example.com',
    display_name: '',
    display_label: 'User',
    public_display_name: '',
    is_active: true,
    default_project_id: 3,
    last_project_id: 3,
    resolved_project_id: 3,
    needs_project_selection: false,
    memberships: [{ project_id: 3, project_name: 'Projekt', role: 'admin' }],
    account_pending_deletion: false,
    scheduled_deletion_at: null,
    pending_consents: [],
    public_library_terms_accepted: false,
    is_guest_demo: isGuestDemo,
    guest_demo_session_id: isGuestDemo ? 9 : null,
    has_password: !isGuestDemo,
  };
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<div>App target</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('auth pages with an active session', () => {
  beforeEach(() => {
    endGuestDemoMock.mockClear();
    logoutMock.mockClear();
  });

  it('ends a guest demo and shows the login form', async () => {
    authUser = makeUser(true);
    renderAt('/login');
    expect(await screen.findByLabelText('Passwort *')).toBeInTheDocument();
    expect(screen.queryByText('App target')).not.toBeInTheDocument();
    await waitFor(() => expect(endGuestDemoMock).toHaveBeenCalledTimes(1));
  });

  it('ends a guest demo and shows the registration form without the logged-in hint', async () => {
    authUser = makeUser(true);
    renderAt('/register');
    await waitFor(() => expect(endGuestDemoMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Abmelden &/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('E-Mail *')).toBeInTheDocument();
  });

  it('falls back to logout when ending the demo fails', async () => {
    authUser = makeUser(true);
    endGuestDemoMock.mockRejectedValueOnce(new Error('network'));
    renderAt('/login');
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });

  it('still redirects a real account from the login page into the app', async () => {
    authUser = makeUser(false);
    renderAt('/login');
    expect(await screen.findByText('App target')).toBeInTheDocument();
    expect(endGuestDemoMock).not.toHaveBeenCalled();
  });
});
