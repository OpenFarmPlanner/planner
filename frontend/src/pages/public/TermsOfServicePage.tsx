import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from '../../i18n';
import LegalDocumentLayout from '../../components/legal/LegalDocumentLayout';

const termsSections = [
  'provider',
  'scope',
  'serviceAndCosts',
  'accounts',
  'userContent',
  'publicLibrary',
  'contributionLicense',
  'prohibitedContent',
  'copyright',
  'contentRemoval',
  'accountSuspension',
  'liability',
  'openSource',
  'futureFeatures',
  'changes',
  'languageVersions',
] as const;

const termsSectionBulletKeys: Partial<Record<(typeof termsSections)[number], readonly string[]>> = {
  prohibitedContent: ['illegalContent', 'malware', 'abuse', 'misrepresentation'],
} as const;

export default function TermsOfServicePage() {
  const { t } = useTranslation('home');

  return (
    <LegalDocumentLayout title={t('legal.terms.title')}>
      {termsSections.map((sectionKey, index) => {
        const bulletKeys = termsSectionBulletKeys[sectionKey];
        return (
          <Stack key={sectionKey} spacing={1}>
            <Typography variant="h6">{`${index + 1}. ${t(`legal.terms.sections.${sectionKey}.title`)}`}</Typography>
            <Typography color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
              {t(`legal.terms.sections.${sectionKey}.content`)}
            </Typography>
            {bulletKeys ? (
              <Box component="ul" sx={{ mt: 0, mb: 0, pl: 3, color: 'text.secondary' }}>
                {bulletKeys.map((bulletKey) => (
                  <li key={bulletKey}>{t(`legal.terms.sections.${sectionKey}.bullets.${bulletKey}`)}</li>
                ))}
              </Box>
            ) : null}
          </Stack>
        );
      })}

      <Typography color="text.secondary">{t('legal.terms.version')}</Typography>
    </LegalDocumentLayout>
  );
}
