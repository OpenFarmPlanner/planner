/**
 * Shared shell for the legal documents (imprint, privacy policy, terms).
 *
 * The title remains the primary element while compact document controls share
 * the same row on wider screens. The grid gives the title a balanced centre
 * column and lets the controls stack underneath it on phones.
 */

import type { ReactNode } from 'react';
import PrintIcon from '@mui/icons-material/Print';
import { Alert, Box, Container, IconButton, Link, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

import { Link as RouterLink } from 'react-router';
import { useTranslation } from '../../i18n';
import { DEFAULT_SEO_LANGUAGE } from '../../seo/seoConfig';
import { useCurrentPublicPage } from '../../i18n/routeLanguage';
import PublicPageLanguageBar from '../../i18n/PublicPageLanguageBar';
import { AppTooltip } from '../AppTooltip';

const documentSx = {
  pt: { xs: 2, sm: 2.5, md: 3 },
  pb: { xs: 6, md: 9 },
} as const;

const headerSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(7rem, 1fr) minmax(0, auto) minmax(7rem, 1fr)' },
  alignItems: 'center',
  columnGap: { sm: 1.5, md: 2 },
  rowGap: 1,
} as const;

const titleSx = {
  gridColumn: { xs: '1', sm: '2' },
  justifySelf: 'center',
  minWidth: 0,
  maxWidth: '100%',
  textAlign: 'center',
  fontSize: { xs: '1.65rem', sm: '2.25rem', md: '2.75rem' },
  overflowWrap: 'anywhere',
} as const;

const headerControlsSx = {
  gridColumn: { xs: '1', sm: '3' },
  justifySelf: { xs: 'center', sm: 'end' },
  display: 'flex',
  alignItems: 'center',
  gap: { xs: 0.5, sm: 0.75 },
  '@media print': { display: 'none' },
} as const;

const getLegalToolbarInteractionSx = (theme: Theme) => ({
  borderRadius: 1,
  '&.Mui-focusVisible': {
    outline: `2px solid ${theme.palette.primary.light}`,
    outlineOffset: 2,
  },
});

const printButtonSx = (theme: Theme) => ({
  ...getLegalToolbarInteractionSx(theme),
  flex: '0 0 auto',
  width: 40,
  height: 40,
  color: theme.palette.primary.main,
  '&:hover, &.Mui-focusVisible': {
    color: theme.palette.primary.dark,
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },
});

const languageSwitcherButtonSx = (theme: Theme) => ({
  ...getLegalToolbarInteractionSx(theme),
  color: theme.palette.text.primary,
  '& .MuiButton-startIcon, & .MuiButton-endIcon': {
    color: theme.palette.primary.main,
  },
  '&:hover, &.Mui-focusVisible': {
    color: theme.palette.text.primary,
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
    '& .MuiButton-startIcon, & .MuiButton-endIcon': {
      color: theme.palette.primary.dark,
    },
  },
});

const languageSwitcherSx = { flex: '0 1 auto' } as const;

interface LegalDocumentLayoutProps {
  title: string;
  /** Optional secondary content below the title row, e.g. a cross-reference link. */
  actions?: ReactNode;
  children: ReactNode;
}

export default function LegalDocumentLayout({ title, actions, children }: LegalDocumentLayoutProps) {
  const { t } = useTranslation('home');
  const printLabel = t('legal.terms.print');
  const variant = useCurrentPublicPage();
  // Only the German text is legally binding; translations say so up front
  // and link back to it.
  const isTranslation = variant !== null && variant.language !== DEFAULT_SEO_LANGUAGE;

  return (
    <Container maxWidth="md" sx={documentSx}>
      <Stack spacing={3}>
        <Box component="header" sx={headerSx}>
          <Typography variant="h3" component="h1" sx={titleSx}>
            {title}
          </Typography>
          <Box sx={headerControlsSx}>
            <AppTooltip title={printLabel}>
              <IconButton
                type="button"
                aria-label={printLabel}
                onClick={() => window.print()}
                size="small"
                sx={printButtonSx}
              >
                <PrintIcon fontSize="small" />
              </IconButton>
            </AppTooltip>
            <PublicPageLanguageBar sx={languageSwitcherSx} buttonSx={languageSwitcherButtonSx} />
          </Box>
        </Box>
        {actions ? (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              mt: -2,
              '@media print': { display: 'none' },
            }}
          >
            {actions}
          </Box>
        ) : null}
        {isTranslation ? (
          <Alert severity="info" data-testid="legal-convenience-translation-notice">
            {t('legal.convenienceTranslationNotice')}{' '}
            <Link
              component={RouterLink}
              to={variant.page.paths[DEFAULT_SEO_LANGUAGE]}
              hrefLang={DEFAULT_SEO_LANGUAGE}
              lang={DEFAULT_SEO_LANGUAGE}
            >
              {t('legal.germanVersionLink')}
            </Link>
          </Alert>
        ) : null}
        {children}
      </Stack>
    </Container>
  );
}
