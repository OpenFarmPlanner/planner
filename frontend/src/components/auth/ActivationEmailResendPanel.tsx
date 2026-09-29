import { Alert, Button, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { AuthApiError } from '../../auth/authApi';
import { useAuth } from '../../auth/useAuth';
import { useTranslation } from '../../i18n';
import { authSecondaryButtonSx } from '../../pages/auth/authPageStyles';

const DEFAULT_COOLDOWN_SECONDS = 60;

type ResendFeedback = { severity: 'success' | 'warning' | 'error'; message: string };

interface ActivationEmailResendPanelProps {
  email: string;
  /** Address activation emails come from, as reported by the backend. */
  senderEmail: string | null;
}

function useCountdown(): [number, (seconds: number) => void] {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= endsAt) {
        setEndsAt(null);
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [endsAt]);

  const remainingSeconds = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
  const start = (seconds: number): void => {
    const current = Date.now();
    setNow(current);
    setEndsAt(current + seconds * 1000);
  };
  return [remainingSeconds, start];
}

/**
 * Spam-folder hint plus a rate-limited "send again" action for the account
 * activation email. Shared by the post-registration confirmation and the
 * login page's "account not activated" state.
 */
export default function ActivationEmailResendPanel({ email, senderEmail }: ActivationEmailResendPanelProps) {
  const { resendActivation } = useAuth();
  const { t } = useTranslation('auth');
  const [sending, setSending] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [feedback, setFeedback] = useState<ResendFeedback | null>(null);
  const [cooldownSeconds, startCooldown] = useCountdown();

  const handleResend = async (): Promise<void> => {
    setSending(true);
    setFeedback(null);
    try {
      const response = await resendActivation(email);
      setFeedback({ severity: 'success', message: t('auth:activationEmail.resent') });
      startCooldown(response.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS);
    } catch (error) {
      if (error instanceof AuthApiError && error.code === 'activation_resend_limit_reached') {
        setLimitReached(true);
        setFeedback({ severity: 'warning', message: t('auth:activationEmail.limitReached') });
      } else if (error instanceof AuthApiError && error.status === 429) {
        startCooldown(error.retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS);
      } else {
        setFeedback({
          severity: 'error',
          message: error instanceof Error ? error.message : t('auth:activationEmail.resendFailed'),
        });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {senderEmail
          ? t('auth:activationEmail.spamHint', { fromAddress: senderEmail })
          : t('auth:activationEmail.spamHintWithoutSender')}
      </Typography>
      {feedback ? (
        <Alert severity={feedback.severity} role={feedback.severity === 'success' ? 'status' : 'alert'}>
          {feedback.message}
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="outlined"
        size="large"
        fullWidth
        disabled={sending || limitReached || cooldownSeconds > 0}
        onClick={() => void handleResend()}
        sx={authSecondaryButtonSx}
      >
        {sending ? t('auth:activationEmail.resending') : t('auth:activationEmail.resend')}
      </Button>
      {cooldownSeconds > 0 && !limitReached ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
          {t('auth:activationEmail.cooldown', { seconds: cooldownSeconds })}
        </Typography>
      ) : null}
    </Stack>
  );
}
