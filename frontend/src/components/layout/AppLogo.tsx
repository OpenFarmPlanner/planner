import { Box } from '@mui/material';
import { NavLink, useLocation } from 'react-router';
import { normalizeMainRoutePath } from '../../navigation/mainNavigation';
import { useTranslation } from '../../i18n';
import AppIcon from './AppIcon';

interface AppLogoProps {
  to?: string;
  size?: number;
  showText?: boolean;
}

export default function AppLogo({ to = '/app/dashboard', size = 28, showText = true }: AppLogoProps) {
  const { t } = useTranslation(['navigation', 'common']);
  const location = useLocation();
  const isActive = normalizeMainRoutePath(location.pathname) === '/app/dashboard';

  return (
    <Box
      component={NavLink}
      to={to}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        textDecoration: 'none',
        color: 'inherit',
        minWidth: 0,
        px: 0.75,
        py: 0.35,
        borderRadius: 1,
        border: '1px solid transparent',
        backgroundColor: isActive ? 'navigation.activeBackground' : 'transparent',
        boxShadow: 'none',
        transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
        '&:hover': {
          backgroundColor: isActive ? 'navigation.activeHoverBackground' : 'navigation.hoverBackground',
          borderColor: isActive ? 'navigation.activeHoverBorder' : 'navigation.hoverBorder',
        },
        '&:focus-visible': {
          outline: 'none',
          borderColor: 'navigation.activeHoverBorder',
          boxShadow: (theme) => `0 0 0 2px ${theme.palette.navigation.focusRing}`,
        },
      }}
      aria-label={t('globalMenu.dashboardLink')}
      title={t('globalMenu.dashboardLink')}
    >
      <AppIcon size={size} sx={{ borderRadius: 0.5 }} />
      {showText ? (
        <Box component="span" sx={{ fontWeight: 600, fontSize: 16, whiteSpace: 'nowrap', color: isActive ? 'navigation.activeText' : 'navigation.inactiveText' }}>
          {t('common:appName')}
        </Box>
      ) : null}
    </Box>
  );
}
