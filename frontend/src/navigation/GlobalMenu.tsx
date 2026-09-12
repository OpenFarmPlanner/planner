import { Box, Divider, ListItemIcon, Menu, MenuItem } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import LogoutIcon from '@mui/icons-material/Logout';
import { ACTION_MENU_ICON_PROPS, ACTION_MENU_ITEM_ICON_SX, MENU_SECTION_LABEL_SX } from './topbarMenuStyles';
import { LanguageMenuItems } from '../i18n/LanguageSwitcher';
import { DisabledMenuItemTooltip } from '../components/DisabledActionTooltip';
import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';

// Small rounded pill marking a menu entry as new.
const NEW_BADGE_SX: SxProps<Theme> = {
  ml: 1,
  px: 0.75,
  py: 0.125,
  borderRadius: 5,
  bgcolor: 'primary.light',
  color: 'primary.contrastText',
  fontSize: '0.625rem',
  fontWeight: 600,
  lineHeight: 1.6,
  letterSpacing: '0.04em',
};

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
  showFeedbackNewBadge?: boolean;
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
    showFeedbackNewBadge,
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

  const feedbackItem = (key: string) => (
    <MenuItem key={key} onClick={wrap(onOpenFeedback)}>
      <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><ChatBubbleOutlineIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
      {t('globalMenu.feedback')}
      {showFeedbackNewBadge ? (
        <Box component="span" sx={NEW_BADGE_SX}>{t('globalMenu.feedbackNewBadge')}</Box>
      ) : null}
    </MenuItem>
  );

  const pageHelpMenuItem = (key: string): ReactNode => {
    if (!onOpenPageHelp) return null;
    const item = (
      <MenuItem
        key={key}
        onClick={() => { onClose(); onOpenPageHelp(); }}
        disabled={!pageHelpAvailable}
        sx={{ color: 'text.primary' }}
      >
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><HelpOutlineIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
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
      <MenuItem key={key} onClick={wrapAsync(onOpenProjectHistory)} disabled={historyLoading}>
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><HistoryOutlinedIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('commandPalette.commands.openVersionHistory')}
      </MenuItem>
    );
    return historyLoading ? (
      <DisabledMenuItemTooltip key={`${key}-tooltip`} title={t('common:disabledReasons.busy')}>
        {item}
      </DisabledMenuItemTooltip>
    ) : item;
  };

  const mobileMenuItems = [
    ...(notificationItems ? [
      <MenuItem key="mobile-section-notifications" disabled sx={MENU_SECTION_LABEL_SX}>{t('globalMenu.notifications')}</MenuItem>,
      ...notificationItems,
      <Divider key="mobile-divider-notifications" />,
    ] : []),
    <MenuItem key="mobile-section-project" disabled sx={MENU_SECTION_LABEL_SX}>{t('globalMenu.projectActions')}</MenuItem>,
    <MenuItem key="mobile-project-switcher" onClick={wrap(onOpenProjectSwitcher)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><SwapHorizIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('projectSwitcher.ariaLabel')}</MenuItem>,
    <MenuItem key="mobile-project-create" onClick={wrap(onOpenCreateProject)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><AddIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('project.create')}</MenuItem>,
    <MenuItem key="mobile-project-settings" onClick={wrap(onOpenProjectSettings)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><SettingsOutlinedIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('project.settings')}</MenuItem>,
    historyMenuItem('mobile-project-history'),
    <Divider key="mobile-divider-project-app" />,
    <MenuItem key="mobile-section-app" disabled sx={MENU_SECTION_LABEL_SX}>{t('globalMenu.app')}</MenuItem>,
    <MenuItem key="mobile-app-shortcuts" onClick={wrap(onOpenShortcuts)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><KeyboardOutlinedIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('globalMenu.shortcuts')}</MenuItem>,
    pageHelpMenuItem('mobile-app-page-help'),
    <MenuItem key="mobile-app-help" onClick={wrap(onOpenHelp)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><HelpOutlineIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('globalMenu.appHelp')}</MenuItem>,
    feedbackItem('mobile-app-feedback'),
    <MenuItem key="mobile-app-account-settings" onClick={wrap(onOpenAccountSettings)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><SettingsOutlinedIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('accountSettings')}</MenuItem>,
    <Divider key="mobile-divider-app-language" />,
    <MenuItem key="mobile-section-language" disabled sx={MENU_SECTION_LABEL_SX}>{t('language.label')}</MenuItem>,
    <LanguageMenuItems key="mobile-language-items" onSelected={onClose} />,
    <Divider key="mobile-divider-app-account" />,
    <MenuItem key="mobile-section-account" disabled sx={MENU_SECTION_LABEL_SX}>{t('globalMenu.account')}</MenuItem>,
    canLeaveDemoProject ? <MenuItem key="mobile-account-leave-demo" onClick={wrapAsync(onLeaveDemoProject)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><ExitToAppIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('commandPalette.commands.leaveDemo')}</MenuItem> : null,
    !isGuestDemoSession ? <MenuItem key="mobile-account-logout" onClick={wrapAsync(onLogout)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><LogoutIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('commandPalette.commands.logout')} {userLabel}</MenuItem> : null,
  ];
  const desktopMenuItems = [
    <MenuItem key="desktop-project-settings" onClick={wrap(onOpenProjectSettings)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><SettingsOutlinedIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('project.settings')}</MenuItem>,
    historyMenuItem('desktop-history'),
    <Divider key="desktop-divider-project" />,
    <MenuItem key="desktop-account-settings" onClick={wrap(onOpenAccountSettings)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><SettingsOutlinedIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('accountSettings')}</MenuItem>,
    <Divider key="desktop-divider-language" />,
    <MenuItem key="desktop-section-language" disabled sx={MENU_SECTION_LABEL_SX}>{t('language.label')}</MenuItem>,
    <LanguageMenuItems key="desktop-language-items" onSelected={onClose} />,
    <Divider key="desktop-divider-language-end" />,
    <MenuItem key="desktop-shortcuts" onClick={wrap(onOpenShortcuts)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><KeyboardOutlinedIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('globalMenu.shortcuts')}</MenuItem>,
    <MenuItem key="desktop-help" onClick={wrap(onOpenHelp)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><HelpOutlineIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('globalMenu.appHelp')}</MenuItem>,
    feedbackItem('desktop-feedback'),
    canLeaveDemoProject ? <MenuItem key="desktop-leave-demo" onClick={wrapAsync(onLeaveDemoProject)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><ExitToAppIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('commandPalette.commands.leaveDemo')}</MenuItem> : null,
    !isGuestDemoSession ? <MenuItem key="desktop-logout" onClick={wrapAsync(onLogout)}><ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><LogoutIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>{t('commandPalette.commands.logout')} {userLabel}</MenuItem> : null,
  ];
  // `variant="menu"` rather than MUI's default `selectedMenu`: the latter moves
  // the initial focus onto the *selected* item — the active language, which
  // sits far down the list — and focusing it scrolls the menu there, so the
  // dropdown opened showing its bottom instead of its first section.
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
