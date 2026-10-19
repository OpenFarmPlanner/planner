import { Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import LogoutIcon from '@mui/icons-material/Logout';
import { ACTION_MENU_ICON_PROPS, ACTION_MENU_ITEM_ICON_SX, MENU_SECTION_LABEL_SX } from './topbarMenuStyles';
import { DevLanguageMenuItem } from '../i18n/LanguageSwitcher';
import { SHORTCUTS_HELP_HINT } from '../commands/commands';
import { DisabledMenuItemTooltip } from '../components/DisabledActionTooltip';
import type { ReactNode } from 'react';

// Touch-friendly minimum height for every actionable entry (not the section labels).
const ITEM_SX = { minHeight: 44 } as const;

interface GlobalMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  historyLoading: boolean;
  userLabel: string;
  isMobile: boolean;
  onClose: () => void;
  onOpenProjectSwitcher: () => void;
  onOpenCreateProject: () => void;
  onOpenProjectSettings: () => void;
  onOpenProjectHistory: () => Promise<void>;
  onOpenAccountSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenHelp: () => void;
  onOpenFeedback: () => void;
  /**
   * Highlights the feedback entry as new until it has been opened once — the
   * owner persists that per user, so the badge never comes back afterwards.
   */
  /**
   * Page-specific help (the "?" icon content) — only wired up for the mobile
   * layout, where that icon is removed from the topbar in favor of this menu
   * entry. Omit or leave `pageHelpAvailable` false where the current
   * page/view has no page-specific help defined.
   */
  onOpenPageHelp?: () => void;
  pageHelpAvailable?: boolean;
  pageHelpUnavailableReason?: string;
  canLeaveDemoProject: boolean;
  isGuestDemoSession: boolean;
  onLeaveDemoProject: () => Promise<void>;
  onLogout: () => Promise<void>;
  /**
   * Notification entries for the compact layout, where the topbar has no room
   * for a bell. Built by the owner (`useNotificationMenuItems`) rather than
   * here, so this menu keeps needing no router or data-fetching context.
   */
  notificationItems?: ReactNode[];
  t: (key: string) => string;
}

export function GlobalMenu(props: GlobalMenuProps) {
  const {
    anchorEl,
    open,
    historyLoading,
    userLabel,
    isMobile,
    onClose,
    onOpenProjectSwitcher,
    onOpenCreateProject,
    onOpenProjectSettings,
    onOpenProjectHistory,
    onOpenAccountSettings,
    onOpenShortcuts,
    onOpenHelp,
    onOpenFeedback,
    onOpenPageHelp,
    pageHelpAvailable,
    pageHelpUnavailableReason,
    canLeaveDemoProject,
    isGuestDemoSession,
    onLeaveDemoProject,
    onLogout,
    notificationItems,
    t,
  } = props;

  const wrap = (fn: () => void): () => void => () => { onClose(); fn(); };
  const wrapAsync = (fn: () => Promise<void>): () => void => () => { onClose(); void fn(); };

  const icon = (node: ReactNode) => <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}>{node}</ListItemIcon>;

  const feedbackItem = (key: string) => (
    <MenuItem key={key} onClick={wrap(onOpenFeedback)} sx={ITEM_SX}>
      {icon(<ChatBubbleOutlineIcon {...ACTION_MENU_ICON_PROPS} />)}
      {t('globalMenu.feedback')}
    </MenuItem>
  );

  const pageHelpMenuItem = (key: string): ReactNode => {
    if (!onOpenPageHelp) return null;
    const item = (
      <MenuItem
        key={key}
        onClick={() => { onClose(); onOpenPageHelp(); }}
        disabled={!pageHelpAvailable}
        sx={{ ...ITEM_SX, color: 'text.primary' }}
      >
        {icon(<HelpOutlineIcon {...ACTION_MENU_ICON_PROPS} />)}
        {t('globalMenu.pageHelp')}
      </MenuItem>
    );
    // A disabled MenuItem fires no pointer events, so the "why" tooltip needs a
    // wrapper element to hang off — same pattern as CropHeaderActionsMenu's
    // disabled publish item.
    return pageHelpAvailable ? item : (
      <DisabledMenuItemTooltip key={`${key}-tooltip`} title={pageHelpUnavailableReason ?? t('globalMenu.pageHelpUnavailable')}>
        {item}
      </DisabledMenuItemTooltip>
    );
  };

  const historyMenuItem = (key: string) => {
    const item = (
      <MenuItem key={key} onClick={wrapAsync(onOpenProjectHistory)} disabled={historyLoading} sx={ITEM_SX}>
        {icon(<HistoryOutlinedIcon {...ACTION_MENU_ICON_PROPS} />)}
        {t('commandPalette.commands.openVersionHistory')}
      </MenuItem>
    );
    return historyLoading ? (
      <DisabledMenuItemTooltip key={`${key}-tooltip`} title={t('common:disabledReasons.busy')}>
        {item}
      </DisabledMenuItemTooltip>
    ) : item;
  };

  const projectSettingsItem = (key: string) => (
    <MenuItem key={key} onClick={wrap(onOpenProjectSettings)} sx={ITEM_SX}>
      {icon(<SettingsOutlinedIcon {...ACTION_MENU_ICON_PROPS} />)}
      {t('project.settings')}
    </MenuItem>
  );

  const shortcutsItem = (key: string) => (
    <MenuItem key={key} onClick={wrap(onOpenShortcuts)} sx={ITEM_SX}>
      {icon(<KeyboardOutlinedIcon {...ACTION_MENU_ICON_PROPS} />)}
      <ListItemText primary={t('globalMenu.shortcuts')} />
      <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>{SHORTCUTS_HELP_HINT}</Typography>
    </MenuItem>
  );

  const appHelpItem = (key: string) => (
    <MenuItem key={key} onClick={wrap(onOpenHelp)} sx={ITEM_SX}>
      {icon(<HelpOutlineIcon {...ACTION_MENU_ICON_PROPS} />)}
      {t('globalMenu.appHelp')}
    </MenuItem>
  );

  const accountSettingsItem = (key: string) => (
    <MenuItem key={key} onClick={wrap(onOpenAccountSettings)} sx={ITEM_SX}>
      {icon(<ManageAccountsOutlinedIcon {...ACTION_MENU_ICON_PROPS} />)}
      {t('accountSettings')}
    </MenuItem>
  );

  // Development-only: `import.meta.env.DEV` is statically false in every
  // production build (staging included), so the bundler drops this entry.
  const devLanguageItem = (key: string) => (import.meta.env.DEV
    ? <DevLanguageMenuItem key={key} label={t('language.label')} onSelected={onClose} />
    : null);

  const hasSessionItems = canLeaveDemoProject || !isGuestDemoSession;
  const sessionItems = (prefix: string) => (hasSessionItems ? [
    <Divider key={`${prefix}-divider-session`} />,
    canLeaveDemoProject ? (
      <MenuItem key={`${prefix}-leave-demo`} onClick={wrapAsync(onLeaveDemoProject)} sx={ITEM_SX}>
        {icon(<ExitToAppIcon {...ACTION_MENU_ICON_PROPS} />)}
        {t('commandPalette.commands.leaveDemo')}
      </MenuItem>
    ) : null,
    !isGuestDemoSession ? (
      <MenuItem key={`${prefix}-logout`} onClick={wrapAsync(onLogout)} sx={ITEM_SX}>
        {icon(<LogoutIcon {...ACTION_MENU_ICON_PROPS} />)}
        <ListItemText
          primary={t('commandPalette.commands.logout')}
          secondary={userLabel || undefined}
          slotProps={{ secondary: { noWrap: true } }}
        />
      </MenuItem>
    ) : null,
  ] : []);

  const mobileMenuItems = [
    ...(notificationItems ? [
      <MenuItem key="mobile-section-notifications" disabled sx={MENU_SECTION_LABEL_SX}>{t('globalMenu.notifications')}</MenuItem>,
      ...notificationItems,
      <Divider key="mobile-divider-notifications" />,
    ] : []),
    <MenuItem key="mobile-section-project" disabled sx={MENU_SECTION_LABEL_SX}>{t('globalMenu.projectActions')}</MenuItem>,
    <MenuItem key="mobile-project-switcher" onClick={wrap(onOpenProjectSwitcher)} sx={ITEM_SX}>{icon(<SwapHorizIcon {...ACTION_MENU_ICON_PROPS} />)}{t('projectSwitcher.ariaLabel')}</MenuItem>,
    <MenuItem key="mobile-project-create" onClick={wrap(onOpenCreateProject)} sx={ITEM_SX}>{icon(<AddIcon {...ACTION_MENU_ICON_PROPS} />)}{t('project.create')}</MenuItem>,
    projectSettingsItem('mobile-project-settings'),
    historyMenuItem('mobile-project-history'),
    <Divider key="mobile-divider-project-app" />,
    <MenuItem key="mobile-section-app" disabled sx={MENU_SECTION_LABEL_SX}>{t('globalMenu.app')}</MenuItem>,
    shortcutsItem('mobile-app-shortcuts'),
    pageHelpMenuItem('mobile-app-page-help'),
    appHelpItem('mobile-app-help'),
    feedbackItem('mobile-app-feedback'),
    <Divider key="mobile-divider-app-account" />,
    <MenuItem key="mobile-section-account" disabled sx={MENU_SECTION_LABEL_SX}>{t('globalMenu.account')}</MenuItem>,
    accountSettingsItem('mobile-account-settings'),
    devLanguageItem('mobile-account-language'),
    ...sessionItems('mobile-account'),
  ];
  const desktopMenuItems = [
    projectSettingsItem('desktop-project-settings'),
    historyMenuItem('desktop-history'),
    <Divider key="desktop-divider-project" />,
    shortcutsItem('desktop-shortcuts'),
    appHelpItem('desktop-help'),
    feedbackItem('desktop-feedback'),
    <Divider key="desktop-divider-help" />,
    accountSettingsItem('desktop-account-settings'),
    devLanguageItem('desktop-language'),
    ...sessionItems('desktop'),
  ];
  // `variant="menu"` rather than MUI's default `selectedMenu`, so the initial
  // focus always lands on the first entry rather than a selected one further
  // down the list (which would scroll the dropdown away from its top).
  return (
    <Menu
      id="global-actions-menu"
      variant="menu"
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
    >
      {isMobile ? mobileMenuItems : desktopMenuItems}
    </Menu>
  );
}
