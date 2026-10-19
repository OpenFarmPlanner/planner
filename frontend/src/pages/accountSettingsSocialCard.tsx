// "Login methods" card on the account settings page: shows which methods
// are already linked to the signed-in account and offers connecting an
// available provider that isn't linked yet. This is also the explicit,
// secure linking path for users whose provider email cannot be matched to
// their account automatically (see docs/social-login.md). Users cannot
// disconnect a linked method from this UI - removal isn't something anyone
// currently needs, and the backend endpoint (kept for potential internal
// use) already refuses to strand an account without any usable login method.

import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import {
  SOCIAL_ERROR_PARAM,
  SOCIAL_STATUS_PARAM,
  getSocialConnections,
  getSocialProviders,
  startSocialLogin,
  type SocialConnection,
  type SocialProvider,
} from '../auth/socialAuth';
import { useAuth } from '../auth/useAuth';
import { PROVIDER_ICONS } from '../components/auth/socialProviderIcons';
import { socialLoginErrorKey } from '../components/auth/socialLoginErrors';
import { useTranslation } from '../i18n';
import { actionButtonSx } from './accountSettingsForm';
import { SettingsCard } from './accountSettingsCards';
import { getActiveFormattingLocale } from '../utils/numberLocalization';

interface AccountSettingsSocialMethodsContentProps {
  wrapInCard: boolean;
}

function AccountSettingsSocialMethodsContent({ wrapInCard }: AccountSettingsSocialMethodsContentProps) {
  const { t } = useTranslation(['account', 'auth']);
  const { user } = useAuth();
  const location = useLocation();
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  const searchParams = new URLSearchParams(location.search);
  const redirectErrorCode = searchParams.get(SOCIAL_ERROR_PARAM);
  const connectSucceeded = searchParams.get(SOCIAL_STATUS_PARAM) === 'connected';

  const reload = useCallback(async (): Promise<void> => {
    const [availableProviders, linkedConnections] = await Promise.all([
      getSocialProviders(),
      getSocialConnections(),
    ]);
    setProviders(availableProviders);
    setConnections(linkedConnections);
  }, []);

  useEffect(() => {
    const loadLoginMethods = async (): Promise<void> => {
      try {
        await reload();
      } catch {
        setProviders([]);
        setConnections([]);
      }
    };

    void loadLoginMethods();
  }, [reload]);

  // A guest demo workspace is temporary, so it must not collect permanent
  // login methods.
  if (user?.is_guest_demo || (providers.length === 0 && connections.length === 0)) {
    return null;
  }

  const connectedProviderIds = new Set(connections.map((connection) => connection.provider));

  const handleConnect = async (provider: SocialProvider): Promise<void> => {
    setPendingProvider(provider.id);
    try {
      await startSocialLogin(provider, { process: 'connect' });
    } catch {
      setPendingProvider(null);
    }
  };

  const content = (
    <Stack spacing={2}>
      {redirectErrorCode ? (
        <Alert severity="error">{t(socialLoginErrorKey(redirectErrorCode))}</Alert>
      ) : null}
      {connectSucceeded ? <Alert severity="success">{t('loginMethods.connected')}</Alert> : null}

      <Typography variant="body2" color="text.secondary">
        {t('loginMethods.description')}
      </Typography>

      <Stack component="ul" spacing={0.75} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {user?.has_password ? (
          <Stack
            component="li"
            direction="row"
            spacing={1.25}
            sx={{ alignItems: 'center', color: 'text.secondary', cursor: 'default' }}
          >
            <Box
              aria-hidden="true"
              sx={{
                width: 20,
                height: 20,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.disabled',
                flexShrink: 0,
              }}
            >
              •
            </Box>
            <Typography variant="body2">{t('loginMethods.emailPasswordActive')}</Typography>
          </Stack>
        ) : null}

        {connections.map((connection) => {
          const ProviderIcon = PROVIDER_ICONS[connection.provider];
          return (
            <Stack
              key={connection.id}
              component="li"
              direction="row"
              spacing={1.25}
              sx={{ alignItems: 'center', color: 'text.secondary', cursor: 'default' }}
            >
              {ProviderIcon ? (
                <ProviderIcon fontSize="small" sx={{ color: 'text.disabled', flexShrink: 0 }} />
              ) : null}
              <Typography variant="body2">
                {t(
                  connection.email
                    ? 'loginMethods.connectedSinceWithEmail'
                    : 'loginMethods.connectedSince',
                  {
                    provider: connection.provider_name,
                    email: connection.email,
                    date: new Date(connection.connected_at).toLocaleDateString(getActiveFormattingLocale()),
                  },
                )}
              </Typography>
            </Stack>
          );
        })}
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        {providers
          .filter((provider) => !connectedProviderIds.has(provider.id))
          .map((provider) => {
            const ProviderIcon = PROVIDER_ICONS[provider.id];
            return (
              <Button
                key={provider.id}
                variant="outlined"
                disabled={pendingProvider !== null}
                startIcon={ProviderIcon ? <ProviderIcon /> : undefined}
                onClick={() => void handleConnect(provider)}
                sx={actionButtonSx}
              >
                {t('loginMethods.connect', { provider: provider.name })}
              </Button>
            );
          })}
      </Stack>
    </Stack>
  );

  if (wrapInCard) {
    return (
      <SettingsCard title={t('loginMethods.title')}>
        {content}
      </SettingsCard>
    );
  }

  return content;
}

export function AccountSettingsSocialMethods() {
  return <AccountSettingsSocialMethodsContent wrapInCard={false} />;
}

export default function AccountSettingsSocialCard() {
  return <AccountSettingsSocialMethodsContent wrapInCard />;
}
