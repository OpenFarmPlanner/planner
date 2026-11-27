import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link as RouterLink, useLocation } from 'react-router';
import { getAuthErrorMessage } from '../../auth/authApi';
import { useAuth } from '../../auth/useAuth';
import { useTranslation } from '../../i18n';
import AuthPageShell from './AuthPageShell';
import { authFormSx, authPrimaryButtonSx, authTextButtonSx, authTextFieldSx } from './authPageStyles';

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const { t } = useTranslation('auth');
  const location = useLocation();
  const prefillEmail = (location.state as { email?: string } | null)?.email ?? '';
  const [email, setEmail] = useState(prefillEmail);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSent(false);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(getAuthErrorMessage(err, t('forgotPassword.failed')));
    }
  };

  return (
    <AuthPageShell title={t('forgotPassword.title')} subtitle={t('forgotPassword.subtitle')}>
      <Box component="form" onSubmit={handleSubmit} sx={authFormSx}>
        <Stack spacing={2.25}>
          {sent ? <Alert severity="success">{t('forgotPassword.sent')}</Alert> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label={t('forgotPassword.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
            sx={authTextFieldSx}
          />
          <Button type="submit" variant="contained" size="large" fullWidth sx={authPrimaryButtonSx}>
            {t('forgotPassword.submit')}
          </Button>
          <Button component={RouterLink} to="/login" sx={authTextButtonSx}>
            {t('forgotPassword.backToLogin')}
          </Button>
        </Stack>
      </Box>
    </AuthPageShell>
  );
}
