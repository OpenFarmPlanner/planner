import { Box, Checkbox, FormControlLabel, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { useTranslation } from '../i18n';
import { usePublicPagePath } from '../seo/usePublicPagePath';

/** The contribution consent used before any project value becomes public. */
export function PublicLibraryTermsConsent({ checked, onChange, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('crops');
  const privacyPath = usePublicPagePath('privacy');
  const termsPath = usePublicPagePath('terms');
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <FormControlLabel
        control={<Checkbox checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} />}
        label={t('library.publishConfirm.acceptLicense')}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t('library.publishConfirm.linkPrefix')}
        <Link component={RouterLink} to={privacyPath} target="_blank" rel="noopener">{t('library.publishConfirm.privacyLinkLabel')}</Link>
        {t('library.publishConfirm.linkMiddle')}
        <Link component={RouterLink} to={termsPath} target="_blank" rel="noopener">{t('library.publishConfirm.termsLinkLabel')}</Link>
        {t('library.publishConfirm.linkSuffix')}
      </Typography>
    </Box>
  );
}
