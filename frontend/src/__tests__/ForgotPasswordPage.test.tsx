import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage';

const requestPasswordResetMock = vi.fn();

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    requestPasswordReset: requestPasswordResetMock,
  }),
}));

describe('ForgotPasswordPage', () => {
  it('renders inside the shared auth card shell used by login/register', () => {
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    // AuthPageShell's wordmark and legal links only appear when the page uses
    // the shared shell, not the page-local Container layout it used before.
    expect(screen.getByText('OpenFarmPlanner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Passwort vergessen' })).toBeInTheDocument();
    expect(screen.getByText('Wir senden Ihnen einen Link zum Zurücksetzen Ihres Passworts.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Impressum' })).toBeInTheDocument();
  });

  it('submits the reset request and shows the confirmation message', async () => {
    const user = userEvent.setup();
    requestPasswordResetMock.mockResolvedValueOnce(undefined);

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('E-Mail *'), 'demo@example.com');
    await user.click(screen.getByRole('button', { name: 'Reset-E-Mail senden' }));

    await waitFor(() => {
      expect(screen.getByText('Falls das Konto existiert, wurde eine E-Mail gesendet.')).toBeInTheDocument();
    });
    expect(requestPasswordResetMock).toHaveBeenCalledWith('demo@example.com');
  });

  it('links back to login', () => {
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Zurück zur Anmeldung' })).toHaveAttribute('href', '/login');
  });
});
