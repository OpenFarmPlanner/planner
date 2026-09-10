import { Box, Container, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import LegalLinks from '../../components/legal/LegalLinks';
import HeroImage from '../../components/HeroImage';
import { authLegalLinkSx } from './authPageStyles';
import { PublicLanguageSwitcher } from '../../i18n/LanguageSwitcher';
import AppIcon from '../../components/layout/AppIcon';
import { alpha } from '@mui/material/styles';

type AuthPageShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  legalLinksDense?: boolean;
};

export default function AuthPageShell({ title, subtitle, children, legalLinksDense = false }: AuthPageShellProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'surface.surfaceHoverBackground',
        overflow: 'hidden',
      }}
    >
      <HeroImage
        alt=""
        position={{ xs: 'absolute', md: 'fixed' }}
        overlaySx={{
          backgroundImage: (theme) => {
            const background = theme.palette.surface.surfaceHoverBackground;
            return `linear-gradient(${alpha(background, 0.88)}, ${alpha(background, 0.9)})`;
          },
        }}
      />
      <Container
        maxWidth="lg"
        sx={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: { xs: 'flex-start', md: 'center' },
          px: { xs: 2, sm: 3 },
          py: { xs: 3, sm: 5, md: 7 },
        }}
      >
        <Stack spacing={{ xs: 2.5, md: 3.5 }} sx={{ alignItems: "center", }} >
          <Box
            sx={{
              width: '100%',
              maxWidth: 560,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              rowGap: 1,
              columnGap: 2,
            }}
          >
            <Stack direction="row" spacing={1.4} sx={{ alignItems: "center", }} >
              <AppIcon decorative size={{ xs: 40, md: 48 }} sx={{ opacity: 0.95 }} />
              <Typography
                variant="h2"
                component="div"
                sx={{
                  fontSize: { xs: '1.9rem', md: '2.5rem' },
                  fontWeight: 600,
                  lineHeight: 1.1,
                }}
              >
                OpenFarmPlanner
              </Typography>
            </Stack>
            <PublicLanguageSwitcher dense />
          </Box>

          <Paper
            elevation={0}
            sx={{
              width: '100%',
              maxWidth: 560,
              borderRadius: { xs: 3, md: 4 },
              border: '1px solid',
              borderColor: (theme) => alpha(theme.palette.primary.main, 0.12),
              boxShadow: 6,
              bgcolor: 'surface.surfaceBackground',
              p: { xs: 2.5, sm: 4, md: 4.5 },
            }}
          >
            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontWeight: 600,
                fontSize: { xs: '1.85rem', md: '2.15rem' },
                lineHeight: 1.18,
                mb: 1,
              }}
            >
              {title}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: '1rem', lineHeight: 1.55 }}>
              {subtitle}
            </Typography>
            <Box sx={{ mt: { xs: 2.75, sm: 3.25 } }}>{children}</Box>
          </Paper>

          <LegalLinks
            dense={legalLinksDense}
            sx={{
              justifyContent: 'center',
              textShadow: (theme) => `0 1px 2px ${alpha(theme.palette.common.white, 0.9)}`,
            }}
            linkSx={{
              ...authLegalLinkSx,
              fontWeight: 500,
            }}
          />
        </Stack>
      </Container>
    </Box>
  );
}
