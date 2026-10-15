import { Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { useSocialProviders } from '../../auth/useSocialProviders';
import { useTranslation } from '../../i18n';
import { usePublicPagePath } from '../../seo/usePublicPagePath';
import { authLegalLinkSx } from '../../pages/auth/authPageStyles';

interface SocialLoginLegalNoticeProps {
  /**
   * Compact wording/typography for placement outside the immediate social
   * button flow (e.g. LoginPage's footer note) — the default, longer
   * wording stays inline right under the button(s), as on RegisterPage.
   */
  compact?: boolean;
}

/**
 * "Signing in with Google creates an account…" notice, with the Terms of
 * Service / Privacy Policy links. Renders nothing when no social provider
 * is configured for this deployment. Extracted out of `SocialLoginButtons`
 * so a page can render it in a different position (LoginPage moves it to
 * the bottom of the card) without duplicating the copy/links, while
 * `SocialLoginButtons` keeps rendering it inline by default (RegisterPage's
 * unchanged placement).
 */
export default function SocialLoginLegalNotice({ compact = false }: SocialLoginLegalNoticeProps) {
  const { t } = useTranslation('auth');
  const { providers, providerNamesText } = useSocialProviders();
  const termsPath = usePublicPagePath('terms');
  const privacyPath = usePublicPagePath('privacy');

  if (providers.length === 0) {
    return null;
  }

  const prefixKey = compact ? 'socialLogin.legalNoticeCompactPrefix' : 'socialLogin.legalNoticePrefix';
  const middleKey = compact ? 'socialLogin.legalNoticeCompactMiddle' : 'socialLogin.legalNoticeMiddle';
  const suffixKey = compact ? 'socialLogin.legalNoticeCompactSuffix' : 'socialLogin.legalNoticeSuffix';

  return (
    <Typography
      variant={compact ? 'caption' : 'body2'}
      color="text.secondary"
      sx={{ lineHeight: 1.6, display: 'block', textAlign: compact ? 'center' : 'left' }}
    >
      {t(prefixKey, { providers: providerNamesText })}
      <Link component={RouterLink} to={termsPath} target="_blank" rel="noopener" sx={authLegalLinkSx}>
        {t('socialLogin.legalNoticeTermsLinkLabel')}
      </Link>
      {t(middleKey)}
      <Link component={RouterLink} to={privacyPath} target="_blank" rel="noopener" sx={authLegalLinkSx}>
        {t('socialLogin.legalNoticePrivacyLinkLabel')}
      </Link>
      {t(suffixKey)}
    </Typography>
  );
}
