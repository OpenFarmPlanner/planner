import { useState } from 'react';
import type { MouseEvent } from 'react';
import { AppBar, Box, Button, IconButton, Menu, MenuItem, Toolbar, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import AppIcon from './AppIcon';
import { PublicLanguageSwitcher } from '../../i18n/LanguageSwitcher';

export interface PublicTopbarAnchor {
  id: string;
  label: string;
}

interface PublicTopbarProps {
  brandLabel: string;
  brandAriaLabel: string;
  anchors: PublicTopbarAnchor[];
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
 * Sticky header for the public marketing pages. Anchor links navigate within
 * the current page when already on `/` (smooth scroll + hash update) and
 * fall back to a normal `/#id` navigation otherwise, so they also work as
 * deep links from a future page such as an "About" page.
 */
export default function PublicTopbar({
  brandLabel,
  brandAriaLabel,
  anchors,
  menuAriaLabel,
  navAriaLabel,
  signInLabel,
}: PublicTopbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);

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
            gap: 1,
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
              sx={{ textTransform: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}
            >
              {anchor.label}
            </Button>
          ))}
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
              sx={{ minHeight: 44 }}
            >
              {anchor.label}
            </MenuItem>
          ))}
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
