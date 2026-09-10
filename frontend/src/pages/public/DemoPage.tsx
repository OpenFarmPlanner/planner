import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router';

import HeroImage from '../../components/HeroImage';
import LegalLinks from '../../components/legal/LegalLinks';
import { PublicLanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { useTranslation } from '../../i18n';
import { useGuestDemoStart } from './useGuestDemoStart';
import AppIcon from '../../components/layout/AppIcon';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

const HERO_TEXT_SHADOW = (theme: Theme) =>
  `0 1px 3px ${alpha(theme.palette.common.black, 0.7)}, 0 2px 12px ${alpha(theme.palette.common.black, 0.5)}`;

export default function DemoPage() {
  const { t } = useTranslation('home');
  const {
    isStartingDemo,
    demoStartError,
    isDemoRetryBlocked,
    isDemoButtonDisabled,
    compactRetryTime,
    startDemo,
  } = useGuestDemoStart();

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box component="main" sx={{ flex: 1 }}>
        <Container maxWidth="lg" sx={{ width: '100%', pt: { xs: 1.5, md: 2 }, pb: { xs: 2.5, md: 3 } }}>
          <Stack
            component="header"
            direction="row"
            spacing={{ xs: 0.75, sm: 2 }}
            sx={{ minHeight: 48,
          alignItems: "center",
          justifyContent: "space-between", }}
          >
            <Button
              component={RouterLink}
              to="/"
              color="inherit"
              startIcon={<ArrowBackIcon fontSize="small" />}
              sx={{
                minHeight: 44,
                px: { xs: 0.75, sm: 1 },
                textTransform: 'none',
                fontWeight: 500,
              }}
            >
              {t('demoPage.backToLanding')}
            </Button>
            <PublicLanguageSwitcher dense />
          </Stack>
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
          py: { xs: 5, md: 7 },
          overflow: 'hidden',
          bgcolor: 'navigation.tooltipBackground',
          minHeight: { xs: 'calc(100vh - 180px)', md: 'calc(100vh - 190px)' },
            '@media (max-height: 480px)': {
              py: 2,
              minHeight: 'auto',
            },
          }}
        >
          <HeroImage alt={t('landing.heroImageAlt')} />
          <Box
            sx={{
              position: 'relative',
              zIndex: 1,
              width: '100%',
              maxWidth: 680,
              mx: 'auto',
              px: { xs: 3, sm: 4, md: 5 },
              py: { xs: 3.5, sm: 4, md: 4.5 },
              borderRadius: { xs: 4, md: 6 },
              border: '1px solid',
              borderColor: (theme) => alpha(theme.palette.common.white, 0.28),
              backgroundColor: (theme) => alpha(theme.palette.navigation.tooltipBackground, 0.52),
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              boxShadow: 8,
              '@media (max-height: 480px)': {
                py: 2.5,
              },
            }}
          >
            <Stack spacing={{ xs: 2.1, md: 2.4 }} sx={{ alignItems: "center", }} >
              <AppIcon decorative size={{ xs: 44, md: 52 }} sx={{ opacity: 0.95 }} />
              <Typography
                variant="h2"
                component="h1"
                sx={{
                  fontSize: { xs: '2rem', md: '2.7rem' },
                  fontWeight: 600,
                  lineHeight: 1.1,
                  color: 'common.white',
                  textShadow: HERO_TEXT_SHADOW,
                  '@media (max-height: 480px)': {
                    fontSize: '1.7rem',
                  },
                }}
              >
                {t('demoPage.title')}
              </Typography>
              <Typography
                variant="h6"
                sx={{
                  maxWidth: 560,
                  fontWeight: 500,
                  lineHeight: 1.4,
                  color: 'common.white',
                  textShadow: HERO_TEXT_SHADOW,
                  '@media (max-height: 480px)': {
                    fontSize: '1rem',
                  },
                }}
              >
                {t('demoPage.subtitle')}
              </Typography>
              <Typography
                sx={{
                  maxWidth: 600,
                  lineHeight: 1.65,
                  color: (theme) => alpha(theme.palette.common.white, 0.94),
                  textShadow: HERO_TEXT_SHADOW,
                  '@media (max-height: 480px)': {
                    display: 'none',
                  },
                }}
              >
                {t('demoPage.description')}
              </Typography>

              <Button
                variant="contained"
                size="large"
                disabled={isDemoButtonDisabled}
                startIcon={isStartingDemo ? <CircularProgress color="inherit" size={18} /> : <PlayArrowIcon />}
                onClick={() => {
                  void startDemo();
                }}
                sx={{
                  minHeight: 48,
                  borderRadius: 2,
                  px: { xs: 2.4, sm: 3.5 },
                  whiteSpace: 'nowrap',
                  boxShadow: (theme) => theme.shadows[3],
                }}
              >
                {isStartingDemo
                  ? t('landing.actions.startingDemo')
                  : isDemoRetryBlocked
                    ? t('landing.actions.demoAvailableIn', { time: compactRetryTime })
                    : t('demoPage.startAction')}
              </Button>

              {demoStartError ? (
                <Alert
                  severity="error"
                  sx={{
                    width: '100%',
                    maxWidth: 560,
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

              <Typography
                sx={{
                  maxWidth: 560,
                  fontSize: { xs: '0.88rem', md: '0.94rem' },
                  lineHeight: 1.55,
                  color: (theme) => alpha(theme.palette.common.white, 0.9),
                  textShadow: HERO_TEXT_SHADOW,
                }}
              >
                {t('demoPage.safetyNote')}
              </Typography>
            </Stack>
          </Box>
        </Box>
      </Box>

      <Box component="footer" sx={{ py: 2.5 }}>
        <Container maxWidth="md">
          <LegalLinks sx={{ justifyContent: 'center' }} />
        </Container>
      </Box>
    </Box>
  );
}
