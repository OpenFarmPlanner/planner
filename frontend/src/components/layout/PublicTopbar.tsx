import { useState } from 'react';
import type { MouseEvent } from 'react';
import { AppBar, Box, Button, IconButton, Menu, MenuItem, Toolbar, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import MenuIcon from '@mui/icons-material/Menu';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import AppIcon from './AppIcon';
import { PublicLanguageSwitcher } from '../../i18n/LanguageSwitcher';

// Shared look for the anchor/page nav links: plain black at rest (the brand
// green read as too heavy for every-link-is-emphasised) with a medium
// weight, and a rounded primary-tinted treatment for hover/focus so the
// active link can reuse the exact same look permanently instead of a
// separate underline style.
const navLinkSx: SystemStyleObject<Theme> = {
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.9375rem',
  whiteSpace: 'nowrap',
  color: 'common.black',
  minHeight: 44,
  borderRadius: 2,
  px: 1.25,
  // The theme's global CssBaseline `a:visited` rule (element + pseudo-class)
  // outranks this component's own class for specificity, so a visited nav
  // link (these all point to in-page hashes or /ueber, easy to "visit" just
  // by clicking around) would otherwise render in the dark primary colour
  // instead of black at rest.
  '&:visited': {
    color: 'common.black',
  },
  '&:hover': {
    color: 'primary.main',
    backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08),
  },
  '&.Mui-focusVisible': {
    color: 'primary.main',
    backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08),
    outline: (theme) => `2px solid ${theme.palette.primary.main}`,
    outlineOffset: 2,
  },
};

const navLinkActiveSx: SystemStyleObject<Theme> = {
  color: 'primary.main',
  backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08),
};

const navMenuItemSx: SystemStyleObject<Theme> = {
  minHeight: 44,
  borderRadius: 1,
  mx: 0.5,
  color: 'common.black',
  '&:visited': {
    color: 'common.black',
  },
  '&:hover': {
    color: 'primary.main',
    backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08),
  },
  '&.Mui-focusVisible': {
    color: 'primary.main',
    backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08),
  },
};

const navMenuItemActiveSx: SystemStyleObject<Theme> = {
  color: 'primary.main',
  backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08),
};

export interface PublicTopbarAnchor {
  id: string;
  label: string;
}

export interface PublicTopbarPageLink {
  path: string;
  label: string;
}

interface PublicTopbarProps {
  brandLabel: string;
  brandAriaLabel: string;
  anchors: PublicTopbarAnchor[];
  /** A real route link shown after the anchors (e.g. an "About" page), marked aria-current="page" while active. */
  pageLink: PublicTopbarPageLink;
  menuAriaLabel: string;
  navAriaLabel: string;
  signInLabel: string;
}

function scrollToSection(id: string | null): void {
  if (id === null) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Sticky header for the public marketing pages (landing page, about page).
 * Anchor links navigate within the current page when already on `/` (smooth
 * scroll + hash update) and fall back to a normal `/#id` navigation
 * otherwise, so they also work as deep links from another page such as
 * `pageLink`.
 */
export default function PublicTopbar({
  brandLabel,
  brandAriaLabel,
  anchors,
  pageLink,
  menuAriaLabel,
  navAriaLabel,
  signInLabel,
}: PublicTopbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const isPageLinkActive = location.pathname === pageLink.path;

  const handleAnchorClick = (event: MouseEvent, id: string | null): void => {
    setMenuAnchorEl(null);
    if (location.pathname !== '/') {
      return;
    }
    event.preventDefault();
    scrollToSection(id);
    navigate({ pathname: '/', hash: id ? `#${id}` : '' }, { replace: false });
  };

  return (
    <AppBar
      component="header"
      position="sticky"
      color="default"
      elevation={0}
      sx={{
        bgcolor: 'surface.topbarBackground',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Toolbar sx={{ gap: { xs: 0.5, sm: 2 }, px: { xs: 1.5, sm: 3 }, minHeight: 64 }}>
        <Box
          component={RouterLink}
          to="/"
          onClick={(event) => handleAnchorClick(event, null)}
          aria-label={brandAriaLabel}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 0.75, sm: 1 },
            minWidth: 0,
            flexShrink: 1,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <AppIcon decorative size={{ xs: 26, sm: 32 }} sx={{ flexShrink: 0 }} />
          <Typography
            sx={{
              minWidth: 0,
              fontWeight: 600,
              fontSize: { xs: '0.8rem', sm: '1.1rem' },
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: 'text.primary',
            }}
          >
            {brandLabel}
          </Typography>
        </Box>

        <Box
          component="nav"
          aria-label={navAriaLabel}
          sx={{
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
            gap: 0.5,
            flexGrow: 1,
            minWidth: 0,
          }}
        >
          {anchors.map((anchor) => (
            <Button
              key={anchor.id}
              component={RouterLink}
              to={{ pathname: '/', hash: `#${anchor.id}` }}
              onClick={(event) => handleAnchorClick(event, anchor.id)}
              color="inherit"
              sx={navLinkSx}
            >
              {anchor.label}
            </Button>
          ))}
          <Button
            component={RouterLink}
            to={pageLink.path}
            onClick={() => setMenuAnchorEl(null)}
            color="inherit"
            aria-current={isPageLinkActive ? 'page' : undefined}
            sx={isPageLinkActive ? { ...navLinkSx, ...navLinkActiveSx } : navLinkSx}
          >
            {pageLink.label}
          </Button>
        </Box>

        <Box sx={{ flexGrow: { xs: 1, md: 0 } }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.25, sm: 1.5 }, flexShrink: 0 }}>
          <PublicLanguageSwitcher dense />
          <Button
            component={RouterLink}
            to="/login"
            variant="contained"
            size="small"
            sx={{ px: { xs: 1.25, sm: 3 }, whiteSpace: 'nowrap' }}
          >
            {signInLabel}
          </Button>
          <IconButton
            aria-label={menuAriaLabel}
            aria-haspopup="menu"
            aria-expanded={Boolean(menuAnchorEl)}
            onClick={(event) => setMenuAnchorEl(event.currentTarget)}
            size="small"
            sx={{ display: { xs: 'inline-flex', md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
        </Box>

        <Menu
          anchorEl={menuAnchorEl}
          open={Boolean(menuAnchorEl)}
          onClose={() => setMenuAnchorEl(null)}
          slotProps={{ list: { 'aria-label': navAriaLabel } }}
        >
          {anchors.map((anchor) => (
            <MenuItem
              key={anchor.id}
              component={RouterLink}
              to={{ pathname: '/', hash: `#${anchor.id}` }}
              onClick={(event) => handleAnchorClick(event, anchor.id)}
              sx={navMenuItemSx}
            >
              {anchor.label}
            </MenuItem>
          ))}
          <MenuItem
            component={RouterLink}
            to={pageLink.path}
            onClick={() => setMenuAnchorEl(null)}
            aria-current={isPageLinkActive ? 'page' : undefined}
            sx={isPageLinkActive ? { ...navMenuItemSx, ...navMenuItemActiveSx } : navMenuItemSx}
          >
            {pageLink.label}
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
