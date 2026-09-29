import { Box, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { useTranslation } from '../../i18n';
import LegalDocumentLayout from '../../components/legal/LegalDocumentLayout';

const privacySections = [
  'controller',
  'generalNotice',
  'hosting',
  'cloudflare',
  'registration',
  'turnstile',
  'socialLogin',
  'projectData',
  'publicLibrary',
  'emailCommunication',
  'cookies',
  'localStorage',
  'dataSharing',
  'thirdCountryTransfers',
  'mandatoryProvision',
  'storageDuration',
  'rights',
  'complaint',
  'changes',
] as const;

const privacySectionBulletKeys: Partial<Record<(typeof privacySections)[number], readonly string[]>> = {
  hosting: ['ipAddress', 'requestTime', 'requestedResource', 'browser', 'operatingSystem', 'referrerUrl'],
  registration: ['emailAddress', 'nameOptional', 'encryptedPassword'],
  socialLogin: ['receivedData', 'storedData', 'purpose', 'disconnect'],
  publicLibrary: ['publicContent', 'attribution', 'noReview', 'persistence', 'removal', 'futureOutlook'],
  emailCommunication: ['registration', 'accountActivation', 'passwordReset', 'projectInvitations', 'systemNotifications'],
  cookies: ['sessionCookies', 'securityCookies'],
  rights: ['access', 'rectification', 'deletion', 'restriction', 'portability', 'objection', 'consentWithdrawal'],
} as const;

export default function PrivacyPolicyPage() {
  const { t, i18n } = useTranslation('home');

  return (
    <LegalDocumentLayout
      title={t('legal.privacy.title')}
      actions={
        <Link component={RouterLink} to="/nutzungsbedingungen" underline="hover">
          {t('legal.terms.title')}
        </Link>
      }
    >
      {privacySections.map((sectionKey, index) => {
        const bulletKeys = privacySectionBulletKeys[sectionKey];
        return (
          <Stack key={sectionKey} spacing={1}>
            <Typography variant="h6">{`${index + 1}. ${t(`legal.privacy.sections.${sectionKey}.title`)}`}</Typography>
            <Typography color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
              {t(`legal.privacy.sections.${sectionKey}.content`)}
            </Typography>
            {bulletKeys ? (
              <Box component="ul" sx={{ mt: 0, mb: 0, pl: 3, color: 'text.secondary' }}>
                {bulletKeys.map((bulletKey) => (
                  <li key={bulletKey}>{t(`legal.privacy.sections.${sectionKey}.bullets.${bulletKey}`)}</li>
                ))}
              </Box>
            ) : null}
            {i18n.exists(`home:legal.privacy.sections.${sectionKey}.legalBasis`) ? (
              <Typography color="text.secondary" sx={{ fontWeight: 500 }}>
                {t(`legal.privacy.sections.${sectionKey}.legalBasis`)}
              </Typography>
            ) : null}
            {i18n.exists(`home:legal.privacy.sections.${sectionKey}.contact`) ? (
              <Typography color="text.secondary">{t(`legal.privacy.sections.${sectionKey}.contact`)}</Typography>
            ) : null}
          </Stack>
        );
      })}

      <Typography color="text.secondary">{t('legal.privacy.version')}</Typography>
    </LegalDocumentLayout>
  );
}
