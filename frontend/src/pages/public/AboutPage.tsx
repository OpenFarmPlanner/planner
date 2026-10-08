import { Box, Container, Divider, Link, Stack, Typography } from '@mui/material';
import { Trans } from 'react-i18next';
import { useTranslation } from '../../i18n';
import PublicTopbar from '../../components/layout/PublicTopbar';
import PublicFooter from '../../components/layout/PublicFooter';
import { publicAssetUrl } from '../../utils/publicAssetUrl';

/** The GeLaWi Zwiebelzopf community-supported farm this page links to. */
const ZWIEBELZOPF_URL = 'https://zwiebelzopf.at';

const READING_COLUMN_WIDTH = 720;

interface TextSectionProps {
  title: string;
  text: string;
}

function TextSection({ title, text }: TextSectionProps) {
  return (
    <Stack spacing={1} component="section">
      <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography sx={{ lineHeight: 1.75 }}>{text}</Typography>
    </Stack>
  );
}

function ZwiebelzopfLink({ children }: { children?: React.ReactNode }) {
  return (
    <Link href={ZWIEBELZOPF_URL} target="_blank" rel="noopener noreferrer" color="primary">
      {children}
    </Link>
  );
}

/**
 * Public "About" page: how and why OpenFarmPlanner came to be. Shares the
 * landing page's topbar and footer.
 */
export default function AboutPage() {
  const { t } = useTranslation('home');

  const topbarAnchors = [
    { id: 'funktionen', label: t('topbar.nav.features') },
    { id: 'kulturbibliothek', label: t('topbar.nav.cropLibrary') },
    { id: 'open-source', label: t('topbar.nav.openSource') },
  ];

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <PublicTopbar
        brandLabel={t('landing.title')}
        brandAriaLabel={t('topbar.brandAriaLabel')}
        anchors={topbarAnchors}
        pageLink={{ path: '/ueber', label: t('topbar.nav.about') }}
        menuAriaLabel={t('topbar.menuAriaLabel')}
        navAriaLabel={t('topbar.navAriaLabel')}
        signInLabel={t('topbar.signIn')}
      />

      <Box component="main" sx={{ flex: 1 }}>
        <Container maxWidth="md" sx={{ width: '100%', py: { xs: 5, md: 8 } }}>
          <Box sx={{ maxWidth: READING_COLUMN_WIDTH, mx: 'auto' }}>
            <Stack spacing={1.5} sx={{ mb: 3 }}>
              <Typography variant="overline" color="primary" sx={{ fontWeight: 700 }}>
                {t('about.eyebrow')}
              </Typography>
              <Typography
                variant="h3"
                component="h1"
                sx={{
                  fontWeight: 600,
                  lineHeight: 1.2,
                  fontSize: { xs: '1.8rem', sm: '2.25rem', md: '2.5rem' },
                  overflowWrap: 'anywhere',
                }}
              >
                {t('about.title')}
              </Typography>
            </Stack>

            <Stack spacing={2}>
              <Typography sx={{ lineHeight: 1.75 }}>
                <Trans t={t} i18nKey="about.intro1" components={{ zwiebelzopf: <ZwiebelzopfLink /> }} />
              </Typography>
              <Typography sx={{ lineHeight: 1.75 }}>{t('about.intro2')}</Typography>
            </Stack>

            <Stack spacing={3} sx={{ mt: { xs: 3, md: 4 } }}>
              <TextSection title={t('about.openSection.title')} text={t('about.openSection.text')} />
              <TextSection title={t('about.freeSection.title')} text={t('about.freeSection.text')} />

              <Stack spacing={1} component="section">
                <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                  {t('about.contributeSection.title')}
                </Typography>
                <Typography sx={{ lineHeight: 1.75 }}>
                  {t('about.contributeSection.text')}{' '}
                  <Link href={`mailto:${t('footer.contactEmail')}`} color="primary">
                    {t('footer.contactEmail')}
                  </Link>
                </Typography>
              </Stack>
            </Stack>

            <Divider sx={{ mt: 4, mb: 2 }} />

            <Typography sx={{ fontWeight: 700 }}>{t('about.closing.name')}</Typography>

            <Box
              component="figure"
              sx={{
                m: 0,
                mt: { xs: 5, md: 7 },
              }}
            >
              <Box
                component="img"
                src={publicAssetUrl('/landing/about-martin.webp')}
                alt={t('about.photoAlt')}
                loading="lazy"
                sx={{
                  display: 'block',
                  width: '100%',
                  height: 'auto',
                  aspectRatio: '3 / 2',
                  objectFit: 'cover',
                  borderRadius: 3,
                  boxShadow: 6,
                }}
              />
              <Typography
                component="figcaption"
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1.5, textAlign: 'center' }}
              >
                {t('about.photoCaption')}
              </Typography>
            </Box>
          </Box>
        </Container>
      </Box>

      <PublicFooter />
    </Box>
  );
}
