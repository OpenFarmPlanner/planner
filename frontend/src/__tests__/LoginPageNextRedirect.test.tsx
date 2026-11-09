import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import LoginPage from '../pages/auth/LoginPage';
import type { AuthUser } from '../auth/types';

const loginMock = vi.fn();
const retryAuthCheckMock = vi.fn(async () => undefined);
let authUser: AuthUser | null = null;
let authLoading = false;
let sessionUnchecked = false;

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: authUser,
    isLoading: authLoading,
    isSessionUnchecked: sessionUnchecked,
    retryAuthCheck: retryAuthCheckMock,
    login: loginMock,
    restoreAccount: vi.fn(),
  }),
}));

const signedInUser: AuthUser = {
  id: 1,
  email: 'grower@example.com',
  display_name: '',
  display_label: 'grower@example.com',
  is_active: true,
  default_project_id: 4,
  last_project_id: 4,
  resolved_project_id: 4,
  needs_project_selection: false,
  memberships: [{ project_id: 4, project_name: 'Projekt', role: 'member' }],
  account_pending_deletion: false,
  scheduled_deletion_at: null,
  pending_consents: [],
} as AuthUser;

function renderLogin(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<div>App route</div>} />
        <Route path="/app/planting-plans" element={<div>Planting plans route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    projectAPI: {
      ...actual.projectAPI,
      getPendingInvitation: vi.fn(async () => ({ data: { code: 'no_pending_invitation', requires_auth: true } })),
    },
  };
});

describe('LoginPage next redirect', () => {
  beforeEach(() => {
    loginMock.mockReset();
    retryAuthCheckMock.mockClear();
    authUser = null;
    authLoading = false;
    sessionUnchecked = false;
  });

  it('sends an already signed-in user straight to /app', async () => {
    authUser = signedInUser;
    renderLogin('/login');
    expect(await screen.findByText('App route')).toBeInTheDocument();
  });

  it('keeps an explicit next URL for an already signed-in user', async () => {
    authUser = signedInUser;
    renderLogin('/login?next=/app/planting-plans');
    expect(await screen.findByText('Planting plans route')).toBeInTheDocument();
  });

  it('checks an unchecked session (arriving from a public page) before showing the form', () => {
    sessionUnchecked = true;
    renderLogin('/login');
    expect(retryAuthCheckMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Lädt...');
    expect(screen.queryByLabelText('E-Mail *')).not.toBeInTheDocument();
  });

  it('neither redirects nor shows the form while the session check is running', () => {
    authLoading = true;
    renderLogin('/login');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByLabelText('E-Mail *')).not.toBeInTheDocument();
    expect(screen.queryByText('App route')).not.toBeInTheDocument();
    expect(retryAuthCheckMock).not.toHaveBeenCalled();
  });

  it('shows the form to a visitor whose session was checked and is signed out', () => {
    renderLogin('/login');
    expect(screen.getByLabelText('E-Mail *')).toBeInTheDocument();
    expect(retryAuthCheckMock).not.toHaveBeenCalled();
  });

  it('redirects to the next URL after successful login', async () => {
    loginMock.mockResolvedValueOnce({
      memberships: [{ project_id: 4, project_name: 'Projekt', role: 'member' }],
      needs_project_selection: false,
    });

    render(
      <MemoryRouter initialEntries={['/login?next=/invite/accept?token=abc123']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/invite/accept" element={<div>Accept route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(document.querySelector('input[type="email"]') as HTMLInputElement, { target: { value: 'invitee@example.com' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'pass12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

    await waitFor(() => {
      expect(screen.getByText('Accept route')).toBeInTheDocument();
    });
  });

  it('redirects already authenticated users without projects to project selection', async () => {
    authUser = {
      id: 1,
      email: 'starter@example.com',
      display_name: '',
      display_label: 'starter@example.com',
      is_active: true,
      default_project_id: null,
      last_project_id: null,
      resolved_project_id: null,
      needs_project_selection: true,
      memberships: [],
      account_pending_deletion: false,
      scheduled_deletion_at: null,
      pending_consents: [],
    };

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app/project-selection" element={<div>Project selection route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Project selection route')).toBeInTheDocument();
  });
});
