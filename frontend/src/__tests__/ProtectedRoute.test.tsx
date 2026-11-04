import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProtectedRoute from '../auth/ProtectedRoute';

const useAuthMock = vi.fn();

vi.mock('../auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../auth/ConsentGate', () => ({
  default: () => <div data-testid="consent-gate" />,
}));

vi.mock('../i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderProtectedRoute(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/app/dashboard']}>
      <Routes>
        <Route path="/app" element={<ProtectedRoute />}>
          <Route path="dashboard" element={<div data-testid="app-content" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('shows a loading state while auth is resolving', () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: true });

    renderProtectedRoute();

    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('consent-gate')).not.toBeInTheDocument();
  });

  it('offers a retry instead of the login page when the session could not be checked', () => {
    const retryAuthCheck = vi.fn();
    useAuthMock.mockReturnValue({ user: null, isLoading: false, isAuthUnavailable: true, retryAuthCheck });

    render(
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/app" element={<ProtectedRoute />}>
            <Route path="dashboard" element={<div data-testid="app-content" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    expect(screen.getByText('runtime.serverUnavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'runtime.retryAction' }));
    expect(retryAuthCheck).toHaveBeenCalledTimes(1);
  });

  it('gates the app behind the consent gate when a document is pending', () => {
    useAuthMock.mockReturnValue({
      user: { id: 1, pending_consents: ['terms'] },
      isLoading: false,
    });

    renderProtectedRoute();

    expect(screen.getByTestId('consent-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
  });

  it('renders the app once there are no pending consents', () => {
    useAuthMock.mockReturnValue({
      user: { id: 1, pending_consents: [] },
      isLoading: false,
    });

    renderProtectedRoute();

    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.queryByTestId('consent-gate')).not.toBeInTheDocument();
  });
});
