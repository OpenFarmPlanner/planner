import { Box, Link, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from '../../i18n';
import {
  SETTINGS_CONTENT_MAX_WIDTH,
  SETTINGS_SIDE_NAV_WIDTH,
  settingsNavLinkBaseSx,
} from './settingsStyles';
import { useActiveSettingsSection } from './useActiveSettingsSection';

export interface SettingsLayoutSection {
  id: string;
  label: string;
  tone?: 'danger';
}

export type SettingsNavPlacement = 'side' | 'top';

interface SettingsLayoutProps {
  sections: readonly SettingsLayoutSection[];
  navPlacement: SettingsNavPlacement;
  children: ReactNode;
}

const linkStateSx = (isActive: boolean, isDanger: boolean) => ({
  ...settingsNavLinkBaseSx,
  color: isDanger ? 'error.main' : isActive ? 'navigation.activeText' : 'text.primary',
  fontWeight: isActive ? 600 : 500,
});

const accentColor = (isActive: boolean, isDanger: boolean): string => {
  if (!isActive) return 'transparent';
  return isDanger ? 'error.main' : 'primary.main';
};

const sideLinkSx = (isActive: boolean, isDanger: boolean) => ({
  ...linkStateSx(isActive, isDanger),
  px: 1.5,
  borderRadius: 1,
  borderLeft: 3,
  borderLeftColor: accentColor(isActive, isDanger),
  bgcolor: isActive ? 'navigation.activeBackground' : undefined,
});

const topLinkSx = (isActive: boolean, isDanger: boolean) => ({
  ...linkStateSx(isActive, isDanger),
  px: 2,
  borderBottom: 2,
  borderBottomColor: accentColor(isActive, isDanger),
});

/**
 * Shared shell of the account and project settings pages: an in-page section
 * navigation of real anchor links plus the section cards.
 *
 * `side` puts the navigation in a column left of the content; `top` renders it
 * as a tab bar above. Below `md` both become a horizontally scrolling tab bar,
 * because a side column would leave the cards too narrow on a phone. The
 * navigation is deliberately not sticky: it must not eat the short viewport of
 * a phone in landscape.
 */
export function SettingsLayout({ sections, navPlacement, children }: SettingsLayoutProps) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const placement: SettingsNavPlacement = isMdUp ? navPlacement : 'top';
  const { hash } = useLocation();
  const [activeId, setActiveId] = useActiveSettingsSection(sections.map((section) => section.id));

  useEffect(() => {
    const targetId = decodeURIComponent(hash.replace(/^#/, ''));
    if (!targetId || !sections.some((section) => section.id === targetId)) {
      return;
    }
    setActiveId(targetId);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView?.({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
    // Only a hash change (deep link or anchor click) should scroll; a new
    // `sections` array identity on re-render must not yank the page back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  const isSide = placement === 'side';

  const nav = (
    <Box
      component="nav"
      aria-label={t('settingsNavigation.label')}
      data-placement={placement}
      sx={isSide
        ? { width: SETTINGS_SIDE_NAV_WIDTH, flexShrink: 0 }
        : {
          width: '100%',
          mb: 3,
          borderBottom: 1,
          borderColor: 'divider',
          overflowX: 'auto',
          overscrollBehaviorX: 'contain',
          scrollbarWidth: 'thin',
        }}
    >
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'flex',
          flexDirection: isSide ? 'column' : 'row',
          gap: isSide ? 0.5 : 0,
          width: isSide ? undefined : 'max-content',
        }}
      >
        {sections.map((section) => {
          const isActive = section.id === activeId;
          const isDanger = section.tone === 'danger';
          return (
            <li key={section.id}>
              <Link
                href={`#${section.id}`}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => setActiveId(section.id)}
                sx={isSide ? sideLinkSx(isActive, isDanger) : topLinkSx(isActive, isDanger)}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </Box>
    </Box>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isSide ? 'row' : 'column',
        alignItems: 'flex-start',
        gap: isSide ? 4 : 0,
        width: '100%',
        minWidth: 0,
      }}
    >
      {nav}
      <Box sx={{ flex: 1, minWidth: 0, width: '100%', maxWidth: SETTINGS_CONTENT_MAX_WIDTH, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {children}
      </Box>
    </Box>
  );
}
