import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ActivationEmailResendPanel from '../components/auth/ActivationEmailResendPanel';
import { AuthApiError } from '../auth/authApi';

const resendActivationMock = vi.fn();

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ resendActivation: resendActivationMock }),
}));

async function clickResend(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'E-Mail erneut senden' }));
  });
}

describe('ActivationEmailResendPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    resendActivationMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the spam hint with the configured sender address', () => {
    render(<ActivationEmailResendPanel email="new@example.com" senderEmail="noreply@example.org" />);

    expect(
      screen.getByText(
        'Keine E-Mail erhalten? Schau bitte auch im Spam-Ordner nach, bei Gmail auch im Tab „Werbung“. Die E-Mail kommt von noreply@example.org.',
      ),
    ).toBeInTheDocument();
  });

  it('confirms the resend and locks the button for the cooldown', async () => {
    resendActivationMock.mockResolvedValue({ detail: 'ok', cooldown_seconds: 60 });
    render(<ActivationEmailResendPanel email="new@example.com" senderEmail="noreply@example.org" />);

    await clickResend();

    expect(resendActivationMock).toHaveBeenCalledWith('new@example.com');
    expect(screen.getByText('Wir haben die E-Mail erneut gesendet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E-Mail erneut senden' })).toBeDisabled();
    expect(screen.getByText('Erneut senden ist in 60 s möglich.')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText('Erneut senden ist in 45 s möglich.')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(screen.queryByText(/Erneut senden ist in/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E-Mail erneut senden' })).toBeEnabled();
  });

  it('uses the server-reported wait when the cooldown is still running', async () => {
    resendActivationMock.mockRejectedValue(
      new AuthApiError('wait', { code: 'activation_resend_cooldown', status: 429, retryAfterSeconds: 42 }),
    );
    render(<ActivationEmailResendPanel email="new@example.com" senderEmail={null} />);

    await clickResend();

    expect(screen.getByText('Erneut senden ist in 42 s möglich.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E-Mail erneut senden' })).toBeDisabled();
  });

  it('shows the limit message and keeps the button disabled once the hourly cap is reached', async () => {
    resendActivationMock.mockRejectedValue(
      new AuthApiError('limit', { code: 'activation_resend_limit_reached', status: 429, retryAfterSeconds: 3000 }),
    );
    render(<ActivationEmailResendPanel email="new@example.com" senderEmail={null} />);

    await clickResend();

    expect(
      screen.getByText('Du hast die maximale Anzahl an Versuchen erreicht. Bitte versuche es später noch einmal.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E-Mail erneut senden' })).toBeDisabled();
    expect(screen.queryByText(/Erneut senden ist in/)).not.toBeInTheDocument();
  });
});
