// "Sign in with Google/Microsoft" block shown above the email/password form on
// the login and registration pages. Renders nothing when the deployment has no
// provider configured, so the pages stay unchanged without OAuth credentials.

import { Alert, Box, Button, Divider, Stack } from '@mui/material';
import { useState } from 'react';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';
import { useLocation } from 'react-router';
import {
  SOCIAL_ERROR_PARAM,
  startSocialLogin,
  type SocialProvider,
} from '../../auth/socialAuth';
import { useSocialProviders } from '../../auth/useSocialProviders';
import { useTranslation } from '../../i18n';
import { authSecondaryButtonSx } from '../../pages/auth/authPageStyles';
import { PROVIDER_ICONS } from './socialProviderIcons';
import { socialLoginErrorKey } from './socialLoginErrors';
import SocialLoginLegalNotice from './SocialLoginLegalNotice';

const socialButtonSx: SxProps<Theme> = {
  ...authSecondaryButtonSx,
  justifyContent: 'flex-start',
  gap: 1.5,
  color: 'text.primary',
  borderColor: (theme) => alpha(theme.palette.primary.main, 0.24),
  boxShadow: 0,
  '&:hover': {
    color: 'text.primary',
    borderColor: (theme) => alpha(theme.palette.primary.main, 0.42),
    bgcolor: 'surface.surfaceBackground',
    transform: 'none',
    boxShadow: 1,
  },
};

interface SocialLoginButtonsProps {
  /**
   * Skips rendering the inline "signing in creates an account" notice
   * below the button(s) — for pages that render `SocialLoginLegalNotice`
   * themselves elsewhere (LoginPage puts a compact version at the bottom
   * of the card). Defaults to showing it inline, RegisterPage's unchanged
   * placement.
   */
  hideLegalNotice?: boolean;
}

export default function SocialLoginButtons({ hideLegalNotice = false }: SocialLoginButtonsProps = {}) {
  const { t } = useTranslation('auth');
  const location = useLocation();
  const { providers } = useSocialProviders();
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redirectErrorCode = new URLSearchParams(location.search).get(SOCIAL_ERROR_PARAM);

  if (providers.length === 0 && !redirectErrorCode) {
    return null;
  }

  const handleStart = async (provider: SocialProvider): Promise<void> => {
    setError(null);
    setPendingProvider(provider.id);
    try {
      await startSocialLogin(provider);
    } catch {
      setPendingProvider(null);
      setError(t('socialLogin.errors.startFailed'));
    }
  };

  return (
    <Stack spacing={2.25} sx={{ mb: providers.length > 0 ? 2.5 : 0 }}>
      {redirectErrorCode ? (
        <Alert severity="error">{t(socialLoginErrorKey(redirectErrorCode))}</Alert>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      {providers.map((provider) => {
        const ProviderIcon = PROVIDER_ICONS[provider.id];
        const isPending = pendingProvider === provider.id;
        return (
          <Button
            key={provider.id}
            type="button"
            variant="outlined"
            size="large"
            fullWidth
            disabled={pendingProvider !== null}
            onClick={() => void handleStart(provider)}
            startIcon={ProviderIcon ? <ProviderIcon /> : undefined}
            sx={socialButtonSx}
          >
            {isPending
              ? t('socialLogin.starting', { provider: provider.name })
              : t('socialLogin.loginWith', { provider: provider.name })}
          </Button>
        );
      })}

      {providers.length > 0 ? (
        <>
          {!hideLegalNotice ? <SocialLoginLegalNotice /> : null}
          <Divider>
            <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.85rem', px: 0.5 }}>
              {t('socialLogin.dividerLabel')}
            </Box>
          </Divider>
        </>
      ) : null}
    </Stack>
  );
}
