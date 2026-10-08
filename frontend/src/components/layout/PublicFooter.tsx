import { Box, Container, Link, Stack } from '@mui/material';
import { useTranslation } from '../../i18n';
import LegalLinks from '../legal/LegalLinks';
import { API_DOCS_URL } from '../../api/apiDocsUrl';

/** Shared footer for the public marketing pages (landing page, about page). */
export default function PublicFooter() {
  const { t } = useTranslation('home');

  return (
    <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', py: { xs: 2.5, md: 2.75 }, bgcolor: 'background.paper' }}>
      <Container maxWidth="md">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1.25, sm: 3 }}
          useFlexGap
          sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1.25 }}
        >
          <LegalLinks sx={{ flexShrink: 0 }} />
          <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 1.25 }}>
            <Link href={API_DOCS_URL} underline="hover" color="text.secondary" sx={{ fontSize: '0.92rem' }}>
              {t('footer.apiDocs')}
            </Link>
            <Link href={`mailto:${t('footer.contactEmail')}`} underline="hover" color="text.secondary" sx={{ fontSize: '0.92rem' }}>
              {t('footer.contactLabel', { email: t('footer.contactEmail') })}
            </Link>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
