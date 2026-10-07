import { Box, Container, Divider, Link, Stack, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Trans } from 'react-i18next';
import { useTranslation } from '../../i18n';
import PublicTopbar from '../../components/layout/PublicTopbar';
import PublicFooter from '../../components/layout/PublicFooter';
import { publicAssetUrl } from '../../utils/publicAssetUrl';

// TODO: fill in once provided - the real-world farm this links to, not
// something this repository can guess at. While empty, no link is rendered
// (an empty href would reload the current page in a new tab).
const ZWIEBELZOPF_URL = '';

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

          {/* Floated so the intro paragraphs wrap around the photo on wider
              screens, like a magazine layout; stacks above the text on
              narrow screens instead. The clearfix Box below ends the float
              before the full-width sections that follow. */}
          <Box
            component="figure"
            sx={{
              m: 0,
              mb: 3,
              float: { xs: 'none', md: 'right' },
              width: { xs: '100%', md: 380 },
              ml: { md: 4 },
            }}
          >
            <Box
              component="img"
              src={publicAssetUrl('/landing/about-martin.webp')}
              alt={t('about.photoAlt')}
              loading="eager"
              sx={{
                display: 'block',
                width: '100%',
                height: 'auto',
                aspectRatio: '4 / 3',
                objectFit: 'cover',
                borderRadius: 3,
                boxShadow: 6,
              }}
            />
            <Typography
              component="figcaption"
              variant="body2"
              color="text.secondary"
              sx={{ mt: 1, textAlign: 'center' }}
            >
              {t('about.photoCaption')}
            </Typography>
          </Box>

          <Typography sx={{ lineHeight: 1.75, mb: 2 }}>
            <Trans
              t={t}
              i18nKey="about.intro1"
              components={{
                zwiebelzopf: ZWIEBELZOPF_URL ? (
                  <Link
                    href={ZWIEBELZOPF_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    color="primary"
                  />
                ) : (
                  <span />
                ),
              }}
            />
          </Typography>
          <Typography sx={{ lineHeight: 1.75 }}>{t('about.intro2')}</Typography>

          <Box sx={{ clear: 'both' }} />

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

            <Divider sx={{ my: 1 }} />

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 1, sm: 2 }}
              sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
            >
              <Typography sx={{ fontWeight: 700 }}>{t('about.closing.name')}</Typography>
              {ZWIEBELZOPF_URL && (
                <Link
                  href={ZWIEBELZOPF_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                >
                  {t('about.closing.zwiebelzopfLink')}
                  <OpenInNewIcon fontSize="inherit" />
                </Link>
              )}
            </Stack>
          </Stack>
        </Container>
      </Box>

      <PublicFooter />
    </Box>
  );
}
