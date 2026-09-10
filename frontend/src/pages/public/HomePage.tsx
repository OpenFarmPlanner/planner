import GitHubIcon from '@mui/icons-material/GitHub';
import {
  Alert,
  Box,
  Button,
  Container,
  CircularProgress,
  Link,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Link as RouterLink } from 'react-router';
import { useTranslation } from '../../i18n';
import LegalLinks from '../../components/legal/LegalLinks';
import HeroImage from '../../components/HeroImage';
import { publicAssetUrl } from '../../utils/publicAssetUrl';
import { PublicLanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { useGuestDemoStart } from './useGuestDemoStart';
import AppIcon from '../../components/layout/AppIcon';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

const PRODUCT_TOUR_ITEMS = [
  {
    key: 'areas',
    images: {
      de: publicAssetUrl('/landing/screenshots/demo-areas.webp'),
      en: publicAssetUrl('/landing/screenshots/demo-areas-en.webp'),
    },
  },
  {
    key: 'crops',
    images: {
      de: publicAssetUrl('/landing/screenshots/demo-crops.webp'),
      en: publicAssetUrl('/landing/screenshots/demo-crops-en.webp'),
    },
  },
  {
    key: 'plantingPlans',
    images: {
      de: publicAssetUrl('/landing/screenshots/demo-planting-plans.webp'),
      en: publicAssetUrl('/landing/screenshots/demo-planting-plans-en.webp'),
    },
  },
  {
    key: 'calendar',
    images: {
      de: publicAssetUrl('/landing/screenshots/demo-calendar.webp'),
      en: publicAssetUrl('/landing/screenshots/demo-calendar-en.webp'),
    },
  },
  {
    key: 'yieldOverview',
    images: {
      de: publicAssetUrl('/landing/screenshots/demo-yield-overview.webp'),
      en: publicAssetUrl('/landing/screenshots/demo-yield-overview-en.webp'),
    },
  },
  {
    key: 'seedDemand',
    images: {
      de: publicAssetUrl('/landing/screenshots/demo-seed-demand.webp'),
      en: publicAssetUrl('/landing/screenshots/demo-seed-demand-en.webp'),
    },
  },
] as const;

type ProductTourKey = (typeof PRODUCT_TOUR_ITEMS)[number]['key'];

// Hero panel text sits on an opaque-leaning white background (see
// HERO_CARD_SX), so unlike the previous dark-glass version it no longer needs
// a shadow to stay legible - it's kept subtle purely to soften edges against
// the photo behind the panel's own edges/corners.
const HERO_TEXT_SHADOW = (theme: Theme) =>
  `0 1px 2px ${alpha(theme.palette.common.white, 0.4)}`;

// Near-black text tones tuned for AA contrast against the 85%-opacity white
// panel background across a range of photos behind it, not just the current
// one - lighter tones (e.g. MUI's default text.secondary at 0.6 alpha) can
// fall below AA once a lighter/busier photo shows through the blur.
const HERO_TEXT_PRIMARY = (theme: Theme) => alpha(theme.palette.common.black, 0.92);
const HERO_TEXT_SECONDARY = (theme: Theme) => alpha(theme.palette.common.black, 0.78);

// Single knob for the whole hero panel's text size: every fontSize below is
// expressed as a base rem value run through heroRem(), and the panel/description
// max-width scale with it (heroWidth()), so bumping this one number makes
// everything bigger together without shifting the line-wrap points relative
// to each other.
const HERO_FONT_SCALE = 1.1;

const heroRem = (baseRem: number): string => `${+(baseRem * HERO_FONT_SCALE).toFixed(3)}rem`;
const heroWidth = (basePx: number): number => Math.round(basePx * HERO_FONT_SCALE);

// Shared size for every hero action (Register/Sign in buttons, demo link,
// GitHub link) so they read as one consistent row of actions.
const HERO_ACTION_FONT_SIZE = { xs: heroRem(1.05), sm: heroRem(1.1) };

// Single glassmorphism card behind all hero content (heading, description,
// buttons, beta note, GitHub link) - one clearly-bounded, semi-transparent
// panel instead of separate backgrounds per line/element, so there's no risk
// of overlapping panels double-darkening the gaps between them.
//
// The background photo itself stays fully sharp - only this panel is blurred
// and translucent. Browsers without backdrop-filter support (the `@supports`
// fallback below) get a near-opaque background instead, so text stays legible
// even without the blur.
const HERO_CARD_SX: SxProps<Theme> = {
  position: 'relative' as const,
  zIndex: 1,
  width: '100%',
  maxWidth: heroWidth(730),
  mx: 'auto',
  px: { xs: 3, sm: 4, md: 4.5 },
  py: { xs: 3, sm: 3.5, md: 4 },
  borderRadius: { xs: 4, md: 6 },
  border: '1px solid',
  borderColor: (theme) => alpha(theme.palette.common.black, 0.5),
  backgroundColor: (theme) => alpha(theme.palette.common.white, 0.85),
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  // Inset highlight/shade on top of the outer border gives the panel a
  // slight bevel so it reads as a raised glass surface instead of a flat
  // rectangle, matching the depth the previous dark-glass version had.
  // The `0 0 0 1px` shadow is a second 1px ring stacked right outside the
  // `border` above - two crisp lines read as a stronger frame than one
  // border alone, without needing an extra wrapper element.
  boxShadow: 10,
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
    backgroundColor: (theme) => alpha(theme.palette.common.white, 0.96),
  },
};

// Three-column grid so the logo stays centred in the header: the empty first
// column and the language-selector column are both `1fr`, so they always claim
// the same width and the middle column stays centred no matter how long the
// current language label is ("Deutsch", "English", future languages). The side
// columns use `minmax(0, ...)` so a wide selector never pushes the row past the
// container width on small screens.
const HEADER_SX = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
  alignItems: 'center',
  columnGap: { xs: 0.5, sm: 1 },
  minHeight: 48,
};

// Centring costs the wordmark the width of the language selector twice (once
// for the selector itself, once for the mirroring spacer column), so the title
// only has room for its full size once the viewport is wide enough. The clamps
// keep the regular size from ~360px (phones) and ~690px (tablets) upwards and
// scale the heading down below that, so it can never run into the selector.
const TITLE_SX = {
  minWidth: 0,
  fontSize: {
    xs: 'clamp(0.75rem, calc(11.5vw - 25px), 1rem)',
    sm: 'clamp(1.6rem, 4.4vw, 1.9rem)',
    md: '2.5rem',
  },
  fontWeight: 600,
  lineHeight: 1.1,
  overflowWrap: 'normal',
};

/**
 * Public landing page with refined spacing and modern visual hierarchy.
 *
 * @returns Landing page UI.
 */
export default function HomePage() {
  const { t, i18n } = useTranslation('home');
  const {
    isStartingDemo,
    demoStartError,
    isDemoRetryBlocked,
    isDemoButtonDisabled,
    compactRetryTime,
    startDemo,
  } = useGuestDemoStart();
  const [activeTourKey, setActiveTourKey] = useState<ProductTourKey>('areas');
  const activeTourItem = PRODUCT_TOUR_ITEMS.find((item) => item.key === activeTourKey) ?? PRODUCT_TOUR_ITEMS[0];
  const screenshotLanguage = (i18n.resolvedLanguage ?? i18n.language ?? 'de').split('-')[0] === 'en' ? 'en' : 'de';
  const activeTourImage = activeTourItem.images[screenshotLanguage];

  const handleTourChange = (_event: SyntheticEvent, value: ProductTourKey): void => {
    setActiveTourKey(value);
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box component="main" sx={{ flex: 1 }}>
        <Container maxWidth="lg" sx={{ width: '100%', pt: { xs: 1.5, md: 2 }, pb: { xs: 2.5, md: 3 } }}>
          <Box component="header" sx={HEADER_SX}>
            <Stack
              direction="row"
              spacing={{ xs: 0.75, sm: 1.4 }}
              sx={{ gridColumn: 2, minWidth: 0,
          alignItems: "center", }}
            >
              <AppIcon decorative size={{ xs: 32, sm: 40, md: 48 }} sx={{ opacity: 0.95 }} />
              <Typography variant="h2" component="h1" sx={TITLE_SX}>
                {t('landing.title')}
              </Typography>
            </Stack>
            <Box sx={{ gridColumn: 3, justifySelf: 'end' }}>
              <PublicLanguageSwitcher dense />
            </Box>
          </Box>
        </Container>

        <Box
          component="section"
          sx={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              px: 2,
              py: { xs: 4, md: 5 },
              overflow: 'hidden',
              bgcolor: 'navigation.tooltipBackground',
          }}
        >
          <HeroImage alt={t('landing.heroImageAlt')} />
          <Box sx={HERO_CARD_SX}>
            <Stack spacing={{ xs: 2, md: 2.2 }} sx={{ alignItems: "center", }} >
              <Typography
                variant="h6"
                sx={{
                  fontSize: { xs: heroRem(1.35), sm: heroRem(1.5), md: heroRem(1.7) },
                  fontWeight: 600,
                  lineHeight: 1.35,
                  color: HERO_TEXT_PRIMARY,
                  textShadow: HERO_TEXT_SHADOW,
                }}
              >
                {t('landing.subtitle')}
              </Typography>
              <Typography
                sx={{
                  maxWidth: heroWidth(780),
                  fontSize: { xs: heroRem(1.15), md: heroRem(1.25) },
                  fontWeight: 500,
                  lineHeight: 1.65,
                  color: HERO_TEXT_SECONDARY,
                  textShadow: HERO_TEXT_SHADOW,
                }}
              >
                {t('landing.description')}
              </Typography>

              <Stack spacing={1.15} sx={{ width: '100%', pt: 0.3,
                alignItems: "center", }}  >
                <Stack
                  direction="row"
                  spacing={{ xs: 1, sm: 1.2 }}
                  sx={{ width: '100%', flexWrap: 'nowrap',
                alignItems: "center",
                justifyContent: "center", }}
                >
                  <Button
                    component={RouterLink}
                    to="/register"
                    variant="contained"
                    size="large"
                    sx={{
                      minHeight: 46,
                      borderRadius: 2,
                      px: { xs: 2, sm: 3.2 },
                      fontSize: HERO_ACTION_FONT_SIZE,
                      whiteSpace: 'nowrap',
                      boxShadow: (theme) => theme.shadows[3],
                      transition: 'transform 160ms ease, box-shadow 160ms ease',
                      '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: (theme) => theme.shadows[5],
                      },
                    }}
                  >
                    {t('landing.actions.register')}
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/login"
                    variant="outlined"
                    size="large"
                    sx={{
                      minHeight: 46,
                      borderRadius: 2,
                      px: { xs: 2, sm: 3.2 },
                      color: 'primary.main',
                      borderColor: 'surface.surfaceBackground',
                      bgcolor: 'surface.surfaceBackground',
                      fontSize: HERO_ACTION_FONT_SIZE,
                      whiteSpace: 'nowrap',
                      boxShadow: (theme) => theme.shadows[2],
                      transition: 'transform 160ms ease, color 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
                      '&:hover': {
                        transform: 'translateY(-1px)',
                        color: 'primary.dark',
                        borderColor: 'surface.surfaceBackground',
                        bgcolor: (theme) => alpha(theme.palette.common.white, 0.92),
                        boxShadow: (theme) => theme.shadows[4],
                      },
                    }}
                  >
                    {t('landing.actions.openApp')}
                  </Button>
                </Stack>
                <Button
                  variant="text"
                  disabled={isDemoButtonDisabled}
                  onClick={() => {
                    void startDemo();
                  }}
                  sx={{
                    minHeight: 34,
                    px: 1.2,
                    py: 0.4,
                    borderRadius: 1,
                    color: 'primary.main',
                    fontSize: { xs: heroRem(1.05), sm: heroRem(1.1) },
                    fontWeight: 600,
                    textDecoration: 'underline',
                    textUnderlineOffset: '3px',
                    whiteSpace: 'nowrap',
                    '&:hover, &:focus-visible': {
                      color: 'primary.dark',
                      bgcolor: (theme) => alpha(theme.palette.common.black, 0.06),
                      textDecoration: 'underline',
                    },
                    '&.Mui-disabled': {
                      color: 'action.disabled',
                    },
                  }}
                >
                  {isStartingDemo ? (
                    <Stack component="span" direction="row" spacing={0.8} sx={{ alignItems: "center", }} >
                      <CircularProgress color="inherit" size={14} />
                      <span>{t('landing.actions.startingDemo')}</span>
                    </Stack>
                  ) : isDemoRetryBlocked ? (
                    t('landing.actions.demoAvailableIn', {
                      time: compactRetryTime,
                    })
                  ) : (
                    t('landing.actions.demoWithoutRegistration')
                  )}
                </Button>
              </Stack>
              {demoStartError ? (
                <Alert
                  severity="error"
                  sx={{
                    width: '100%',
                    maxWidth: 520,
                    minHeight: 48,
                    textAlign: 'left',
                    color: 'error.dark',
                    bgcolor: (theme) => alpha(theme.palette.common.white, 0.96),
                    border: '1px solid',
                    borderColor: 'error.light',
                    '& .MuiAlert-icon': {
                      color: 'error.main',
                    },
                  }}
                >
                  {demoStartError}
                </Alert>
              ) : null}

              <Stack spacing={0.7} sx={{ pt: { xs: 0.3, md: 0.5 },
                alignItems: "center",
                textAlign: "center", }}   >
                <Typography sx={{ fontSize: { xs: heroRem(1.15), md: heroRem(1.2) }, fontWeight: 500, lineHeight: 1.45, color: HERO_TEXT_PRIMARY, textShadow: HERO_TEXT_SHADOW }}>
                  {t('statusNote')}
                </Typography>
                <Typography
                  sx={{
                    fontSize: { xs: heroRem(1), md: heroRem(1.05) },
                    fontWeight: 500,
                    lineHeight: 1.4,
                    color: HERO_TEXT_SECONDARY,
                    textShadow: HERO_TEXT_SHADOW,
                  }}
                >
                  {t('statusOpenSource.text')}
                </Typography>
                <Link
                  href={t('statusOpenSource.githubUrl')}
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="none"
                  color="primary"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.55,
                    px: 1.1,
                    py: 0.5,
                    mt: 0.3,
                    borderRadius: 1,
                    border: 2,
                    borderColor: 'primary.main',
                    bgcolor: 'surface.surfaceBackground',
                    cursor: 'pointer',
                    fontSize: { xs: heroRem(1.02), md: heroRem(1.08) },
                    fontWeight: 600,
                    lineHeight: 1.4,
                    boxShadow: (theme) => theme.shadows[1],
                    transition: 'color 180ms ease, border-color 180ms ease, background-color 180ms ease',
                    '&:hover': {
                      color: 'primary.dark',
                      borderColor: 'primary.dark',
                      bgcolor: 'surface.surfaceBackground',
                    },
                  }}
                >
                  <GitHubIcon sx={{ fontSize: { xs: '0.95rem', md: '1rem' }, flexShrink: 0 }} />
                  {t('statusOpenSource.linkLabel')}
                </Link>
              </Stack>
            </Stack>
          </Box>
        </Box>

        <Container maxWidth="xl" sx={{ width: '100%', py: { xs: 5, md: 7 } }}>
          <Stack spacing={{ xs: 5.5, md: 7 }} sx={{ alignItems: "center", }} >
            <Box
              component="section"
              aria-labelledby="product-tour-title"
              sx={{ width: '100%' }}
            >
              <Stack spacing={{ xs: 2.5, md: 3.5 }}>
                <Stack spacing={1.25} sx={{ alignItems: "center",
                  textAlign: "center", }}  >
                  <Typography
                    id="product-tour-title"
                    variant="h4"
                    component="h2"
                    sx={{
                      fontSize: { xs: '1.8rem', md: '2.125rem' },
                      fontWeight: 600,
                      lineHeight: 1.18,
                    }}
                  >
                    {t('productTour.title')}
                  </Typography>
                  <Typography color="text.secondary" sx={{ maxWidth: 720, lineHeight: 1.6 }}>
                    {t('productTour.description')}
                  </Typography>
                </Stack>

                <Box>
                  <Tabs
                    value={activeTourKey}
                    onChange={handleTourChange}
                    variant="scrollable"
                    scrollButtons="auto"
                    allowScrollButtonsMobile
                    aria-label={t('productTour.tabsLabel')}
                    sx={{
                      minHeight: 44,
                      borderBottom: 1,
                      borderColor: 'divider',
                      '& .MuiTab-root': {
                        minHeight: 44,
                        px: { xs: 1.25, sm: 2 },
                        textTransform: 'none',
                        fontWeight: 600,
                      },
                      '& .MuiTabs-indicator': {
                        transition: 'none',
                      },
                    }}
                  >
                    {PRODUCT_TOUR_ITEMS.map((item) => (
                      <Tab
                        key={item.key}
                        label={t(`productTour.items.${item.key}.tab`)}
                        value={item.key}
                      />
                    ))}
                  </Tabs>

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 300px' },
                      gap: { xs: 2, md: 4 },
                      alignItems: 'center',
                      pt: { xs: 2, md: 3 },
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Box
                        sx={{
                          minWidth: 0,
                          width: '100%',
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 2,
                          overflow: 'hidden',
                          bgcolor: 'background.paper',
                          boxShadow: (theme) => theme.shadows[2],
                        }}
                      >
                        <Box
                          component="img"
                          src={activeTourImage}
                          alt={t(`productTour.items.${activeTourItem.key}.alt`)}
                          loading="eager"
                          decoding="async"
                          width={1280}
                          height={800}
                          sx={{
                            display: 'block',
                            width: '100%',
                            height: 'auto',
                          }}
                        />
                      </Box>
                    </Box>

                    <Stack
                      spacing={1}
                      sx={{
                        minWidth: 0,
                        width: '100%',
                        alignSelf: { xs: 'start', md: 'center' },
                      }}
                    >
                      <Typography variant="h5" component="h3" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                        {t(`productTour.items.${activeTourItem.key}.title`)}
                      </Typography>
                      <Typography color="text.secondary" sx={{ lineHeight: 1.65 }}>
                        {t(`productTour.items.${activeTourItem.key}.description`)}
                      </Typography>
                    </Stack>
                  </Box>
                </Box>
              </Stack>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', py: { xs: 2.5, md: 2.75 }, bgcolor: 'background.paper' }}>
        <Container maxWidth="md">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 1.25, sm: 3 }}
            sx={{ alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: "space-between", }}
          >
            <LegalLinks />
            <Link href={`mailto:${t('footer.contactEmail')}`} underline="hover" color="text.secondary" sx={{ fontSize: '0.92rem' }}>
              {t('footer.contactLabel', { email: t('footer.contactEmail') })}
            </Link>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
