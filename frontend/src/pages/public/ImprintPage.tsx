import { Stack, Typography } from '@mui/material';
import { useTranslation } from '../../i18n';
import LegalDocumentLayout from '../../components/legal/LegalDocumentLayout';

const imprintSections = [
  'provider',
  'contact',
  'responsiblePerson',
  'mediaDisclosure',
] as const;

export default function ImprintPage() {
  const { t } = useTranslation('home');

  return (
    <LegalDocumentLayout title={t('legal.imprint.title')}>
      {imprintSections.map((sectionKey) => (
        <Stack key={sectionKey} spacing={0.5}>
          <Typography variant="h6">{t(`legal.imprint.sections.${sectionKey}.title`)}</Typography>
          <Typography color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
            {t(`legal.imprint.sections.${sectionKey}.content`)}
          </Typography>
        </Stack>
      ))}
    </LegalDocumentLayout>
  );
}
