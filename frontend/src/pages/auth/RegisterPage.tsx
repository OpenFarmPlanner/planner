import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Trans } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { projectAPI, type InvitationPublicStatus } from '../../api/api';
import { AuthApiError } from '../../auth/authApi';
import { resolveTurnstileSiteKey } from '../../auth/turnstile';
import { useAuth } from '../../auth/useAuth';
import AccountCreationLegalNotice from '../../components/auth/AccountCreationLegalNotice';
import ActivationEmailResendPanel from '../../components/auth/ActivationEmailResendPanel';
import SocialLoginButtons from '../../components/auth/SocialLoginButtons';
import TurnstileWidget from '../../components/auth/TurnstileWidget';
import { AuthPasswordField } from './AuthPasswordField';
import { useTranslation } from '../../i18n';
import { getNextFromSearch, getTokenFromNextPath, storeInvitationRedirect } from '../invitationAcceptance';
import AuthPageShell from './AuthPageShell';
import { authFormSx, authPrimaryButtonSx, authSecondaryButtonSx, authTextButtonSx, authTextFieldSx } from './authPageStyles';

const TURNSTILE_SITE_KEY = resolveTurnstileSiteKey();

// The container shrink-wraps its buttons: when both fit it is exactly one row
// wide, so they keep their natural width; otherwise it takes the full width,
// the buttons wrap onto their own lines and `flex-grow` stretches each one.
const loggedInActionsSx: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 1.25,
  width: 'fit-content',
  maxWidth: '100%',
};

const loggedInPrimaryActionSx: SxProps<Theme> = { ...authPrimaryButtonSx, flex: '1 1 auto', whiteSpace: 'normal' };
const loggedInSecondaryActionSx: SxProps<Theme> = { ...authSecondaryButtonSx, flex: '1 1 auto', whiteSpace: 'normal' };

const TURNSTILE_ERROR_MESSAGE_KEYS: Record<string, string> = {
  turnstile_failed: 'auth:register.turnstile.rejected',
  turnstile_unavailable: 'auth:register.turnstile.unavailable',
};

interface RegistrationConfirmation {
  email: string;
  senderEmail: string | null;
  emailSendFailed: boolean;
}

export default function RegisterPage() {
  const { user, register, logout } = useAuth();
  const { t } = useTranslation(['auth', 'projectInvitations']);
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  // Honeypot: hidden from real users; only automated form-fillers set this.
  const [website, setWebsite] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState<RegistrationConfirmation | null>(null);
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
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError(t('auth:register.turnstile.pending'));
      return;
    }

    setSubmitting(true);
    try {
      if (nextPath) {
        storeInvitationRedirect(nextPath, getTokenFromNextPath(nextPath));
      }
      const normalizedEmail = email.trim().toLowerCase();
      const response = await register(
        normalizedEmail,
        password,
        passwordConfirm,
        displayName.trim(),
        website,
        turnstileToken ?? '',
      );
      setConfirmation({
        email: normalizedEmail,
        senderEmail: response.sender_email ?? null,
        emailSendFailed: response.code === 'email_send_failed',
      });
    } catch (err) {
      const turnstileMessageKey = err instanceof AuthApiError && err.code ? TURNSTILE_ERROR_MESSAGE_KEYS[err.code] : undefined;
      if (turnstileMessageKey) {
        setError(t(turnstileMessageKey));
      } else {
        setError(err instanceof Error ? err.message : t('auth:register.failed'));
      }
    } finally {
      setSubmitting(false);
      // The backend consumes a Turnstile token on every attempt, so any
      // further submit needs a fresh one.
      if (TURNSTILE_SITE_KEY) {
        setTurnstileResetSignal((current) => current + 1);
      }
    }
  };

  const handleLogoutAndCreate = async (): Promise<void> => {
    setError(null);
    try {
      await logout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : t('auth:register.logoutToCreateFailed'));
    }
  };

  return (
    <AuthPageShell title={t('auth:register.title')} subtitle={t('auth:register.subtitle')} legalLinksDense>
      {isLoggedIn || confirmation ? null : <AccountCreationLegalNotice />}
      {isLoggedIn || confirmation ? null : <SocialLoginButtons hideLegalNotice />}
      {confirmation && !isLoggedIn ? (
        <RegistrationConfirmationView
          confirmation={confirmation}
          hasPendingInvitation={pendingInvitation !== null}
          onRegisterAgain={() => setConfirmation(null)}
        />
      ) : (
        <Box component="form" onSubmit={handleSubmit} noValidate sx={authFormSx}>
          <Stack spacing={2.25}>
            {isLoggedIn ? (
              <Alert severity="info">
                <Stack spacing={1.5}>
                  <Typography variant="body2">
                    {t('auth:register.loggedInHint', { user: currentUserLabel })}
                  </Typography>
                  <Box sx={loggedInActionsSx}>
                    <Button type="button" variant="contained" size="large" onClick={() => void handleLogoutAndCreate()} sx={loggedInPrimaryActionSx}>
                      {t('auth:register.logoutAndCreate')}
                    </Button>
                    <Button type="button" variant="outlined" size="large" onClick={() => navigate('/app')} sx={loggedInSecondaryActionSx}>
                      {t('auth:register.backToApp')}
                    </Button>
                  </Box>
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
            {/* Honeypot: hidden from sighted, screen-reader and keyboard users
                alike; only an automated client that fills every form field
                populates it. `tabIndex` has to go on the input itself (the
                TextField would put it on the wrapper, leaving the input in the
                tab order and scrolling the page off-screen on the first Tab). */}
            <Box
              aria-hidden="true"
              sx={{ position: 'absolute', left: '-9999px', width: 1, height: 0, overflow: 'hidden' }}
            >
              <TextField
                label={t('auth:register.honeypotLabel')}
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                autoComplete="off"
                slotProps={{ htmlInput: { tabIndex: -1, autoComplete: 'off' } }}
              />
            </Box>
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
            {TURNSTILE_SITE_KEY && !isLoggedIn ? (
              <TurnstileWidget
                siteKey={TURNSTILE_SITE_KEY}
                onTokenChange={setTurnstileToken}
                resetSignal={turnstileResetSignal}
              />
            ) : null}
            <Button type="submit" variant="contained" size="large" disabled={submitting || isLoggedIn} fullWidth sx={authPrimaryButtonSx}>
              {submitting ? t('auth:register.submitting') : t('auth:register.submit')}
            </Button>
            <Button type="button" component={RouterLink} to={nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login'} state={location.state} sx={authTextButtonSx}>
              {t('auth:register.hasAccount')}
            </Button>
          </Stack>
        </Box>
      )}
    </AuthPageShell>
  );
}

interface RegistrationConfirmationViewProps {
  confirmation: RegistrationConfirmation;
  hasPendingInvitation: boolean;
  onRegisterAgain: () => void;
}

function RegistrationConfirmationView({ confirmation, hasPendingInvitation, onRegisterAgain }: RegistrationConfirmationViewProps) {
  const { t } = useTranslation(['auth', 'projectInvitations']);

  return (
    <Stack spacing={2.25} sx={authFormSx}>
      {confirmation.emailSendFailed ? (
        <Alert severity="warning">{t('auth:error.messages.activationEmailSendFailed')}</Alert>
      ) : (
        <Alert severity="success">
          <Trans
            t={t}
            i18nKey="auth:activationEmail.sentTo"
            values={{ email: confirmation.email }}
            components={{ strong: <Box component="strong" sx={{ overflowWrap: 'anywhere' }} /> }}
          />
        </Alert>
      )}
      {hasPendingInvitation ? (
        <Alert severity="info">{t('projectInvitations:registerInvitationAfterActivation')}</Alert>
      ) : null}
      <ActivationEmailResendPanel email={confirmation.email} senderEmail={confirmation.senderEmail} />
      <Button type="button" onClick={onRegisterAgain} sx={authTextButtonSx}>
        {t('auth:activationEmail.wrongAddress')}
      </Button>
    </Stack>
  );
}
