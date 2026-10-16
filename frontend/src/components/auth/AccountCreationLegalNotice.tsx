import { Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { useTranslation } from '../../i18n';
import { usePublicPagePath } from '../../seo/usePublicPagePath';
import { authLegalLinkSx } from '../../pages/auth/authPageStyles';

/**
 * Shared consent notice shown once on the registration page, above both the
 * social-login buttons and the email/password form, so it is unambiguous
 * that creating an account - via any provider or email/password - implies
 * agreement to the Terms of Service. There is no separate consent checkbox;
 * the Privacy Policy link is purely informational.
 */
export default function AccountCreationLegalNotice() {
  const { t } = useTranslation('auth');
  const termsPath = usePublicPagePath('terms');
  const privacyPath = usePublicPagePath('privacy');

  return (
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65, mb: 2.25 }}>
      {t('auth:register.termsNoticePrefix')}
      <Link component={RouterLink} to={termsPath} target="_blank" rel="noopener" sx={authLegalLinkSx}>
        {t('auth:register.termsNoticeTermsLinkLabel')}
      </Link>
      {t('auth:register.termsNoticeMiddle')}
      <Link component={RouterLink} to={privacyPath} target="_blank" rel="noopener" sx={authLegalLinkSx}>
        {t('auth:register.termsNoticePrivacyLinkLabel')}
      </Link>
      {t('auth:register.termsNoticeSuffix')}
    </Typography>
  );
}
