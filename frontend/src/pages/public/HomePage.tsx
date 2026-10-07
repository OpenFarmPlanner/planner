import GitHubIcon from '@mui/icons-material/GitHub';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import GrassIcon from '@mui/icons-material/Grass';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import MapIcon from '@mui/icons-material/Map';
import GroupsIcon from '@mui/icons-material/Groups';
import HistoryIcon from '@mui/icons-material/History';
import ImportExportIcon from '@mui/icons-material/ImportExport';
import InstallMobileIcon from '@mui/icons-material/InstallMobile';
import {
  Alert,
  Box,
  Button,
  Container,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigationType } from 'react-router';
import { useTranslation } from '../../i18n';
import { API_DOCS_URL } from '../../api/apiDocsUrl';
import HeroImage from '../../components/HeroImage';
import PublicTopbar from '../../components/layout/PublicTopbar';
import PublicFooter from '../../components/layout/PublicFooter';
import { useGuestDemoStart } from './useGuestDemoStart';
import { InstallAppButton } from '../../pwa/InstallAppButton';
import EditableTableIllustration from './homeIllustrations/EditableTableIllustration';
import CropLibraryIllustration from './homeIllustrations/CropLibraryIllustration';
import { AREA_LABEL_SEPARATOR } from '../plantingPlansUtils';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

// Hero panel text sits on an opaque-leaning white background (see
// HERO_CARD_SX), so unlike a dark-glass version it no longer needs a shadow
// to stay legible - it's kept subtle purely to soften edges against the
// photo behind the panel's own edges/corners.
const HERO_TEXT_SHADOW = (theme: Theme) =>
  `0 1px 2px ${alpha(theme.palette.common.white, 0.4)}`;

// Near-black text tones tuned for AA contrast against the white panel
// background across a range of photos behind it, not just the current one.
const HERO_TEXT_PRIMARY = (theme: Theme) => alpha(theme.palette.common.black, 0.92);
const HERO_TEXT_SECONDARY = (theme: Theme) => alpha(theme.palette.common.black, 0.78);

const HERO_FONT_SCALE = 1.1;
const heroRem = (baseRem: number): string => `${+(baseRem * HERO_FONT_SCALE).toFixed(3)}rem`;
const heroWidth = (basePx: number): number => Math.round(basePx * HERO_FONT_SCALE);

const HERO_ACTION_FONT_SIZE = { xs: heroRem(1.05), sm: heroRem(1.1) };

// Single glassmorphism card behind all hero content - one clearly-bounded,
// semi-transparent panel. A slightly more opaque, lighter-bordered version
// than the previous one so the panel reads calmer against the photo.
const HERO_CARD_SX: SxProps<Theme> = {
  position: 'relative' as const,
  zIndex: 1,
  width: '100%',
  maxWidth: heroWidth(730),
  mx: 'auto',
  px: { xs: 3, sm: 4, md: 4.5 },
  py: { xs: 3, sm: 3.5, md: 4 },
  borderRadius: { xs: 5, md: 7 },
  border: '1px solid',
  borderColor: (theme) => alpha(theme.palette.common.black, 0.35),
  backgroundColor: (theme) => alpha(theme.palette.common.white, 0.88),
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  boxShadow: 18,
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
    backgroundColor: (theme) => alpha(theme.palette.common.white, 0.97),
  },
};

const SECTION_ANCHOR_SX: SxProps<Theme> = {
  // Offset so a jump to the anchor doesn't tuck the heading under the sticky
  // topbar. `scrollMarginTop` isn't one of the properties MUI's sx spacing
  // transform recognizes, so a bare number would be emitted as unitless
  // (invalid) CSS and silently dropped - spell it out via theme.spacing().
  scrollMarginTop: (theme) => theme.spacing(10),
};

interface FeaturePoint {
  text: string;
}

function FeatureCheckList({ points }: { points: FeaturePoint[] }) {
  return (
    <Stack spacing={1.25}>
      {points.map((point) => (
        <Stack key={point.text} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <CheckCircleIcon color="primary" fontSize="small" sx={{ mt: 0.3, flexShrink: 0 }} />
          <Typography sx={{ lineHeight: 1.55 }}>{point.text}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

interface SeasonFeatureCard {
  icon: ReactNode;
  title: string;
  description: string;
}

function SeasonFeatureCardItem({ icon, title, description }: SeasonFeatureCard) {
  return (
    <Stack
      spacing={1.5}
      sx={{
        p: 2.5,
        height: '100%',
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: 2,
          bgcolor: 'surface.surfaceHoverBackground',
          color: 'primary.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </Box>
      <Typography variant="h6" component="h3" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ lineHeight: 1.55 }}>
        {description}
      </Typography>
    </Stack>
  );
}

interface OpenSourceBox {
  title: string;
  description: string;
  href?: string;
}

function OpenSourceBoxItem({ title, description, href }: OpenSourceBox) {
  const content = (
    <Stack spacing={0.5} sx={{ textAlign: 'left' }}>
      <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
      <Typography variant="body2">{description}</Typography>
    </Stack>
  );

  const boxSx: SxProps<Theme> = {
    p: 2,
    borderRadius: 2,
    border: 1,
    borderColor: (theme) => alpha(theme.palette.common.white, 0.25),
    height: '100%',
    display: 'block',
    textDecoration: 'none',
    color: 'inherit',
    // The theme's global CssBaseline `a:visited` rule (element + pseudo-class)
    // outranks this component's own class for specificity, so a previously
    // visited link would otherwise render in the dark primary colour instead
    // of the inherited white - invisible against this section's dark-green
    // background.
    '&:visited': {
      color: 'inherit',
    },
  };

  if (href) {
    return (
      <Link href={href} target="_blank" rel="noopener noreferrer" color="inherit" underline="none" sx={boxSx}>
        {content}
      </Link>
    );
  }

  return <Box sx={boxSx}>{content}</Box>;
}

/**
 * Public landing page: hero, two headline feature sections, a feature grid,
 * an open-source section, and a closing demo call-to-action. One scroll
 * page with anchor links in the sticky topbar.
 */
export default function HomePage() {
  const { t, i18n } = useTranslation('home');
  const location = useLocation();
  const {
    isStartingDemo,
    demoStartError,
    isDemoRetryBlocked,
    isDemoButtonDisabled,
    compactRetryTime,
    startDemo,
  } = useGuestDemoStart();

  useEffect(() => {
    document.body.classList.add('sticky-app-bar');
    return () => {
      document.body.classList.remove('sticky-app-bar');
    };
  }, []);

  const navigationType = useNavigationType();
  const isFirstHashEffect = useRef(true);

  useEffect(() => {
    // Scroll on arrival (deep link) and on browser back/forward between
    // anchors; in-page anchor clicks (PUSH) scroll themselves.
    const isArrival = isFirstHashEffect.current;
    isFirstHashEffect.current = false;
    if (!isArrival && navigationType !== 'POP') {
      return;
    }
    if (!location.hash) {
      if (!isArrival) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
      return;
    }
    let id = location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed percent-encoding in a hand-typed URL must not crash the page.
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [location.hash, navigationType]);

  const githubUrl = t('github.url');
  const illustrationLocale = resolveLocaleFromLanguage(i18n.resolvedLanguage);
  const formatIllustrationDate = (isoDate: string): string => new Date(`${isoDate}T00:00:00`).toLocaleDateString(illustrationLocale);
  const formatIllustrationNumber = (value: number): string => formatLocalizedNumber(value, illustrationLocale);
  const illustrationFieldBed = (fieldKey: string, bedKey: string): string =>
    `${t(`features.illustration.rows.${fieldKey}`)}${AREA_LABEL_SEPARATOR}${t(`features.illustration.rows.${bedKey}`)}`;
  const illustrationRows = [
    {
      crop: t('features.illustration.rows.lettuce.crop'),
      fieldBed: illustrationFieldBed('lettuce.field', 'lettuce.bed'),
      sowingDate: formatIllustrationDate('2026-02-26'),
      plantingDate: formatIllustrationDate('2026-03-22'),
      areaM2: formatIllustrationNumber(8.5),
    },
    {
      crop: t('features.illustration.rows.tomato.crop'),
      fieldBed: illustrationFieldBed('tomato.field', 'tomato.bed'),
      sowingDate: formatIllustrationDate('2026-03-11'),
      plantingDate: formatIllustrationDate('2026-04-25'),
      areaM2: formatIllustrationNumber(14),
    },
    {
      crop: t('features.illustration.rows.cucumber.crop'),
      fieldBed: illustrationFieldBed('cucumber.field', 'cucumber.bed'),
      sowingDate: formatIllustrationDate('2026-04-12'),
      plantingDate: formatIllustrationDate('2026-05-10'),
      areaM2: formatIllustrationNumber(12),
      editing: true,
      autoUpdated: true,
    },
  ];

  const topbarAnchors = [
    { id: 'funktionen', label: t('topbar.nav.features') },
    { id: 'kulturbibliothek', label: t('topbar.nav.cropLibrary') },
    { id: 'open-source', label: t('topbar.nav.openSource') },
  ];

  const featurePoints: FeaturePoint[] = [
    { text: t('features.points.typing') },
    { text: t('features.points.oneSource') },
    { text: t('features.points.validation') },
  ];

  const seasonFeatureIcons: Record<string, ReactNode> = {
    calendar: <CalendarMonthIcon />,
    rolloverSeason: <RestartAltIcon />,
    seedDemand: <GrassIcon />,
    yieldDistribution: <TrendingUpIcon />,
    fieldMap: <MapIcon />,
    collaboration: <GroupsIcon />,
    history: <HistoryIcon />,
    importExport: <ImportExportIcon />,
    installApp: <InstallMobileIcon />,
  };
  const seasonFeatureKeys = Object.keys(seasonFeatureIcons);

  const openSourceBoxes: (OpenSourceBox & { key: string })[] = [
    { key: 'agpl', title: t('openSource.boxes.agpl.title'), description: t('openSource.boxes.agpl.description') },
    { key: 'gdpr', title: t('openSource.boxes.gdpr.title'), description: t('openSource.boxes.gdpr.description') },
    {
      key: 'api',
      title: t('openSource.boxes.api.title'),
      description: t('openSource.boxes.api.description'),
      href: API_DOCS_URL,
    },
    { key: 'practice', title: t('openSource.boxes.practice.title'), description: t('openSource.boxes.practice.description') },
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
        <Box
          id="top"
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
            <Stack spacing={{ xs: 2, md: 2.2 }} sx={{ alignItems: 'center' }}>
              <Typography
                variant="h1"
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

              <Stack spacing={1.15} sx={{ width: '100%', pt: 0.3, alignItems: 'center' }}>
                <Stack
                  direction="row"
                  spacing={{ xs: 1, sm: 1.2 }}
                  sx={{ width: '100%', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'center' }}
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
                <InstallAppButton
                  sx={{
                    minHeight: 42,
                    borderRadius: 2,
                    px: { xs: 2, sm: 3.2 },
                    color: 'primary.main',
                    borderColor: 'surface.surfaceBackground',
                    bgcolor: 'surface.surfaceBackground',
                    fontSize: HERO_ACTION_FONT_SIZE,
                    whiteSpace: 'nowrap',
                    boxShadow: (theme) => theme.shadows[1],
                    '&:hover': {
                      color: 'primary.dark',
                      borderColor: 'surface.surfaceBackground',
                      bgcolor: (theme) => alpha(theme.palette.common.white, 0.92),
                    },
                  }}
                />
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
                    <Stack component="span" direction="row" spacing={0.8} sx={{ alignItems: 'center' }}>
                      <CircularProgress color="inherit" size={14} />
                      <span>{t('landing.actions.startingDemo')}</span>
                    </Stack>
                  ) : isDemoRetryBlocked ? (
                    t('landing.actions.demoAvailableIn', { time: compactRetryTime })
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

              <Stack spacing={0.7} sx={{ pt: { xs: 0.3, md: 0.5 }, alignItems: 'center', textAlign: 'center' }}>
                <Typography
                  sx={{
                    fontSize: { xs: heroRem(1), md: heroRem(1.05) },
                    fontWeight: 500,
                    lineHeight: 1.4,
                    color: HERO_TEXT_SECONDARY,
                    textShadow: HERO_TEXT_SHADOW,
                  }}
                >
                  {t('landing.statusLine')}
                </Typography>
                <Link
                  href={githubUrl}
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
                  {t('landing.githubLinkLabel')}
                </Link>
              </Stack>
            </Stack>
          </Box>
        </Box>

        <Container maxWidth="xl" sx={{ width: '100%', py: { xs: 6, md: 8 } }}>
          <Stack spacing={{ xs: 8, md: 11 }}>
            <Box id="funktionen" component="section" aria-labelledby="features-title" sx={SECTION_ANCHOR_SX}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
                  gap: { xs: 4, md: 6 },
                  alignItems: 'center',
                }}
              >
                <Stack spacing={2}>
                  <Typography variant="overline" color="primary" sx={{ fontWeight: 700 }}>
                    {t('features.eyebrow')}
                  </Typography>
                  <Typography id="features-title" variant="h4" component="h2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                    {t('features.title')}
                  </Typography>
                  <Typography color="text.secondary" sx={{ lineHeight: 1.65 }}>
                    {t('features.description')}
                  </Typography>
                  <FeatureCheckList points={featurePoints} />
                </Stack>
                <EditableTableIllustration
                  ariaLabel={t('features.illustration.ariaLabel')}
                  columns={{
                    crop: t('plantingPlans:columns.crop'),
                    fieldBed: t('plantingPlans:columns.fieldBed', { separator: AREA_LABEL_SEPARATOR }),
                    sowingDate: t('plantingPlans:columns.sowingDate'),
                    plantingDate: t('plantingPlans:columns.plantingDate'),
                    areaM2: t('plantingPlans:columns.areaM2'),
                  }}
                  rows={illustrationRows}
                  linkedCaption={t('features.illustration.linkedCaption')}
                  cards={[
                    {
                      title: t('features.illustration.cards.calendar.title'),
                      detail: t('features.illustration.cards.calendar.detail'),
                    },
                    {
                      title: t('features.illustration.cards.yield.title'),
                      detail: t('features.illustration.cards.yield.detail'),
                    },
                  ]}
                />
              </Box>
            </Box>

            <Box id="kulturbibliothek" component="section" aria-labelledby="crop-library-title" sx={SECTION_ANCHOR_SX}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
                  gap: { xs: 4, md: 6 },
                  alignItems: 'center',
                }}
              >
                <Box sx={{ order: { xs: 2, md: 0 } }}>
                  <CropLibraryIllustration
                    ariaLabel={t('cropLibrary.illustration.ariaLabel')}
                    libraryTitle={t('cropLibrary.illustration.libraryTitle')}
                    librarySubtitle={t('cropLibrary.illustration.librarySubtitle')}
                    arrows={{
                      share: t('cropLibrary.illustration.arrows.share'),
                      shareUpdate: t('cropLibrary.illustration.arrows.shareUpdate'),
                      import: t('cropLibrary.illustration.arrows.import'),
                      pullUpdate: t('cropLibrary.illustration.arrows.pullUpdate'),
                    }}
                    yourCropsTitle={t('cropLibrary.illustration.yourCropsTitle')}
                    cropChips={[
                      t('features.illustration.rows.lettuce.crop'),
                      t('features.illustration.rows.tomato.crop'),
                      t('features.illustration.rows.cucumber.crop'),
                    ]}
                  />
                </Box>
                <Stack spacing={2} sx={{ order: { xs: 1, md: 0 } }}>
                  <Typography variant="overline" color="primary" sx={{ fontWeight: 700 }}>
                    {t('cropLibrary.eyebrow')}
                  </Typography>
                  <Typography id="crop-library-title" variant="h4" component="h2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                    {t('cropLibrary.title')}
                  </Typography>
                  <Typography color="text.secondary" sx={{ lineHeight: 1.65 }}>
                    {t('cropLibrary.description')}
                  </Typography>
                </Stack>
              </Box>
            </Box>

            <Box component="section" aria-labelledby="season-features-title">
              <Stack spacing={{ xs: 3, md: 4 }}>
                <Typography
                  id="season-features-title"
                  variant="h4"
                  component="h2"
                  sx={{ fontWeight: 600, lineHeight: 1.2, textAlign: 'center' }}
                >
                  {t('seasonFeatures.title')}
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
                    gap: 3,
                  }}
                >
                  {seasonFeatureKeys.map((key) => (
                    <SeasonFeatureCardItem
                      key={key}
                      icon={seasonFeatureIcons[key]}
                      title={t(`seasonFeatures.items.${key}.title`)}
                      description={t(`seasonFeatures.items.${key}.description`)}
                    />
                  ))}
                </Box>
              </Stack>
            </Box>
          </Stack>
        </Container>

        <Box
          id="open-source"
          component="section"
          aria-labelledby="open-source-title"
          sx={{ ...SECTION_ANCHOR_SX, bgcolor: 'brandDark.background', color: 'brandDark.text', py: { xs: 6, md: 8 } }}
        >
          <Container maxWidth="lg">
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
                gap: { xs: 4, md: 6 },
                alignItems: 'start',
              }}
            >
              <Stack spacing={2.5} sx={{ alignItems: 'flex-start', textAlign: 'left' }}>
                <Typography variant="overline" sx={{ fontWeight: 700, color: 'brandDark.eyebrow' }}>
                  {t('openSource.eyebrow')}
                </Typography>
                <Typography id="open-source-title" variant="h4" component="h2" sx={{ fontWeight: 600, color: 'common.white' }}>
                  {t('openSource.title')}
                </Typography>
                <Typography sx={{ maxWidth: 480, lineHeight: 1.65 }}>
                  {t('openSource.description')}
                </Typography>
                <Button
                  href={githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="contained"
                  color="inherit"
                  size="large"
                  startIcon={<GitHubIcon />}
                  sx={{ bgcolor: 'common.white', color: 'primary.dark', '&:hover': { bgcolor: 'grey.100', color: 'primary.dark' } }}
                >
                  {t('openSource.sourceButton')}
                </Button>
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                  gap: 2,
                }}
              >
                {openSourceBoxes.map((box) => (
                  <OpenSourceBoxItem key={box.key} title={box.title} description={box.description} href={box.href} />
                ))}
              </Box>
            </Box>
          </Container>
        </Box>

        <Container maxWidth="md" sx={{ width: '100%', py: { xs: 6, md: 8 } }}>
          <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography variant="h4" component="h2" sx={{ fontWeight: 600 }}>
              {t('closing.title')}
            </Typography>
            <Button
              variant="contained"
              size="large"
              disabled={isDemoButtonDisabled}
              onClick={() => {
                void startDemo();
              }}
              sx={{ minHeight: 48, px: 4 }}
            >
              {isStartingDemo ? (
                <Stack component="span" direction="row" spacing={0.8} sx={{ alignItems: 'center' }}>
                  <CircularProgress color="inherit" size={16} />
                  <span>{t('landing.actions.startingDemo')}</span>
                </Stack>
              ) : isDemoRetryBlocked ? (
                t('landing.actions.demoAvailableIn', { time: compactRetryTime })
              ) : (
                t('closing.startDemo')
              )}
            </Button>
            <Link component={RouterLink} to="/ueber" underline="hover" color="text.secondary">
              {t('closing.aboutLink')}
            </Link>
          </Stack>
        </Container>
      </Box>

      <PublicFooter />
    </Box>
  );
}
