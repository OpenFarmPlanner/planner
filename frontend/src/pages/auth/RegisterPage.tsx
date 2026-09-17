import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { projectAPI, type InvitationPublicStatus } from '../../api/api';
import { useAuth } from '../../auth/useAuth';
import AccountCreationLegalNotice from '../../components/auth/AccountCreationLegalNotice';
import SocialLoginButtons from '../../components/auth/SocialLoginButtons';
import { AuthPasswordField } from './AuthPasswordField';
import { useTranslation } from '../../i18n';
import { getNextFromSearch, getTokenFromNextPath, storeInvitationRedirect } from '../invitationAcceptance';
import AuthPageShell from './AuthPageShell';
import { authFormSx, authPrimaryButtonSx, authSecondaryButtonSx, authTextButtonSx, authTextFieldSx } from './authPageStyles';

export default function RegisterPage() {
  const { user, register, resendActivation, logout } = useAuth();
  const { t } = useTranslation(['auth', 'projectInvitations']);
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  // Honeypot: hidden from real users; only automated form-fillers set this.
  const [website, setWebsite] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [registrationSucceeded, setRegistrationSucceeded] = useState(false);
  const [pendingInvitation, setPendingInvitation] = useState<InvitationPublicStatus | null>(null);
  const nextPath = getNextFromSearch(location.search);
  const isLoggedIn = user !== null;
  const currentUserLabel = user?.display_label || user?.email || '–';

  useEffect(() => {
    const loadPendingInvitation = async (): Promise<void> => {
      try {
        const response = await projectAPI.getPendingInvitation();
        if (response.data.code !== 'no_pending_invitation') {
          setPendingInvitation(response.data);
        }
      } catch {
        setPendingInvitation(null);
      }
    };

    void loadPendingInvitation();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError(t('auth:error.messages.required'));
      return;
    }
    if (!password) {
      setError(t('auth:error.messages.required'));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t('auth:register.passwordMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      if (nextPath) {
        storeInvitationRedirect(nextPath, getTokenFromNextPath(nextPath));
      }
      const message = await register(email.trim().toLowerCase(), password, passwordConfirm, displayName.trim(), website);
      setSuccess(pendingInvitation ? t('projectInvitations:registerSuccessWithInvitation', { detail: message }) : message);
      setRegistrationSucceeded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth:register.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (): Promise<void> => {
    setError(null);
    setSuccess(null);
    try {
      setSuccess(await resendActivation(email.trim().toLowerCase()));
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : t('auth:register.failed'));
    }
  };

  const handleLogoutAndCreate = async (): Promise<void> => {
    setError(null);
    setSuccess(null);
    try {
      await logout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : t('auth:register.logoutToCreateFailed'));
    }
  };

  return (
    <AuthPageShell title={t('auth:register.title')} subtitle={t('auth:register.subtitle')} legalLinksDense>
      {isLoggedIn ? null : <AccountCreationLegalNotice />}
      {isLoggedIn ? null : <SocialLoginButtons hideLegalNotice />}
      <Box component="form" onSubmit={handleSubmit} noValidate sx={authFormSx}>
        <Stack spacing={2.25}>
          {isLoggedIn ? (
            <Alert severity="info">
              <Stack spacing={1.5}>
                <Typography variant="body2">
                  {t('auth:register.loggedInHint', { user: currentUserLabel })}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Button type="button" variant="contained" size="large" onClick={() => void handleLogoutAndCreate()} sx={authPrimaryButtonSx}>
                    {t('auth:register.logoutAndCreate')}
                  </Button>
                  <Button type="button" variant="outlined" size="large" onClick={() => navigate('/app')} sx={authSecondaryButtonSx}>
                    {t('auth:register.backToApp')}
                  </Button>
                </Stack>
              </Stack>
            </Alert>
          ) : null}
          {pendingInvitation ? (
            <Alert severity="info">
              {t('projectInvitations:registerHint', {
                project: pendingInvitation.project_name ?? '–',
                email: pendingInvitation.email_masked ?? '–',
              })}
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {success ? <Alert severity="success">{success}</Alert> : null}
          {/* Honeypot: hidden from sighted and screen-reader users alike; only
              an automated client that fills every form field populates it. */}
          <TextField
            label={t('auth:register.honeypotLabel')}
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            sx={{ position: 'absolute', left: '-9999px', width: 1, height: 0, overflow: 'hidden' }}
          />
          <TextField
            label={t('auth:register.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isLoggedIn}
            fullWidth
            sx={authTextFieldSx}
          />
          <TextField
            label={t('auth:register.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={isLoggedIn}
            fullWidth
            sx={authTextFieldSx}
          />
          <AuthPasswordField
            label={t('auth:register.password')}
            value={password}
            onValueChange={setPassword}
            isVisible={showPassword}
            onToggleVisibility={() => setShowPassword((current) => !current)}
            showLabel={t('auth:register.showPassword')}
            hideLabel={t('auth:register.hidePassword')}
            disabled={isLoggedIn}
            autoComplete="new-password"
          />
          <AuthPasswordField
            label={t('auth:register.passwordConfirm')}
            value={passwordConfirm}
            onValueChange={setPasswordConfirm}
            isVisible={showPasswordConfirm}
            onToggleVisibility={() => setShowPasswordConfirm((current) => !current)}
            showLabel={t('auth:register.showPassword')}
            hideLabel={t('auth:register.hidePassword')}
            disabled={isLoggedIn}
            autoComplete="new-password"
          />
          <Button type="submit" variant="contained" size="large" disabled={submitting || isLoggedIn} fullWidth sx={authPrimaryButtonSx}>
            {submitting ? t('auth:register.submitting') : t('auth:register.submit')}
          </Button>
          {registrationSucceeded && !isLoggedIn ? (
            <Button type="button" onClick={() => void handleResend()} sx={authTextButtonSx}>{t('auth:register.resendActivation')}</Button>
          ) : null}
          <Button type="button" component={RouterLink} to={nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login'} state={location.state} sx={authTextButtonSx}>
            {t('auth:register.hasAccount')}
          </Button>
        </Stack>
      </Box>
    </AuthPageShell>
  );
}
