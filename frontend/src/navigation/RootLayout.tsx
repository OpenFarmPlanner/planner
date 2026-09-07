/**
 * Root layout component with the persistent navigation shell.
 *
 * Renders the sidebar/drawer navigation, the topbar with page-published
 * context actions, project switching, global menus, and the global
 * snackbar/help/history dialogs. Extracted verbatim from App.tsx.
 */

import { Navigate, Outlet, Link as RouterLink, useLocation, useNavigate } from 'react-router';
import {
  AppBar,
  Badge,
  Button,
  ButtonGroup,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Drawer,
  Toolbar,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Box,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from '../i18n';
import { useCommandContext, useRegisterCommands } from '../commands/useCommandContext';
import { createRootCommands } from '../commands/commands';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import MenuIcon from '@mui/icons-material/Menu';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import GavelIcon from '@mui/icons-material/Gavel';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import AddIcon from '@mui/icons-material/Add';
import { ProjectMenu } from './ProjectMenu';
import { GlobalMenu } from './GlobalMenu';
import { hasSeenFeedbackBadge, markFeedbackBadgeSeen } from './feedbackBadgeStorage';
import { FeedbackDialog } from '../components/feedback/FeedbackDialog';
import { NotificationBell } from '../notifications/NotificationBell';
import { useNotifications } from '../notifications/useNotifications';
import { NOTIFICATION_HISTORY_ROUTE } from '../notifications/notificationDisplay';
import { useNotificationMenuItems } from '../notifications/useNotificationMenuItems';
import { cropAPI, projectAPI } from '../api/api';
import type { CropHistoryEntry } from '../api/types';
import { MobileProjectSwitcherDialog } from './MobileProjectSwitcherDialog';
import { RestoreVersionDialog } from './RestoreVersionDialog';
import { ProjectHistoryDialog } from './ProjectHistoryDialog';
import { CreateProjectDialog } from './CreateProjectDialog';
import { useAuth } from '../auth/useAuth';
import type { RootLayoutOutletContext, TopbarContextAction } from '../navigation/topbarTypes';
import AppLogo from '../components/layout/AppLogo';
import { AlertSnackbar } from '../components/feedback/AlertSnackbar';
import { HelpDialog } from '../components/help/HelpDialog';
import PageHelp from '../components/help/PageHelp';
import {
  getSegmentedActionButtonSx,
  getStandardActionButtonSx,
  segmentedButtonGroupSx,
} from '../components/buttons/segmentedControlStyles';
import { getHistoryEntryTitle } from '../pages/cropsHistoryUtils';
import { GLOBAL_SNACKBAR_EVENT, type GlobalSnackbarDetail } from '../utils/globalSnackbar';
import { createDemoProjectAndSwitch } from '../projects/demoProjectFlow';
import { OPEN_CREATE_PROJECT_EVENT } from '../projects/projectCreationFlow';
import { useGlobalOverlayKeyboardScroll } from '../hooks/useDialogKeyboardScroll';
import { useFocusRegion } from '../focus/useFocusManager';
import { useTopbarActionsRouteReset } from '../hooks/useTopbarActionsRouteReset';
import { appRouteUrl } from '../utils/appRouteUrl';
import { KEYBOARD_NAV_ROUTES, MAIN_NAV_ITEMS, getKeyboardNavigationRouteFromPathname, isProjectIndependentRoute, normalizeMainRoutePath, shouldDisableNavItem } from '../navigation/mainNavigation';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import NavListItem from '../navigation/NavListItem';
import {
  getMobileNavigationIconSx,
  getMobileNavigationItemSx,
  getNavigationIconSx,
  getNavigationItemSx,
  getNavigationShellSx,
  getNavigationTextProps,
  getNavigationToggleButtonSx,
  getMobileNavigationTextProps,
  mobileNavigationDrawerPaperSx,
  navigationLogoLinkSx,
  navigationLogoTextSx,
  navigationTooltipSx,
} from '../navigation/navigationStyles';
import { getNavItemEmoji, CROP_LIBRARY_EMOJI } from '../navigation/navigationIconEmoji';
import { NavEmojiIcon } from '../navigation/NavEmojiIcon';
import ImportExportIcon from '@mui/icons-material/ImportExport';
import { useActiveSeason } from '../seasons/useActiveSeason';
import { SeasonCreateSuggestionDialog, SeasonSwitcher } from '../seasons/SeasonSwitcher';
import { SeasonSetupDialog } from '../seasons/SeasonSetupDialog';
import { useSeasonSetupPrompt } from '../seasons/useSeasonSetupPrompt';
import { PanelLeft } from 'lucide-react';
import AppIcon from '../components/layout/AppIcon';
import { AppTooltip } from '../components/AppTooltip';
import { TOPBAR_BADGE_SX } from './topbarMenuStyles';

const HIERARCHY_CREATE_LOCATION_ACTION_ID = 'fields-global-add-location';
const TOPBAR_ACTION_GROUP_GAP = 1.25;
// Spacing knobs for the topbar's trailing items. TOPBAR_TRAILING_CONTROL_GAP
// controls all three neighbour gaps: season -> project -> bell -> "Mehr".
// The visible distance is the flex gap plus the controls' own horizontal padding.
const TOPBAR_TRAILING_CONTROL_GAP = 0.5;
const TOPBAR_STATUS_BUTTON_PX = 1;
const TOPBAR_STATUS_CLUSTER_GAP = TOPBAR_TRAILING_CONTROL_GAP;
const TOPBAR_OVERFLOW_MENU_GAP = TOPBAR_TRAILING_CONTROL_GAP;
const COMPACT_TOPBAR_TOGGLE_SIZE = 44;

interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error' | 'info';
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

function getCompactTopbarActionIcon(actionId: string): React.ReactNode {
  switch (actionId) {
    case 'fields-view-mode-list':
      return <ViewListOutlinedIcon fontSize="small" />;
    case 'fields-view-mode-graphical':
      return <MapOutlinedIcon fontSize="small" />;
    case 'calendar-view-mode-occupancy':
      return <EventNoteOutlinedIcon fontSize="small" />;
    case 'calendar-view-mode-seedlings':
      return <LocalFloristOutlinedIcon fontSize="small" />;
    default:
      return null;
  }
}


/**
 * Root layout component with navigation.
 * Wraps all routes with the persistent navigation bar.
 */
function RootLayout() {
  const { t, i18n } = useTranslation('navigation');
  const { t: tNotifications } = useTranslation('notifications');
  useGlobalOverlayKeyboardScroll();
  const tCrops = useMemo(
    () => i18n.getFixedT(i18n.resolvedLanguage ?? i18n.language ?? 'de', 'crops'),
    [i18n],
  );
  const tCommon = useMemo(
    () => i18n.getFixedT(i18n.resolvedLanguage ?? i18n.language ?? 'de', 'common'),
    [i18n],
  );
  const navigate = useNavigate();
  const location = useLocation();
  // The route the keyboard navigation and the command palette consider
  // "current". Derived from the location rather than kept in a ref: the ref
  // version made the value unreadable during render and, because its reader
  // was a `useCallback([])`, left the command palette's `currentPath` frozen
  // at whatever route the shell first mounted on.
  const currentKeyboardRoute = useMemo(
    () => getKeyboardNavigationRouteFromPathname(location.pathname) ?? normalizeMainRoutePath(location.pathname),
    [location.pathname],
  );
  const expandSidebarBtnRef = React.useRef<HTMLButtonElement>(null);
  const collapseSidebarBtnRef = React.useRef<HTMLButtonElement>(null);
  // The three primary F6-reachable focus regions of the app shell — see
  // docs/keyboard-architecture.md. Individual pages register further, more
  // specific regions (e.g. a chart or table) nested inside 'main-content'.
  const sidebarRegionRef = React.useRef<HTMLElement | null>(null);
  const topbarRegionRef = React.useRef<HTMLElement | null>(null);
  const mainContentRegionRef = React.useRef<HTMLElement | null>(null);
  useFocusRegion('sidebar', sidebarRegionRef, { label: 'Sidebar', order: 0 });
  useFocusRegion('topbar', topbarRegionRef, { label: 'Topbar', order: 1 });
  useFocusRegion('main-content', mainContentRegionRef, { label: 'Hauptinhalt', order: 2 });
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isDesktopUp = useMediaQuery(theme.breakpoints.up('md'));
  const isLargeDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const isCoarseLowHeightViewport = useMediaQuery('(pointer: coarse) and (max-height: 500px)');
  const isLowHeightNarrowViewport = useMediaQuery('(max-width: 900px) and (max-height: 500px)');
  const isCompactTopbar = isPhone || isCoarseLowHeightViewport;
  const isVeryNarrowMobile = useMediaQuery('(max-width:360px)');
  const isPhonePortrait = useMediaQuery(`${theme.breakpoints.down('sm')} and (orientation: portrait)`);
  const { user, endGuestDemo, logout, activeProjectId, switchActiveProject } = useAuth();
  const fallbackHistoryActorLabel = user?.display_label || user?.display_name || user?.email || undefined;
  const { activeCreateActions, openPalette, runPrimaryCreateAction, openShortcutsHelp } = useCommandContext();
  // One controller for both entry points — the full topbar's bell and, on
  // compact widths, the "Mehr" menu — so the list is fetched once.
  const notifications = useNotifications(true);
  const activeSeason = useActiveSeason();
  const [seasonSuggestionDialogOpen, setSeasonSuggestionDialogOpen] = useState(false);
  const requestSeasonCreation = useCallback(() => {
    setSeasonSuggestionDialogOpen(true);
  }, []);
  const activeSeasonYear = useMemo(
    () => (activeSeason.activeSeason ? new Date(activeSeason.activeSeason.start_date).getFullYear() : null),
    [activeSeason.activeSeason],
  );
  const seasonSetupPrompt = useSeasonSetupPrompt(activeProjectId, location.pathname);
  const [globalMenuAnchor, setGlobalMenuAnchor] = useState<null | HTMLElement>(null);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [feedbackBadgeDismissed, setFeedbackBadgeDismissed] = useState(false);
  const [projectMenuAnchor, setProjectMenuAnchor] = useState<null | HTMLElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileProjectSwitcherOpen, setMobileProjectSwitcherOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(!isLargeDesktop);
  const [isSwitchingProject, setIsSwitchingProject] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isCreatingDemoProject, setIsCreatingDemoProject] = useState(false);
  const [deletedProjectsCount, setDeletedProjectsCount] = useState(0);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [topbarContextActions, setTopbarContextActions] = useState<TopbarContextAction[]>([]);
  const [topbarTitleActions, setTopbarTitleActions] = useState<TopbarContextAction[]>([]);
  const [cropActionsMenuAnchor, setCropActionsMenuAnchor] = useState<null | HTMLElement>(null);
  const [mobileActionsOverflowAnchor, setMobileActionsOverflowAnchor] = useState<null | HTMLElement>(null);
  const [topbarPrimaryActionMenuAnchor, setTopbarPrimaryActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [publicLibraryModerationMenuAnchor, setPublicLibraryModerationMenuAnchor] = useState<null | HTMLElement>(null);
  useTopbarActionsRouteReset(location.pathname, setTopbarContextActions, setTopbarTitleActions);

  const { hasActiveProject } = useProjectRequirement();

  const navItems = useMemo(() => ([
    // Dashboard stays reachable even without a project: it is the "home" nav
    // entry and already shows the same project-required empty state/CTA as
    // other pages, so disabling it would be a dead end rather than a guide.
    { to: '/app/dashboard', label: t('dashboard'), activeAliases: [], keywords: ['übersicht', 'dashboard'], icon: <NavEmojiIcon emoji={getNavItemEmoji('/app/dashboard')} />, requiresProject: false },
    ...MAIN_NAV_ITEMS.map((item) => ({
      to: item.to,
      label: t(item.labelKey),
      activeAliases: item.activeAliases ?? [],
      keywords: item.keywords,
      requiresProject: item.requiresProject,
      icon: <NavEmojiIcon emoji={getNavItemEmoji(item.to)} />,
    })),
  ]), [t]);

  const handleGlobalMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setGlobalMenuAnchor(event.currentTarget);
  };

  // Stable identity so useNotificationMenuItems (which takes this as a dep)
  // can actually memoize instead of rebuilding its menu-item array whenever
  // RootLayout re-renders for an unrelated reason.
  const handleGlobalMenuClose = useCallback(() => {
    setGlobalMenuAnchor(null);
  }, []);
  // Built here rather than inside GlobalMenu so that menu keeps needing no
  // router context — see its `notificationItems` prop.
  const notificationMenuItems = useNotificationMenuItems(notifications, handleGlobalMenuClose);
  const handleOpenMobileProjectSwitcher = (): void => {
    handleGlobalMenuClose();
    setMobileProjectSwitcherOpen(true);
  };
  const handleCloseMobileProjectSwitcher = (): void => {
    setMobileProjectSwitcherOpen(false);
  };

  const handleProjectMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setProjectMenuAnchor(event.currentTarget);
    void refreshDeletedProjectsCount();
  };

  const handleProjectMenuClose = useCallback(() => {
    setProjectMenuAnchor(null);
  }, []);
  const closeMobileNav = () => {
    setMobileNavOpen(false);
  };
  useEffect(() => {
    const storedValue = window.localStorage.getItem('openfarmplanner.sidebarCollapsed');
    if (storedValue !== null) {
      setSidebarCollapsed(storedValue === 'true');
    }
  }, []);

  const toggleSidebarCollapsed = useCallback((): void => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('openfarmplanner.sidebarCollapsed', String(next));
      // Transfer focus to the counterpart button so keyboard users don't lose their position
      requestAnimationFrame(() => {
        if (next) {
          expandSidebarBtnRef.current?.focus();
        } else {
          collapseSidebarBtnRef.current?.focus();
        }
      });
      return next;
    });
  }, []);

  const handleCollapsedSidebarBackgroundClick = (event: React.MouseEvent<HTMLElement>): void => {
    if (!sidebarCollapsed) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest('a, button, input, textarea, select, [role="button"], [role="link"], [tabindex]')) {
      return;
    }
    setSidebarCollapsed(false);
    window.localStorage.setItem('openfarmplanner.sidebarCollapsed', 'false');
  };

  const [projectHistoryOpen, setProjectHistoryOpen] = useState(false);
  const [globalHelpOpen, setGlobalHelpOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<CropHistoryEntry[]>([]);
  const [pendingRestoreEntry, setPendingRestoreEntry] = useState<CropHistoryEntry | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: '',
    severity: 'success',
  });
  const showSnackbar = useCallback((message: string, severity: 'success' | 'error' | 'info', actionLabel?: string, onAction?: () => void | Promise<void>) => {
    setSnackbar({ open: true, message, severity, actionLabel, onAction });
    // `setSnackbar` is listed because the compiler infers it as a dependency.
    // useState setters are stable, so this does not change the callback identity.
  }, [setSnackbar]);

  useEffect(() => {
    const handleGlobalSnackbar = (event: Event): void => {
      const detail = (event as CustomEvent<GlobalSnackbarDetail>).detail;
      if (!detail?.message) {
        return;
      }
      showSnackbar(detail.message, detail.severity ?? 'success', detail.actionLabel, detail.onAction);
    };

    window.addEventListener(GLOBAL_SNACKBAR_EVENT, handleGlobalSnackbar);
    return () => window.removeEventListener(GLOBAL_SNACKBAR_EVENT, handleGlobalSnackbar);
  }, [showSnackbar]);

  const handleOpenProjectHistory = useCallback(async () => {
    handleGlobalMenuClose();
    setHistoryLoading(true);
    try {
      const response = await cropAPI.projectHistory();
      setHistoryItems(response.data);
      setProjectHistoryOpen(true);
    } catch (error) {
      console.error('Error loading project history:', error);
      showSnackbar(t('commandPalette.feedback.versionHistoryLoadError'), 'error');
    } finally {
      setHistoryLoading(false);
    }
  }, [showSnackbar, t]);

  const handleRestoreProjectVersion = async (historyId: number) => {
    try {
      await cropAPI.projectRestore(historyId);
      showSnackbar('Version wiederhergestellt. Die vorherige Version wurde automatisch gespeichert.', 'success');
      setProjectHistoryOpen(false);
      setPendingRestoreEntry(null);
      window.location.reload();
    } catch (error) {
      console.error('Error restoring project version:', error);
      setPendingRestoreEntry(null);
      showSnackbar(t('commandPalette.feedback.versionRestoreError'), 'error');
    }
  };

  const handleRevertBatch = async (batchId: number) => {
    try {
      await cropAPI.revertBatch(batchId);
      showSnackbar('Version wiederhergestellt.', 'success');
      setProjectHistoryOpen(false);
      setPendingRestoreEntry(null);
      window.location.reload();
    } catch (error) {
      console.error('Error reverting batch operation:', error);
      setPendingRestoreEntry(null);
      showSnackbar(t('commandPalette.feedback.versionRestoreError'), 'error');
    }
  };

  const formatHistoryTimestamp = (value: string): string => new Date(value).toLocaleString('de-DE');

  const handleOpenShortcuts = () => {
    handleGlobalMenuClose();
    openShortcutsHelp();
  };

  const openCurrentPageHelp = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('ofp:open-page-help'));
  }, []);
  const openGlobalHelp = (): void => {
    setGlobalHelpOpen(true);
  };
  // The badge is a one-time marker: opening the dialog once hides it for good
  // for this account, independent of any time window.
  const feedbackBadgeSeen = useMemo(
    () => feedbackBadgeDismissed || hasSeenFeedbackBadge(user?.id ?? null),
    [feedbackBadgeDismissed, user?.id],
  );
  const openFeedbackDialog = (): void => {
    markFeedbackBadgeSeen(user?.id ?? null);
    setFeedbackBadgeDismissed(true);
    setFeedbackDialogOpen(true);
  };
  const closeGlobalHelp = (): void => {
    setGlobalHelpOpen(false);
  };

  const memberships = useMemo(() => user?.memberships ?? [], [user?.memberships]);
  const activeMembership = memberships.find((membership) => membership.project_id === activeProjectId) ?? null;
  const isGuestDemoSession = Boolean(user?.is_guest_demo);
  const canLeaveDemoProject = isGuestDemoSession;
  const activeProjectLabel = activeMembership?.project_name ?? t('projectSwitcher.noProject');

  const handleLeaveDemoProject = useCallback(async (): Promise<void> => {
    try {
      handleGlobalMenuClose();
      navigate('/', { replace: true });
      await endGuestDemo();
    } catch (error) {
      console.error('Error leaving demo project:', error);
      showSnackbar(t('commandPalette.feedback.leaveDemoError'), 'error');
    }
  }, [endGuestDemo, handleGlobalMenuClose, navigate, showSnackbar, t]);

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await logout();
      handleGlobalMenuClose();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Error logging out:', error);
      showSnackbar(t('commandPalette.feedback.logoutError'), 'error');
    }
  }, [handleGlobalMenuClose, logout, navigate, showSnackbar, t]);

  const refreshDeletedProjectsCount = useCallback(async (): Promise<void> => {
    if (!user) {
      setDeletedProjectsCount(0);
      return;
    }
    try {
      const response = await projectAPI.listDeleted();
      const payload = response.data;
      const deletedProjects = Array.isArray(payload) ? payload : payload.results;
      setDeletedProjectsCount(deletedProjects.length);
    } catch {
      setDeletedProjectsCount(0);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void refreshDeletedProjectsCount();
  }, [refreshDeletedProjectsCount, user]);

  useEffect(() => {
    const handleProjectTrashChanged = (): void => {
      void refreshDeletedProjectsCount();
    };
    window.addEventListener('ofp:project-trash-changed', handleProjectTrashChanged);
    return () => window.removeEventListener('ofp:project-trash-changed', handleProjectTrashChanged);
  }, [refreshDeletedProjectsCount]);

  // Users with zero projects can only use project-independent pages (see
  // PROJECT_INDEPENDENT_APP_ROUTES) — everything else is project-scoped and
  // redirects to project-selection. This is a render-time guard (mirroring
  // ProtectedRoute's auth guard below), not a useEffect: an effect-based
  // `navigate()` runs after the target page has already committed and
  // painted once, which both flashes the wrong content and, if the target
  // itself changes location.pathname, can immediately re-trigger the effect.
  const requiresProjectSelectionRedirect = Boolean(user)
    && memberships.length === 0
    && !isProjectIndependentRoute(location.pathname);

  const handleOpenCreateProject = useCallback((): void => {
    setProjectMenuAnchor(null);
    setNewProjectName('');
    setIsCreateProjectOpen(true);
  }, []);

  useEffect(() => {
    const handleCreateProjectRequest = (): void => {
      handleOpenCreateProject();
    };
    window.addEventListener(OPEN_CREATE_PROJECT_EVENT, handleCreateProjectRequest);
    return () => window.removeEventListener(OPEN_CREATE_PROJECT_EVENT, handleCreateProjectRequest);
  }, [handleOpenCreateProject]);

  const handleOpenProjectSettings = useCallback((): void => {
    handleProjectMenuClose();
    navigate('/app/project-settings');
  }, [handleProjectMenuClose, navigate]);

  const handleOpenProjectSelectionPage = useCallback((): void => {
    handleProjectMenuClose();
    navigate('/app/project-selection');
  }, [handleProjectMenuClose, navigate]);

  const handleOpenProjectTrash = useCallback((): void => {
    handleProjectMenuClose();
    navigate('/app/project-selection?trash=1');
  }, [handleProjectMenuClose, navigate]);

  const applyProjectContextChange = useCallback(async (projectId: number): Promise<void> => {
    await switchActiveProject(projectId);
    const currentPath = `${location.pathname}${location.search}${location.hash}`;
    const targetUrl = appRouteUrl(currentPath);
    if (targetUrl === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.location.reload();
    } else {
      window.location.href = targetUrl;
    }
  }, [switchActiveProject, location.pathname, location.search, location.hash]);

  const closeCreateProjectDialog = (): void => {
    setIsCreateProjectOpen(false);
    setNewProjectName('');
  };

  const navigateFromGlobalMenu = (path: string): void => {
    handleGlobalMenuClose();
    navigate(path);
  };
  const handleCropActionsMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setCropActionsMenuAnchor(event.currentTarget);
  };

  const handleCropActionsMenuClose = () => {
    setCropActionsMenuAnchor(null);
  };
  const handleMobileActionsOverflowOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMobileActionsOverflowAnchor(event.currentTarget);
  };
  const handleMobileActionsOverflowClose = () => {
    setMobileActionsOverflowAnchor(null);
  };
  const isCropsPage = location.pathname.startsWith('/app/crops');
  const isFieldsBedsPage = location.pathname.startsWith('/app/fields-beds');
  const isCalendarPage = location.pathname.startsWith('/app/gantt-chart');
  const isPublicCropLibraryPage = location.pathname.startsWith('/app/crop-library');
  const cropLibraryAction = useMemo(
    () => topbarContextActions.find((action) => action.id === 'crops-open-library'),
    [topbarContextActions],
  );
  const publicLibraryModerationAction = useMemo(
    () => topbarContextActions.find((action) => action.id === 'public-crop-library-moderation'),
    [topbarContextActions],
  );
  const cropImportExportActions = useMemo(
    () => topbarContextActions.filter((action) => action.id !== 'crops-open-library'),
    [topbarContextActions],
  );
  // The fields-beds topbar has exactly one non-hidden "add" action at a
  // time: 'fields-global-add-field' (single-location mode) or
  // HIERARCHY_CREATE_LOCATION_ACTION_ID (multi-/zero-location mode). Each
  // carries the other level as a `menuActions` entry, restoring the split
  // button (main action + dropdown for the other level).
  const fieldsGlobalAddAction = useMemo(
    () => topbarContextActions.find((action) => (
      (action.id === 'fields-global-add-field' || action.id === HIERARCHY_CREATE_LOCATION_ACTION_ID)
      && !action.hidden
    )) ?? null,
    [topbarContextActions],
  );
  const isFieldsBedsGraphicalViewActive = useMemo(
    () => topbarTitleActions.some((action) => action.id === 'fields-view-mode-graphical' && action.active),
    [topbarTitleActions],
  );
  const genericTopbarContextActions = useMemo(
    () => (isCropsPage
      ? []
      : topbarContextActions.filter((action) => (
        action.id !== 'fields-global-add-field'
        // Already rendered via fieldsGlobalAddAction/mobileFieldsAddLocationAction
        // above — without this exclusion it also flows into topbarModeControls/
        // topbarOverflowActions and renders a second (or, on very narrow mobile,
        // third) "Standort hinzufügen" button.
        && action.id !== HIERARCHY_CREATE_LOCATION_ACTION_ID
        && action.id !== 'public-crop-library-moderation'
        && action.id !== 'public-crop-library-remove'
      ))),
    [isCropsPage, topbarContextActions],
  );
  const topbarModeControls = useMemo(
    () => genericTopbarContextActions.filter((action) => (
      action.groupId?.includes('mode')
      || action.id.includes('view-mode')
      || action.id.includes('interaction-mode')
      || action.id.includes('calendar-mode')
    )),
    [genericTopbarContextActions],
  );
  const topbarOverflowActions = useMemo(
    () => genericTopbarContextActions.filter((action) => !topbarModeControls.some((modeAction) => modeAction.id === action.id)),
    [genericTopbarContextActions, topbarModeControls],
  );
  const showCropImportExportButton = isCropsPage;
  const mobileTopbarViewActions = useMemo(
    () => topbarModeControls.filter((action) => !action.hidden),
    [topbarModeControls],
  );
  // Whether the current "add" action is the hierarchy (multi-/zero-location)
  // one — used only to gate showMobileTopbarViewActions below; the button
  // itself is already rendered via fieldsGlobalAddAction, and
  // HIERARCHY_CREATE_LOCATION_ACTION_ID is deliberately excluded from
  // genericTopbarContextActions (above) so it never renders a second time.
  const mobileFieldsAddLocationAction = useMemo(
    () => (fieldsGlobalAddAction?.id === HIERARCHY_CREATE_LOCATION_ACTION_ID && !fieldsGlobalAddAction.hidden
      ? fieldsGlobalAddAction
      : null),
    [fieldsGlobalAddAction],
  );
  const activeMobileTopbarViewActionId = mobileTopbarViewActions.find((action) => action.active)?.id ?? null;
  const showMobileTopbarViewActions = isCompactTopbar
    && (isFieldsBedsPage || isCalendarPage)
    && (mobileTopbarViewActions.length > 0 || (isFieldsBedsPage && Boolean(mobileFieldsAddLocationAction)));
  const hasVisibleMobileContextActions = useMemo(
    () => [...topbarModeControls, ...topbarOverflowActions].some((action) => !action.hidden),
    [topbarModeControls, topbarOverflowActions],
  );
  const hasMobileSecondaryRow = useMemo(
    () => (
      !isFieldsBedsPage
      && !isCalendarPage
      && !isCropsPage
      && !isPublicCropLibraryPage
      && (
        hasVisibleMobileContextActions
      )
    ),
    [hasVisibleMobileContextActions, isCalendarPage, isCropsPage, isFieldsBedsPage, isPublicCropLibraryPage],
  );
  const handleCreateProject = async (): Promise<void> => {
    if (!newProjectName.trim()) {
      return;
    }
    setIsCreatingProject(true);
    try {
      const response = await projectAPI.create({
        name: newProjectName.trim(),
        description: '',
      });
      closeCreateProjectDialog();
      navigate('/app/dashboard');
      await applyProjectContextChange(response.data.id);
    } catch (error) {
      console.error('Error creating project:', error);
      showSnackbar(t('projectSwitcher.createError'), 'error');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleCreateProjectSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!newProjectName.trim() || isCreatingProject) {
      return;
    }
    void handleCreateProject();
  };

  const handleCreateDemoProject = useCallback(async (): Promise<void> => {
    if (isCreatingDemoProject) {
      return;
    }
    handleProjectMenuClose();
    setIsCreatingDemoProject(true);
    try {
      await createDemoProjectAndSwitch(switchActiveProject);
      showSnackbar(tCommon('projectOnboarding.demoCreatedHint'), 'success');
      navigate('/app/fields-beds', { replace: true });
    } catch (error) {
      console.error('Error creating demo project:', error);
      showSnackbar(tCommon('projectOnboarding.demoCreateError'), 'error');
    } finally {
      setIsCreatingDemoProject(false);
    }
  }, [handleProjectMenuClose, isCreatingDemoProject, navigate, showSnackbar, switchActiveProject, tCommon]);

  const handleSwitchProject = useCallback(async (projectId: number): Promise<void> => {
    setMobileProjectSwitcherOpen(false);
    handleProjectMenuClose();
    if (projectId === activeProjectId) {
      return;
    }
    setIsSwitchingProject(true);
    try {
      await applyProjectContextChange(projectId);
    } catch (error) {
      console.error('Error switching project:', error);
      showSnackbar(t('projectSwitcher.switchError'), 'error');
    } finally {
      setIsSwitchingProject(false);
    }
  }, [activeProjectId, applyProjectContextChange, handleProjectMenuClose, showSnackbar, t]);

  const navigateRelativePage = useCallback((direction: 1 | -1): void => {
    const currentIndex = KEYBOARD_NAV_ROUTES.indexOf(currentKeyboardRoute);

    if (currentIndex === -1) {
      console.warn(`[keyboard-nav] Unknown route "${currentKeyboardRoute}" (pathname: "${location.pathname}"). Falling back to dashboard.`);
      navigate('/app/dashboard');
      return;
    }

    const nextIndex = (currentIndex + direction + KEYBOARD_NAV_ROUTES.length) % KEYBOARD_NAV_ROUTES.length;
    navigate(KEYBOARD_NAV_ROUTES[nextIndex]);
  }, [currentKeyboardRoute, location.pathname, navigate]);

  const goToNextPage = useCallback((): void => {
    navigateRelativePage(1);
  }, [navigateRelativePage]);

  const goToPreviousPage = useCallback((): void => {
    navigateRelativePage(-1);
  }, [navigateRelativePage]);

  const globalCommands = useMemo(() => createRootCommands({
    currentPath: currentKeyboardRoute,
    activeProjectId,
    memberships,
    onNextPage: goToNextPage,
    onPreviousPage: goToPreviousPage,
    onOpenProjectSettings: handleOpenProjectSettings,
    onOpenCreateProject: handleOpenCreateProject,
    onSwitchProject: (projectId) => { void handleSwitchProject(projectId); },
    onOpenAccountSettings: () => navigate('/app/account-settings'),
    onOpenVersionHistory: () => { void handleOpenProjectHistory(); },
    onLeaveDemoProject: canLeaveDemoProject ? () => { void handleLeaveDemoProject(); } : undefined,
    onLogout: isGuestDemoSession ? undefined : () => { void handleLogout(); },
    onOpenPalette: openPalette,
    onOpenPageHelp: openCurrentPageHelp,
    onOpenShortcutsHelp: openShortcutsHelp,
    onToggleSidebar: toggleSidebarCollapsed,
    isSidebarToggleVisible: () => isDesktopUp,
    labels: {
      nextPage: t('commandPalette.commands.nextPage'),
      previousPage: t('commandPalette.commands.previousPage'),
      openProjectSettings: t('commandPalette.commands.openProjectSettings'),
      createProject: t('commandPalette.commands.createProject'),
      switchProjectPrefix: t('commandPalette.commands.switchProjectPrefix'),
      openAccountSettings: t('commandPalette.commands.openAccountSettings'),
      openVersionHistory: t('commandPalette.commands.openVersionHistory'),
      leaveDemo: t('commandPalette.commands.leaveDemo'),
      logout: t('commandPalette.commands.logout'),
      openPalette: t('commandPalette.label'),
      openPageHelp: t('commandPalette.commands.openPageHelp'),
      openShortcutsHelp: t('commandPalette.commands.openShortcutsHelp'),
      toggleSidebar: t('commandPalette.commands.toggleSidebar'),
    },
  }), [
    activeProjectId,
    currentKeyboardRoute,
    goToNextPage,
    goToPreviousPage,
    handleLeaveDemoProject,
    handleLogout,
    handleOpenCreateProject,
    handleOpenProjectHistory,
    handleOpenProjectSettings,
    handleSwitchProject,
    canLeaveDemoProject,
    isDesktopUp,
    isGuestDemoSession,
    memberships,
    navigate,
    openCurrentPageHelp,
    openPalette,
    openShortcutsHelp,
    t,
    toggleSidebarCollapsed,
  ]);

  useRegisterCommands('global-app', globalCommands);

  useEffect(() => {
    setSidebarCollapsed(!isLargeDesktop);
  }, [isLargeDesktop]);

  const sidebarWidth = sidebarCollapsed ? 64 : 240;
  const currentPageTitle = useMemo(() => {
    const activeItem = navItems.find((item) => location.pathname === item.to || item.activeAliases.includes(location.pathname));
    if (!activeItem && location.pathname.startsWith('/app/locations')) {
      return t('locations');
    }
    if (!activeItem && location.pathname.startsWith('/app/project-selection')) {
      return t('project.selection');
    }
    if (!activeItem && location.pathname.startsWith('/app/account-settings')) {
      return t('accountSettings');
    }
    if (!activeItem && location.pathname.startsWith('/app/project-settings')) {
      return t('project.settings');
    }
    if (!activeItem && location.pathname.startsWith('/app/public-library-moderation')) {
      return t('publicLibraryModeration');
    }
    if (!activeItem && location.pathname.startsWith(NOTIFICATION_HISTORY_ROUTE)) {
      return tNotifications('history.title');
    }
    return activeItem?.label ?? '';
  }, [location.pathname, navItems, t, tNotifications]);
  useEffect(() => {
    const appName = tCommon('appName');
    document.title = currentPageTitle ? `${currentPageTitle} – ${appName}` : appName;
    return () => {
      document.title = appName;
    };
  }, [currentPageTitle, tCommon]);
  const topbarHelpConfig = useMemo(() => {
    if (location.pathname.startsWith('/app/dashboard')) return { pageKey: 'dashboard' as const, label: t('pageHelp.dashboard') };
    if (location.pathname.startsWith('/app/locations')) return { pageKey: 'locations' as const, label: t('pageHelp.locations') };
    if (location.pathname.startsWith('/app/fields-beds')) {
      return isFieldsBedsGraphicalViewActive
        ? { pageKey: 'graphical' as const, label: t('pageHelp.areas') }
        : { pageKey: 'areas' as const, label: t('pageHelp.areas') };
    }
    if (location.pathname.startsWith('/app/crops')) return { pageKey: 'crops' as const, label: t('pageHelp.crops') };
    if (location.pathname.startsWith('/app/crop-library')) return { pageKey: 'cropLibrary' as const, label: t('pageHelp.cropLibrary') };
    if (location.pathname.startsWith('/app/anbauplaene') || location.pathname.startsWith('/app/planting-plans')) return { pageKey: 'plantingPlans' as const, label: t('pageHelp.plantingPlans') };
    if (location.pathname.startsWith('/app/gantt-chart')) return { pageKey: 'calendar' as const, label: t('pageHelp.calendar') };
    if (location.pathname.startsWith('/app/yield-overview')) return { pageKey: 'yieldOverview' as const, label: t('pageHelp.yieldOverview') };
    if (location.pathname.startsWith('/app/seed-demand')) return { pageKey: 'seedDemand' as const, label: t('pageHelp.seedDemand') };
    if (location.pathname.startsWith('/app/suppliers')) return { pageKey: 'suppliers' as const, label: t('pageHelp.suppliers') };
    return null;
  }, [isFieldsBedsGraphicalViewActive, location.pathname, t]);
  const topbarPrimaryAction = useMemo(() => {
    // The fields-beds "add" action carries a `menuActions` entry for the
    // other hierarchy level (split button), which the generic
    // activeCreateActions path below doesn't model — so it takes priority
    // on this route. The Alt+Shift+N shortcut itself still runs through
    // CommandProvider's own runPrimaryCreateAction independent of this.
    if (location.pathname.startsWith('/app/fields-beds')) {
      return fieldsGlobalAddAction ? {
        label: fieldsGlobalAddAction.label,
        tooltip: `${fieldsGlobalAddAction.label} (Alt+Shift+N)`,
        to: '',
        onClick: fieldsGlobalAddAction.onClick,
        menuActions: fieldsGlobalAddAction.menuActions,
      } : null;
    }
    if (activeCreateActions.length > 0) {
      const isSingleCreateAction = activeCreateActions.length === 1;
      const primaryCreateAction = activeCreateActions[0];
      const label = isSingleCreateAction ? primaryCreateAction.label : t('commandPalette.createNew');
      return {
        label,
        tooltip: `${label} (${primaryCreateAction.shortcut ?? 'Alt+Shift+N'})`,
        onClick: runPrimaryCreateAction,
      };
    }
    return null;
  }, [activeCreateActions, fieldsGlobalAddAction, location.pathname, runPrimaryCreateAction, t]);
  const handleTopbarPrimaryAction = useCallback((): void => {
    if (!topbarPrimaryAction) {
      return;
    }
    if (topbarPrimaryAction.menuActions && topbarPrimaryAction.menuActions.length > 0) {
      return;
    }
    if (topbarPrimaryAction.onClick) {
      topbarPrimaryAction.onClick();
      return;
    }
    if ('to' in topbarPrimaryAction && topbarPrimaryAction.to) {
      navigate(topbarPrimaryAction.to);
    }
  }, [navigate, topbarPrimaryAction]);

  if (requiresProjectSelectionRedirect) {
    return <Navigate to="/app/project-selection" replace />;
  }

  return (
    <Box sx={{ display: 'flex', width: '100%', maxWidth: '100%', overflowX: 'hidden', minHeight: '100vh', bgcolor: 'surface.appBackground', position: 'relative', isolation: 'isolate' }}>
      {isDesktopUp ? (
        <Box
          component="aside"
          ref={sidebarRegionRef}
          onClick={handleCollapsedSidebarBackgroundClick}
          sx={getNavigationShellSx(sidebarWidth, sidebarCollapsed)}
        >
          <Stack sx={{ height: '100%', minHeight: 0, width: '100%' }}>
            {!sidebarCollapsed ? (
              <Stack direction="row" sx={{ px: 1.5, py: 1, gap: 1,
                alignItems: "center",
                justifyContent: "space-between", }}   >
                <Box
                  component={RouterLink}
                  to="/app/dashboard"
                  aria-label={t('globalMenu.dashboardLink')}
                  title={t('globalMenu.dashboardLink')}
                  sx={navigationLogoLinkSx}
                >
                  <AppIcon size={24} sx={{ borderRadius: 0.5 }} />
                  <Typography
                    variant="subtitle2"
                    noWrap
                    sx={navigationLogoTextSx}
                  >
                    OpenFarmPlanner
                  </Typography>
                </Box>
                <AppTooltip
                  title={t('globalMenu.closeSidebar')}
                  placement="right"
                  enterDelay={350}
                  slotProps={{ tooltip: { sx: navigationTooltipSx } }}
                >
                  <IconButton
                    ref={collapseSidebarBtnRef}
                    aria-label={t('globalMenu.collapseSidebar')}
                    onClick={toggleSidebarCollapsed}
                    size="small"
                    sx={getNavigationToggleButtonSx('w-resize')}
                  >
                    <PanelLeft size={18} strokeWidth={1.8} />
                  </IconButton>
                </AppTooltip>
              </Stack>
            ) : (
              <Stack direction="row" sx={{ py: 1, mb: 0.75,
                alignItems: "center",
                justifyContent: "center", }}   >
                <AppTooltip
                  title={t('globalMenu.openSidebar')}
                  placement="right"
                  enterDelay={350}
                  slotProps={{ tooltip: { sx: navigationTooltipSx } }}
                >
                  <IconButton
                    ref={expandSidebarBtnRef}
                    aria-label={t('globalMenu.expandSidebar')}
                    onClick={toggleSidebarCollapsed}
                    size="small"
                    sx={getNavigationToggleButtonSx('e-resize')}
                  >
                    <PanelLeft size={18} strokeWidth={1.8} />
                  </IconButton>
                </AppTooltip>
              </Stack>
            )}
            <List sx={{ px: 1, pt: 0.5, pb: 1, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
              {navItems.map((item) => {
                const isActive = location.pathname === item.to || item.activeAliases.includes(location.pathname);
                const disabled = shouldDisableNavItem(item, hasActiveProject);
                return (
                  <NavListItem
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    icon={item.icon}
                    isActive={isActive}
                    disabled={disabled}
                    disabledTooltip={t('disabledNoProjectTooltip')}
                    itemSx={getNavigationItemSx(isActive, sidebarCollapsed, disabled)}
                    iconSx={getNavigationIconSx(sidebarCollapsed, disabled)}
                    textProps={!sidebarCollapsed ? getNavigationTextProps(isActive, disabled) : undefined}
                    enabledTooltip={sidebarCollapsed ? item.label : undefined}
                  />
                );
              })}
            </List>
          </Stack>
        </Box>
      ) : null}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'surface.contentBackground' }}>
      <Box sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {navItems.map((item) => {
          const srLinkLabel = item.to === '/app/dashboard' ? t('globalMenu.dashboardLink') : item.label;
          if (shouldDisableNavItem(item, hasActiveProject)) {
            return (
              <span key={`sr-${item.to}`} aria-disabled="true">
                <span>{item.label}</span> ({t('disabledNoProjectTooltip')})
              </span>
            );
          }
          return <RouterLink key={`sr-${item.to}`} to={item.to} aria-label={srLinkLabel}>{item.label}</RouterLink>;
        })}
      </Box>
      <AppBar
        ref={topbarRegionRef}
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: '1px solid', borderColor: 'surface.surfaceBorder', bgcolor: 'surface.topbarBackground', backdropFilter: 'saturate(120%) blur(2px)' }}
      >
        <Toolbar
          variant="dense"
          sx={{
            minHeight: 56,
            gap: 1,
            py: 0.5,
            px: { xs: 0, sm: 2, md: 3 },
            flexWrap: 'nowrap',
            minWidth: 0,
            maxWidth: '100%',
            // No `overflow` set here on purpose: per the CSS Overflow spec, a
            // container with overflow-x: hidden and overflow-y: visible has its
            // overflow-y computed as `auto` instead (browsers can't mix hidden
            // and true visible across axes), which still clips the moderation
            // badge poking above this row. The page-level Box's overflowX:
            // hidden (RootLayout's outer wrapper) already guards against a
            // horizontal scrollbar; nothing here needs its own clip.
          }}
        >
          {!isDesktopUp ? <IconButton aria-label={t('globalMenu.openMobileMenu')} onClick={() => setMobileNavOpen(true)} sx={{ width: COMPACT_TOPBAR_TOGGLE_SIZE, height: COMPACT_TOPBAR_TOGGLE_SIZE }}><MenuIcon /></IconButton> : null}
          <Box sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            minWidth: 0,
            width: 'max-content',
            maxWidth: { xs: 240, sm: 280, md: 400, lg: 480 },
            flex: { xs: '0 1 max-content', md: '0 0 max-content' },
            flexWrap: 'nowrap',
            overflow: 'hidden',
 }}>
            {!isDesktopUp ? (
              <Typography
                component="h1"
                variant="subtitle1"
                noWrap
                sx={{
                  minWidth: 0,
                  maxWidth: { xs: 180, sm: 220 },
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: { xs: '0.98rem', sm: '1.02rem' },
                  fontWeight: 600,
                  lineHeight: 1.2,
                  flexShrink: 1,
                }}
              >
                {currentPageTitle}
              </Typography>
            ) : (
              <Typography
                component="h1"
                variant="h5"
                noWrap
                sx={{
                  minWidth: 0,
                  maxWidth: { sm: 260, md: 360, lg: 440 },
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: { xs: '1rem', md: '1.25rem' },
                  fontWeight: 600,
                  lineHeight: 1.15,
                }}
              >
                {currentPageTitle}
              </Typography>
            )}
            {topbarHelpConfig ? (
              // The trigger button moves into the "Mehr" menu on the compact
              // topbar (see GlobalMenu's "Hilfe zu dieser Seite" entry) to
              // save space; PageHelp itself stays mounted either way so its
              // window 'ofp:open-page-help' listener (used by both that menu
              // entry and the command palette) keeps working.
              <Box sx={{ display: isCompactTopbar ? 'none' : 'inline-flex' }}>
                <PageHelp pageKey={topbarHelpConfig.pageKey} ariaLabel={t('pageHelp.openAria', { label: topbarHelpConfig.label })} tooltip={topbarHelpConfig.label} />
              </Box>
            ) : null}
            {topbarTitleActions.length > 0 ? (
              isCompactTopbar ? (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={topbarTitleActions.find((action) => action.active)?.id ?? null}
                  aria-label={isCalendarPage ? t('ganttChart:modeAriaLabel') : t('fields:representation.ariaLabel')}
                  sx={{
                    ml: 0.5,
                    flexShrink: 0,
                    '& .MuiToggleButton-root': {
                      width: COMPACT_TOPBAR_TOGGLE_SIZE,
                      height: COMPACT_TOPBAR_TOGGLE_SIZE,
                      p: 0,
                      borderColor: 'divider',
                      color: 'text.primary',
                      visibility: 'visible',
                      '&.Mui-selected': {
                        bgcolor: 'success.main',
                        color: 'success.contrastText',
                        borderColor: 'success.dark',
                        borderWidth: 2,
                        boxShadow: 1,
                      },
                      '&.Mui-selected:hover': {
                        bgcolor: 'success.dark',
                      },
                    },
                  }}
                >
                  {topbarTitleActions.map((action) => {
                    const icon = getCompactTopbarActionIcon(action.id);
                    if (!icon) {
                      return null;
                    }
                    return (
                      <AppTooltip key={action.id} title={action.tooltip ?? action.label} describeChild enterTouchDelay={0}>
                        <ToggleButton
                          value={action.id}
                          aria-label={action.label}
                          onClick={action.onClick}
                          disabled={action.disabled}
                          sx={action.hidden ? {
                            visibility: 'hidden',
                            pointerEvents: 'none',
                          } : undefined}
                        >
                          {icon}
                        </ToggleButton>
                      </AppTooltip>
                    );
                  })}
                </ToggleButtonGroup>
              ) : (
              <ButtonGroup
                size="small"
                variant="outlined"
                sx={{ ...segmentedButtonGroupSx, ml: 1, flexShrink: 0 }}
              >
                {topbarTitleActions.map((action) => (
                  <Button
                    key={action.id}
                    size="small"
                    variant={action.active ? 'contained' : 'outlined'}
                    color={action.active ? 'success' : 'inherit'}
                    onClick={action.onClick}
                    aria-label={action.ariaLabel ?? action.label}
                    aria-pressed={action.active}
                    disabled={action.disabled}
                    sx={getSegmentedActionButtonSx({ active: Boolean(action.active), hidden: Boolean(action.hidden) })}
                  >
                    {action.label}
                  </Button>
                ))}
              </ButtonGroup>
              )
            ) : null}
          </Box>
          {!isCompactTopbar ? (
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', minWidth: 0, maxWidth: '100%', flex: 1, position: 'relative', zIndex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: TOPBAR_ACTION_GROUP_GAP, minWidth: 0, flex: 1, justifyContent: 'flex-end', pr: 0.5 }}>
          {isCropsPage ? (
            <>
              {showCropImportExportButton || isMobile ? (
                <Button
                  size="small"
                  variant="outlined"
                  aria-label={t('cropActions.openImportExport')}
                  aria-controls={cropActionsMenuAnchor ? 'crop-actions-menu' : undefined}
                  aria-haspopup="true"
                  aria-expanded={Boolean(cropActionsMenuAnchor)}
                  onClick={handleCropActionsMenuOpen}
                  startIcon={<ImportExportIcon fontSize="small" />}
                  endIcon={!isPhone ? <KeyboardArrowDownIcon fontSize="small" /> : undefined}
                  sx={{ textTransform: 'none', whiteSpace: 'nowrap', minWidth: isPhone ? 36 : 'auto', px: isPhone ? 0.75 : 1.25, flexShrink: 0 }}
                >
                  {isPhone ? null : t('cropActions.importExport')}
                </Button>
              ) : null}
              <Menu
                id="crop-actions-menu"
                anchorEl={cropActionsMenuAnchor}
                open={Boolean(cropActionsMenuAnchor)}
                onClose={handleCropActionsMenuClose}
              >
                {cropLibraryAction ? (
                  <MenuItem
                    aria-label={cropLibraryAction.ariaLabel ?? cropLibraryAction.label}
                    onClick={() => {
                      cropLibraryAction.onClick();
                      handleCropActionsMenuClose();
                    }}
                    disabled={cropLibraryAction.disabled}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <NavEmojiIcon emoji={CROP_LIBRARY_EMOJI} sx={{ fontSize: 18, width: 18, height: 18 }} />
                    </ListItemIcon>
                    <ListItemText primary={cropLibraryAction.label} />
                  </MenuItem>
                ) : null}
                {cropImportExportActions.map((action) => (
                  <MenuItem
                    key={action.id}
                    aria-label={action.ariaLabel ?? action.label}
                    onClick={() => {
                      action.onClick();
                      handleCropActionsMenuClose();
                    }}
                    disabled={action.disabled}
                  >
                    <ListItemText primary={action.label} secondary={action.shortcutHint} />
                  </MenuItem>
                ))}
              </Menu>
            </>
          ) : null}
          {isPublicCropLibraryPage && publicLibraryModerationAction ? (
            <>
              <Badge
                badgeContent={publicLibraryModerationAction.badgeContent}
                color="error"
                overlap="rectangular"
                sx={{
                  flexShrink: 0,
                  ...TOPBAR_BADGE_SX,
                }}
              >
                <Button
                  size="medium"
                  variant="outlined"
                  onClick={(event) => setPublicLibraryModerationMenuAnchor(event.currentTarget)}
                  aria-label={publicLibraryModerationAction.ariaLabel ?? publicLibraryModerationAction.label}
                  disabled={publicLibraryModerationAction.disabled}
                  endIcon={<KeyboardArrowDownIcon fontSize="small" />}
                  sx={{
                    ...getStandardActionButtonSx(false),
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {publicLibraryModerationAction.label}
                </Button>
              </Badge>
              <Menu
                anchorEl={publicLibraryModerationMenuAnchor}
                open={Boolean(publicLibraryModerationMenuAnchor)}
                onClose={() => setPublicLibraryModerationMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                {publicLibraryModerationAction.menuActions?.map((action) => (
                  <MenuItem
                    key={action.id}
                    onClick={() => { setPublicLibraryModerationMenuAnchor(null); action.onClick(); }}
                    disabled={action.disabled}
                    sx={action.destructive ? { color: 'error.main' } : undefined}
                  >
                    {action.destructive ? (
                      <DeleteOutlineIcon fontSize="small" sx={{ mr: 1, color: 'error.main' }} />
                    ) : null}
                    {action.label}
                  </MenuItem>
                ))}
              </Menu>
            </>
          ) : null}
          {(() => {
            const groups: TopbarContextAction[][] = [];
            // topbarPrimaryAction below already renders the location "add" action (via
            // activeCreateActions), so skip it here to avoid a duplicate button on desktop.
            [...topbarModeControls, ...topbarOverflowActions]
              .filter((action) => action.id !== HIERARCHY_CREATE_LOCATION_ACTION_ID)
              .forEach((action) => {
              const lastGroup = groups[groups.length - 1];
              if (!lastGroup || !action.groupId || lastGroup[0]?.groupId !== action.groupId) {
                groups.push([action]);
                return;
              }
              lastGroup.push(action);
            });
            return groups.map((group, index) => {
              const isSegmentedGroup = group.length > 1 && group[0]?.groupId;
              const content = group.map((action) => {
                const isHierarchyCreateLocationAction = action.id === HIERARCHY_CREATE_LOCATION_ACTION_ID;
                const isStandardAction = action.appearance === 'standard';
                const button = isStandardAction ? (
                <Button
                  key={action.id}
                  size="medium"
                  variant="outlined"
                  onClick={action.onClick}
                  aria-label={action.ariaLabel ?? action.label}
                  disabled={action.disabled}
                  sx={{
                    ...getStandardActionButtonSx(false),
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    ...(action.hidden ? { display: 'none' } : {}),
                  }}
                >
                  {action.label}
                </Button>
                ) : (
                <Button
                  key={action.id}
                  size="small"
                  variant={isHierarchyCreateLocationAction || action.active ? 'contained' : 'outlined'}
                  color={action.active ? 'success' : isHierarchyCreateLocationAction ? 'primary' : 'inherit'}
                  onClick={action.onClick}
                  aria-label={action.ariaLabel ?? action.label}
                  aria-pressed={action.active}
                  disabled={action.disabled}
                  startIcon={isHierarchyCreateLocationAction && !isPhone ? <AddIcon fontSize="small" /> : undefined}
                  sx={isHierarchyCreateLocationAction
                    ? {
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                      minWidth: isPhone ? 36 : 'auto',
                      px: isPhone ? 0.75 : 1.25,
                      flexShrink: 0,
                      ...(action.hidden ? { display: 'none' } : {}),
                    }
                    : getSegmentedActionButtonSx({
                      active: Boolean(action.active),
                      hidden: Boolean(action.hidden),
                    })}
                  style={!isHierarchyCreateLocationAction && isMobile ? { minWidth: 0, paddingLeft: 8, paddingRight: 8, fontSize: '0.74rem' } : undefined}
                >
                  {isHierarchyCreateLocationAction && isPhone ? <AddIcon fontSize="small" /> : action.label}
                </Button>
                );
                return action.tooltip ? (
                  <AppTooltip key={action.id} title={action.tooltip}>
                    <Box component="span" sx={{ display: 'inline-flex', minWidth: 0 }}>{button}</Box>
                  </AppTooltip>
                ) : React.cloneElement(button, { key: action.id });
              });
              return isSegmentedGroup ? (
                <ButtonGroup
                  key={`group-${group[0]?.groupId}-${index}`}
                  size="small"
                  variant="outlined"
                  sx={{ ...segmentedButtonGroupSx, flexShrink: 0, minWidth: 0 }}
                >
                  {content}
                </ButtonGroup>
              ) : (
                <Box key={`group-${index}`} sx={{ display: 'inline-flex', flexShrink: 1, minWidth: 0 }}>{content}</Box>
              );
            });
          })()}
          {topbarPrimaryAction ? (
            topbarPrimaryAction.menuActions && topbarPrimaryAction.menuActions.length > 0 ? (
              <ButtonGroup variant="contained" size="small" sx={{ flexShrink: 0 }}>
                <Button
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={topbarPrimaryAction.onClick}
                  aria-label={topbarPrimaryAction.tooltip ?? topbarPrimaryAction.label}
                  sx={{ textTransform: 'none', whiteSpace: 'nowrap', px: 1.25 }}
                >
                  {topbarPrimaryAction.label}
                </Button>
                <Button
                  aria-label={t('common:actions.moreOptions')}
                  aria-controls={topbarPrimaryActionMenuAnchor ? 'topbar-primary-action-menu' : undefined}
                  aria-haspopup="true"
                  aria-expanded={Boolean(topbarPrimaryActionMenuAnchor)}
                  onClick={(event) => setTopbarPrimaryActionMenuAnchor(event.currentTarget)}
                  sx={{ px: 0.5, minWidth: 28 }}
                >
                  <KeyboardArrowDownIcon
                    fontSize="small"
                    sx={{
                      transition: 'transform 0.15s',
                      transform: topbarPrimaryActionMenuAnchor ? 'rotate(180deg)' : 'none',
                    }}
                  />
                </Button>
              </ButtonGroup>
            ) : (
              <AppTooltip title={topbarPrimaryAction.tooltip ?? topbarPrimaryAction.label}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleTopbarPrimaryAction}
                  aria-label={topbarPrimaryAction.tooltip ?? topbarPrimaryAction.label}
                  startIcon={!isPhone ? <AddIcon fontSize="small" /> : undefined}
                  sx={{ textTransform: 'none', whiteSpace: 'nowrap', minWidth: isPhone ? 44 : 'auto', minHeight: isPhone ? 44 : 'auto', px: isPhone ? 0.75 : 1.25, flexShrink: 0 }}
                >
                  {isPhone ? <AddIcon fontSize="small" /> : topbarPrimaryAction.label}
                </Button>
              </AppTooltip>
            )
          ) : null}
            </Box>
          {topbarPrimaryAction?.menuActions && topbarPrimaryAction.menuActions.length > 0 ? (
            <Menu
              id="topbar-primary-action-menu"
              anchorEl={topbarPrimaryActionMenuAnchor}
              open={Boolean(topbarPrimaryActionMenuAnchor)}
              onClose={() => setTopbarPrimaryActionMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{
                paper: {
                  sx: {
                    mt: 0.5,
                    minWidth: topbarPrimaryActionMenuAnchor?.parentElement?.offsetWidth,
                  },
                },
              }}
            >
              {topbarPrimaryAction.menuActions.map((action) => (
                <MenuItem
                  key={action.id}
                  onClick={() => {
                    setTopbarPrimaryActionMenuAnchor(null);
                    action.onClick();
                  }}
                  disabled={action.disabled}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <AddIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={action.label} />
                </MenuItem>
              ))}
            </Menu>
          ) : null}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: TOPBAR_OVERFLOW_MENU_GAP, ml: TOPBAR_ACTION_GROUP_GAP, flexShrink: 0 }}>
          {/* Season switcher, project switcher, and the notification bell
              read as one "status" cluster — tighter gap than the group's own
              separation from the primary action button before it (this Box's
              ml plus the action group's pr) and from the "Mehr" overflow menu
              after it. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: TOPBAR_STATUS_CLUSTER_GAP }}>
          {hasActiveProject ? (
            <SeasonSwitcher
              controller={activeSeason}
              onOpenProjectSettings={handleOpenProjectSettings}
              onOpenCreateSuggestion={requestSeasonCreation}
              isPhone={isPhone}
              buttonPx={TOPBAR_STATUS_BUTTON_PX}
            />
          ) : null}
          <Button
            aria-label={t('projectSwitcher.ariaLabel')}
            aria-controls={projectMenuAnchor ? 'project-switcher-menu' : undefined}
            aria-haspopup="true"
            onClick={handleProjectMenuOpen}
            size="small"
            disabled={isSwitchingProject}
            sx={{
              color: 'text.primary',
              textTransform: 'none',
              maxWidth: { xs: 210, sm: 190, md: 240, lg: 320 },
              minWidth: 0,
              px: TOPBAR_STATUS_BUTTON_PX,
            }}
            startIcon={<NavEmojiIcon emoji="📁" />}
            endIcon={!isPhone ? <KeyboardArrowDownIcon fontSize="small" /> : undefined}
          >
            {/* The class name carries no styling — it is the selector
                e2e/onboarding-demo-project.spec.ts uses to read the active
                project name out of the topbar. */}
            <Box
              component="span"
              className="project-switcher-label"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {activeProjectLabel}
            </Box>
          </Button>
          <ProjectMenu
            anchorEl={projectMenuAnchor}
            open={Boolean(projectMenuAnchor)}
            memberships={memberships}
            activeProjectId={activeProjectId}
            isSwitchingProject={isSwitchingProject}
            isCreatingDemoProject={isCreatingDemoProject}
            deletedProjectsCount={deletedProjectsCount}
            onClose={handleProjectMenuClose}
            onSwitchProject={handleSwitchProject}
            onOpenProjectSettings={handleOpenProjectSettings}
            onOpenProjectSelection={handleOpenProjectSelectionPage}
            onOpenCreateProject={handleOpenCreateProject}
            onCreateDemoProject={() => { void handleCreateDemoProject(); }}
            onOpenProjectTrash={handleOpenProjectTrash}
            t={t}
          />
          <NotificationBell controller={notifications} buttonSize={36} />
          </Box>
          <IconButton
            aria-label="Mehr"
            aria-controls={globalMenuAnchor ? 'global-actions-menu' : undefined}
            aria-haspopup="true"
            onClick={handleGlobalMenuOpen}
            size="small"
            sx={{ color: 'text.primary' }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <GlobalMenu
            anchorEl={globalMenuAnchor}
            open={Boolean(globalMenuAnchor)}
            historyLoading={historyLoading}
            userLabel={user?.email ? `(${user.email})` : (user?.display_label ? `(${user.display_label})` : '')}
            isMobile={false}
            onClose={handleGlobalMenuClose}
            onOpenProjectSwitcher={handleOpenMobileProjectSwitcher}
            onOpenCreateProject={handleOpenCreateProject}
            onOpenProjectSettings={handleOpenProjectSettings}
            onOpenProjectHistory={handleOpenProjectHistory}
            onOpenAccountSettings={() => navigateFromGlobalMenu('/app/account-settings')}
            onOpenShortcuts={handleOpenShortcuts}
            onOpenHelp={openGlobalHelp}
            onOpenFeedback={openFeedbackDialog}
            showFeedbackNewBadge={!feedbackBadgeSeen}
            canLeaveDemoProject={canLeaveDemoProject}
            isGuestDemoSession={isGuestDemoSession}
            onLeaveDemoProject={handleLeaveDemoProject}
            onLogout={handleLogout}
            t={t}
          />
            </Box>
          </Box>
          ) : (
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: isCropsPage ? 0.25 : TOPBAR_ACTION_GROUP_GAP, flexShrink: 0 }}>
              {isCropsPage ? (
                <>
                  {showCropImportExportButton ? (
                    <AppTooltip title={t('cropActions.openImportExport')} enterTouchDelay={0}>
                      <IconButton
                        size="small"
                        aria-label={t('cropActions.openImportExport')}
                        aria-controls={cropActionsMenuAnchor ? 'crop-actions-menu-mobile' : undefined}
                        aria-haspopup="true"
                        aria-expanded={Boolean(cropActionsMenuAnchor)}
                        onClick={handleCropActionsMenuOpen}
                        sx={{
                          width: COMPACT_TOPBAR_TOGGLE_SIZE,
                          height: COMPACT_TOPBAR_TOGGLE_SIZE,
                          flexShrink: 0,
                          color: 'text.primary',
                          mr: 0.5,
                          '& .MuiSvgIcon-root': { fontSize: 24 },
                        }}
                      >
                        <ImportExportIcon />
                      </IconButton>
                    </AppTooltip>
                  ) : null}
                  <Menu
                    id="crop-actions-menu-mobile"
                    anchorEl={cropActionsMenuAnchor}
                    open={Boolean(cropActionsMenuAnchor)}
                    onClose={handleCropActionsMenuClose}
                  >
                    {cropLibraryAction ? (
                      <MenuItem
                        aria-label={cropLibraryAction.ariaLabel ?? cropLibraryAction.label}
                        onClick={() => {
                          cropLibraryAction.onClick();
                          handleCropActionsMenuClose();
                        }}
                        disabled={cropLibraryAction.disabled}
                      >
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <NavEmojiIcon emoji={CROP_LIBRARY_EMOJI} sx={{ fontSize: 18, width: 18, height: 18 }} />
                        </ListItemIcon>
                        <ListItemText primary={cropLibraryAction.label} />
                      </MenuItem>
                    ) : null}
                    {cropImportExportActions.map((action) => (
                      <MenuItem
                        key={`mobile-primary-${action.id}`}
                        aria-label={action.ariaLabel ?? action.label}
                        onClick={() => {
                          action.onClick();
                          handleCropActionsMenuClose();
                        }}
                        disabled={action.disabled}
                      >
                        <ListItemText primary={action.label} secondary={action.shortcutHint} />
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              ) : null}
              {isPublicCropLibraryPage && publicLibraryModerationAction ? (
                <>
                  <AppTooltip title={publicLibraryModerationAction.label} enterTouchDelay={0}>
                    <Box component="span" sx={{ display: 'inline-flex' }}>
                      <IconButton
                        size="small"
                        onClick={(event) => setPublicLibraryModerationMenuAnchor(event.currentTarget)}
                        aria-label={publicLibraryModerationAction.ariaLabel ?? publicLibraryModerationAction.label}
                        sx={{
                          width: COMPACT_TOPBAR_TOGGLE_SIZE,
                          height: COMPACT_TOPBAR_TOGGLE_SIZE,
                          flexShrink: 0,
                          color: 'text.primary',
                          '& .MuiSvgIcon-root': { fontSize: 24 },
                        }}
                        disabled={publicLibraryModerationAction.disabled}
                      >
                        <Badge
                          badgeContent={publicLibraryModerationAction.badgeContent}
                          color="error"
                          overlap="circular"
                          sx={TOPBAR_BADGE_SX}
                        >
                          <GavelIcon />
                        </Badge>
                      </IconButton>
                    </Box>
                  </AppTooltip>
                  <Menu
                    anchorEl={publicLibraryModerationMenuAnchor}
                    open={Boolean(publicLibraryModerationMenuAnchor)}
                    onClose={() => setPublicLibraryModerationMenuAnchor(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  >
                    {publicLibraryModerationAction.menuActions?.map((action) => (
                      <MenuItem
                        key={action.id}
                        onClick={() => { setPublicLibraryModerationMenuAnchor(null); action.onClick(); }}
                        disabled={action.disabled}
                        sx={action.destructive ? { color: 'error.main' } : undefined}
                      >
                        {action.destructive ? (
                          <DeleteOutlineIcon fontSize="small" sx={{ mr: 1, color: 'error.main' }} />
                        ) : null}
                        {action.label}
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              ) : null}
              {showMobileTopbarViewActions ? (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: TOPBAR_ACTION_GROUP_GAP, flexShrink: 0 }}>
                  {mobileTopbarViewActions.length > 0 ? (
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={activeMobileTopbarViewActionId}
                      aria-label={isCalendarPage ? t('ganttChart:modeAriaLabel') : t('fields:representation.ariaLabel')}
                      sx={{
                        flexShrink: 0,
                        '& .MuiToggleButton-root': {
                          width: COMPACT_TOPBAR_TOGGLE_SIZE,
                          height: COMPACT_TOPBAR_TOGGLE_SIZE,
                          p: 0,
                          borderColor: 'divider',
                          color: 'text.primary',
                          '&.Mui-selected': {
                            bgcolor: 'success.main',
                            color: 'success.contrastText',
                            borderColor: 'success.dark',
                            borderWidth: 2,
                            boxShadow: 1,
                          },
                          '&.Mui-selected:hover': {
                            bgcolor: 'success.dark',
                          },
                        },
                      }}
                    >
                      {mobileTopbarViewActions.map((action) => {
                        const isListViewAction = action.id === 'fields-view-mode-list';
                        const isGraphicalViewAction = action.id === 'fields-view-mode-graphical';
                        const isCalendarOccupancyAction = action.id === 'calendar-view-mode-occupancy';
                        const isCalendarSeedlingsAction = action.id === 'calendar-view-mode-seedlings';
                        const icon = isListViewAction
                          ? <ViewListOutlinedIcon fontSize="small" />
                          : isGraphicalViewAction
                            ? <MapOutlinedIcon fontSize="small" />
                            : isCalendarOccupancyAction
                              ? <EventNoteOutlinedIcon fontSize="small" />
                              : isCalendarSeedlingsAction
                                ? <LocalFloristOutlinedIcon fontSize="small" />
                                : null;
                        if (!icon) {
                          return null;
                        }
                        return (
                          <AppTooltip key={action.id} title={action.tooltip ?? action.label} describeChild enterTouchDelay={0}>
                            <ToggleButton
                              value={action.id}
                              aria-label={action.ariaLabel ?? action.label}
                              onClick={action.onClick}
                              disabled={action.disabled}
                            >
                              {icon}
                            </ToggleButton>
                          </AppTooltip>
                        );
                      })}
                    </ToggleButtonGroup>
                  ) : null}
                  {isFieldsBedsPage && fieldsGlobalAddAction ? (
                    <AppTooltip title={fieldsGlobalAddAction.ariaLabel ?? fieldsGlobalAddAction.label} enterTouchDelay={0}>
                      <IconButton
                        size="small"
                        aria-label={fieldsGlobalAddAction.ariaLabel ?? fieldsGlobalAddAction.label}
                        onClick={(event) => {
                          if (fieldsGlobalAddAction.menuActions && fieldsGlobalAddAction.menuActions.length > 0) {
                            setTopbarPrimaryActionMenuAnchor(event.currentTarget);
                          } else {
                            fieldsGlobalAddAction.onClick();
                          }
                        }}
                        disabled={fieldsGlobalAddAction.disabled}
                        sx={{
                          width: COMPACT_TOPBAR_TOGGLE_SIZE,
                          height: COMPACT_TOPBAR_TOGGLE_SIZE,
                          bgcolor: 'success.main',
                          color: 'success.contrastText',
                          boxShadow: 1,
                          '&:hover': {
                            bgcolor: 'success.dark',
                          },
                          '&.Mui-disabled': {
                            bgcolor: 'action.disabledBackground',
                            color: 'action.disabled',
                          },
                        }}
                      >
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </AppTooltip>
                  ) : null}
                </Box>
              ) : null}
              {topbarPrimaryAction && !showMobileTopbarViewActions ? (
                <AppTooltip title={topbarPrimaryAction.tooltip ?? topbarPrimaryAction.label}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={(event) => {
                      if (topbarPrimaryAction.menuActions && topbarPrimaryAction.menuActions.length > 0) {
                        setTopbarPrimaryActionMenuAnchor(event.currentTarget);
                        return;
                      }
                      handleTopbarPrimaryAction();
                    }}
                    aria-label={topbarPrimaryAction.tooltip ?? topbarPrimaryAction.label}
                    aria-controls={topbarPrimaryActionMenuAnchor ? 'topbar-primary-action-menu' : undefined}
                    aria-haspopup={topbarPrimaryAction.menuActions && topbarPrimaryAction.menuActions.length > 0 ? 'true' : undefined}
                    aria-expanded={Boolean(topbarPrimaryActionMenuAnchor)}
                    sx={{ textTransform: 'none', minWidth: COMPACT_TOPBAR_TOGGLE_SIZE, px: 0.75, minHeight: COMPACT_TOPBAR_TOGGLE_SIZE }}
                  >
                    <AddIcon fontSize="small" />
                  </Button>
                </AppTooltip>
              ) : null}
              {topbarPrimaryAction?.menuActions && topbarPrimaryAction.menuActions.length > 0 ? (
                <Menu
                  id="topbar-primary-action-menu"
                  anchorEl={topbarPrimaryActionMenuAnchor}
                  open={Boolean(topbarPrimaryActionMenuAnchor)}
                  onClose={() => setTopbarPrimaryActionMenuAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  slotProps={{ paper: { sx: { mt: 0.5 } } }}
                >
                  {topbarPrimaryAction.menuActions.map((action) => (
                    <MenuItem
                      key={action.id}
                      onClick={() => {
                        setTopbarPrimaryActionMenuAnchor(null);
                        action.onClick();
                      }}
                      disabled={action.disabled}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <AddIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={action.label} />
                    </MenuItem>
                  ))}
                </Menu>
              ) : null}
              {/* Tight sub-group so the season switcher always sits directly
                  next to "Mehr", regardless of the outer group's spacing. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                {hasActiveProject ? (
                  <SeasonSwitcher
                    controller={activeSeason}
                    onOpenProjectSettings={handleOpenProjectSettings}
                    onOpenCreateSuggestion={requestSeasonCreation}
                    isPhone={isPhone}
                  />
                ) : null}
                <IconButton
                  aria-label={notifications.unreadCount > 0
                    ? tNotifications('bell.unreadAriaLabel', { unread: notifications.unreadCount })
                    : t('globalMenu.moreActions')}
                  aria-controls={globalMenuAnchor ? 'global-actions-menu' : undefined}
                  aria-haspopup="true"
                  onClick={handleGlobalMenuOpen}
                  sx={{ color: 'text.primary', width: COMPACT_TOPBAR_TOGGLE_SIZE, height: COMPACT_TOPBAR_TOGGLE_SIZE }}
                >
                  {/* The compact topbar has no room for its own bell, so the
                      unread signal rides on the menu that holds the entries. */}
                  <Badge badgeContent={notifications.unreadCount} color="error" overlap="circular">
                    <MoreVertIcon />
                  </Badge>
                </IconButton>
              </Box>
              <GlobalMenu
                anchorEl={globalMenuAnchor}
                open={Boolean(globalMenuAnchor)}
                historyLoading={historyLoading}
                userLabel={user?.email ? `(${user.email})` : (user?.display_label ? `(${user.display_label})` : '')}
                isMobile={isCompactTopbar}
                notificationItems={isCompactTopbar ? notificationMenuItems : undefined}
                onClose={handleGlobalMenuClose}
                onOpenProjectSwitcher={handleOpenMobileProjectSwitcher}
                onOpenCreateProject={handleOpenCreateProject}
                onOpenProjectSettings={handleOpenProjectSettings}
                onOpenProjectHistory={handleOpenProjectHistory}
                onOpenAccountSettings={() => navigateFromGlobalMenu('/app/account-settings')}
                onOpenShortcuts={handleOpenShortcuts}
                onOpenHelp={openGlobalHelp}
                onOpenFeedback={openFeedbackDialog}
                showFeedbackNewBadge={!feedbackBadgeSeen}
                onOpenPageHelp={openCurrentPageHelp}
                pageHelpAvailable={Boolean(topbarHelpConfig)}
                canLeaveDemoProject={canLeaveDemoProject}
                isGuestDemoSession={isGuestDemoSession}
                onLeaveDemoProject={handleLeaveDemoProject}
                onLogout={handleLogout}
                t={t}
              />
            </Box>
          )}
        </Toolbar>
        {isCompactTopbar && hasMobileSecondaryRow ? (
          <Box
            sx={{
              px: 0,
              pb: 0.5,
              overflowX: 'hidden',
              overflowY: 'visible',
              whiteSpace: 'normal',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: TOPBAR_ACTION_GROUP_GAP, minHeight: COMPACT_TOPBAR_TOGGLE_SIZE, flexWrap: 'wrap', whiteSpace: 'normal', width: '100%' }}>
              {isCropsPage ? (
                <>
                  {showCropImportExportButton || isMobile ? (
                    <AppTooltip title={t('cropActions.openImportExport')} enterTouchDelay={0}>
                      <IconButton
                        aria-label={t('cropActions.openImportExport')}
                        aria-controls={cropActionsMenuAnchor ? 'crop-actions-menu-mobile' : undefined}
                        aria-haspopup="true"
                        aria-expanded={Boolean(cropActionsMenuAnchor)}
                        onClick={handleCropActionsMenuOpen}
                        sx={{ color: 'text.primary', width: COMPACT_TOPBAR_TOGGLE_SIZE, height: COMPACT_TOPBAR_TOGGLE_SIZE }}
                      >
                        <ImportExportIcon />
                      </IconButton>
                    </AppTooltip>
                  ) : null}
                  <Menu
                    id="crop-actions-menu-mobile"
                    anchorEl={cropActionsMenuAnchor}
                    open={Boolean(cropActionsMenuAnchor)}
                    onClose={handleCropActionsMenuClose}
                  >
                    {cropLibraryAction ? (
                      <MenuItem
                        aria-label={cropLibraryAction.ariaLabel ?? cropLibraryAction.label}
                        onClick={() => {
                          cropLibraryAction.onClick();
                          handleCropActionsMenuClose();
                        }}
                        disabled={cropLibraryAction.disabled}
                      >
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <NavEmojiIcon emoji={CROP_LIBRARY_EMOJI} sx={{ fontSize: 18, width: 18, height: 18 }} />
                        </ListItemIcon>
                        <ListItemText primary={cropLibraryAction.label} />
                      </MenuItem>
                    ) : null}
                    {cropImportExportActions.map((action) => (
                      <MenuItem
                        key={`mobile-${action.id}`}
                        aria-label={action.ariaLabel ?? action.label}
                        onClick={() => {
                          action.onClick();
                          handleCropActionsMenuClose();
                        }}
                        disabled={action.disabled}
                      >
                        <ListItemText primary={action.label} secondary={action.shortcutHint} />
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              ) : null}
              {(() => {
                const groups: TopbarContextAction[][] = [];
                [...topbarModeControls, ...topbarOverflowActions].forEach((action) => {
                  const lastGroup = groups[groups.length - 1];
                  if (!lastGroup || !action.groupId || lastGroup[0]?.groupId !== action.groupId) {
                    groups.push([action]);
                    return;
                  }
                  lastGroup.push(action);
                });
                const visibleGroups = isVeryNarrowMobile ? groups.slice(0, 2) : groups;
                const overflowGroups = isVeryNarrowMobile ? groups.slice(2) : [];
                const visibleNodes = visibleGroups.map((group, index) => {
                  const isSegmentedGroup = group.length > 1 && group[0]?.groupId;
                  const content = group.map((action) => {
                    const isHierarchyCreateLocationAction = action.id === HIERARCHY_CREATE_LOCATION_ACTION_ID;
                    if (action.appearance === 'standard') {
                      return (
                        <Button
                          key={action.id}
                          size="medium"
                          variant="outlined"
                          onClick={action.onClick}
                          aria-label={action.ariaLabel ?? action.label}
                          disabled={action.disabled}
                          sx={{
                            ...getStandardActionButtonSx(false),
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                            ...(action.hidden ? { display: 'none' } : {}),
                          }}
                        >
                          {action.label}
                        </Button>
                      );
                    }
                    return (
                      <Button
                        key={action.id}
                        size="small"
                        variant={isHierarchyCreateLocationAction || action.active ? 'contained' : 'outlined'}
                        color={action.active ? 'success' : isHierarchyCreateLocationAction ? 'primary' : 'inherit'}
                        onClick={action.onClick}
                        aria-label={action.ariaLabel ?? action.label}
                        aria-pressed={action.active}
                        disabled={action.disabled}
                        startIcon={isHierarchyCreateLocationAction && !isPhone ? <AddIcon fontSize="small" /> : undefined}
                        sx={isHierarchyCreateLocationAction
                          ? {
                            textTransform: 'none',
                            whiteSpace: 'nowrap',
                            minWidth: isPhone ? COMPACT_TOPBAR_TOGGLE_SIZE : 'auto',
                            px: isPhone ? 0.75 : 1.25,
                            minHeight: COMPACT_TOPBAR_TOGGLE_SIZE,
                            ...(action.hidden ? { display: 'none' } : {}),
                          }
                          : {
                            ...getSegmentedActionButtonSx({ active: Boolean(action.active), hidden: Boolean(action.hidden) }),
                            minHeight: COMPACT_TOPBAR_TOGGLE_SIZE,
                            px: 1,
                          }}
                      >
                        {isHierarchyCreateLocationAction && isPhone ? <AddIcon fontSize="small" /> : action.label}
                      </Button>
                    );
                  });
                  return isSegmentedGroup ? (
                    <ButtonGroup key={`mobile-group-${group[0]?.groupId}-${index}`} size="small" variant="outlined" sx={{ ...segmentedButtonGroupSx, flexShrink: 0 }}>
                      {content}
                    </ButtonGroup>
                  ) : (
                    <Box key={`mobile-group-${index}`} sx={{ display: 'inline-flex', flexShrink: 0 }}>{content}</Box>
                  );
                });
                if (overflowGroups.length === 0) {
                  return visibleNodes;
                }
                return [
                  ...visibleNodes,
                  <Button
                    key="mobile-actions-overflow-trigger"
                    aria-label={t('common:actions.moreActions')}
                    aria-controls={mobileActionsOverflowAnchor ? 'mobile-actions-overflow-menu' : undefined}
                    aria-haspopup="true"
                    aria-expanded={Boolean(mobileActionsOverflowAnchor)}
                    onClick={handleMobileActionsOverflowOpen}
                    variant="outlined"
                    size="small"
                    color="inherit"
                    sx={{
                      ...getSegmentedActionButtonSx({ active: false }),
                      minHeight: COMPACT_TOPBAR_TOGGLE_SIZE,
                      minWidth: COMPACT_TOPBAR_TOGGLE_SIZE,
                      px: 1,
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </Button>,
                  <Menu
                    key="mobile-actions-overflow-menu"
                    id="mobile-actions-overflow-menu"
                    anchorEl={mobileActionsOverflowAnchor}
                    open={Boolean(mobileActionsOverflowAnchor)}
                    onClose={handleMobileActionsOverflowClose}
                  >
                    {overflowGroups.flatMap((group, groupIndex) =>
                      group.map((action) => (
                        <MenuItem
                          key={`mobile-overflow-action-${groupIndex}-${action.id}`}
                          onClick={() => {
                            action.onClick();
                            handleMobileActionsOverflowClose();
                          }}
                          disabled={action.disabled}
                        >
                          {action.label}
                        </MenuItem>
                      ))
                    )}
                  </Menu>,
                ];
              })()}
            </Box>
          </Box>
        ) : null}
      </AppBar>

      <Drawer anchor="left" open={mobileNavOpen} onClose={closeMobileNav} slotProps={{
        paper: { sx: mobileNavigationDrawerPaperSx }
 }}>
        <List sx={{ width: 280, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <ListItem sx={{ py: 1.5, px: 2 }}>
            <AppLogo size={26} showText to="/app/dashboard" />
          </ListItem>
          {navItems.map((item) => {
            const isActive = location.pathname === item.to || item.activeAliases.includes(location.pathname);
            const disabled = shouldDisableNavItem(item, hasActiveProject);
            return (
              <ListItem key={item.to} disablePadding>
                <NavListItem
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  isActive={isActive}
                  disabled={disabled}
                  disabledTooltip={t('disabledNoProjectTooltip')}
                  itemSx={getMobileNavigationItemSx(isActive, disabled)}
                  iconSx={getMobileNavigationIconSx(disabled)}
                  textProps={getMobileNavigationTextProps(isActive, disabled)}
                  enabledTooltipPlacement="top"
                  onNavigate={closeMobileNav}
                />
              </ListItem>
            );
          })}
        </List>
      </Drawer>

      <Box
        component="main"
        ref={mainContentRegionRef}
        sx={{
          width: '100%',
          // Global outer page gutter (single source of truth for workspace pages).
          // Uses smaller desktop gutters on wide monitors while keeping clear edge spacing.
          px: { xs: 0, sm: isLowHeightNarrowViewport ? 0 : 2, md: 2.5, lg: 2.25, xl: 2 },
          py: { xs: 1.5, md: 2.5 },
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <Outlet context={{
          setTopbarContextActions,
          setTopbarTitleActions,
          activeSeasonYear,
          activeSeason: activeSeason.activeSeason,
          activeSeasonLoading: activeSeason.loading,
          activeSeasonLoaded: activeSeason.loaded,
          hasSeasons: activeSeason.seasons.length > 0,
          requestSeasonCreation,
          reloadActiveSeason: () => { void activeSeason.reload(); },
          notifications,
        } satisfies RootLayoutOutletContext} />
      </Box>
      </Box>

      <SeasonCreateSuggestionDialog
        controller={activeSeason}
        open={seasonSuggestionDialogOpen}
        onClose={() => setSeasonSuggestionDialogOpen(false)}
        onEditSeasonPattern={() => {
          setSeasonSuggestionDialogOpen(false);
          navigate('/app/project-settings#season-pattern');
        }}
      />

      <ProjectHistoryDialog
        open={projectHistoryOpen}
        items={historyItems}
        isPhonePortrait={isPhonePortrait}
        fallbackActorLabel={fallbackHistoryActorLabel}
        formatTimestamp={formatHistoryTimestamp}
        onClose={() => setProjectHistoryOpen(false)}
        onRestore={(entry) => setPendingRestoreEntry(entry)}
        onRevertBatch={(entry) => setPendingRestoreEntry(entry)}
        t={t}
        tCrops={tCrops}
      />

      {seasonSetupPrompt.status ? (
        <SeasonSetupDialog
          open
          status={seasonSetupPrompt.status}
          onCancel={seasonSetupPrompt.dismiss}
          onApplied={(seasonId) => {
            activeSeason.switchSeason(seasonId);
          }}
        />
      ) : null}

      <HelpDialog open={globalHelpOpen} onClose={closeGlobalHelp} />
      <FeedbackDialog
        open={feedbackDialogOpen}
        projectName={activeMembership?.project_name ?? ''}
        route={`${location.pathname}${location.search}`}
        userEmail={user?.email ?? ''}
        onClose={() => setFeedbackDialogOpen(false)}
      />
      <MobileProjectSwitcherDialog
        open={mobileProjectSwitcherOpen}
        onClose={handleCloseMobileProjectSwitcher}
        activeProjectLabel={activeProjectLabel}
        memberships={memberships}
        activeProjectId={activeProjectId}
        isSwitchingProject={isSwitchingProject}
        onSwitchProject={(projectId) => void handleSwitchProject(projectId)}
        onOpenCreateProject={handleOpenCreateProject}
      />
      <RestoreVersionDialog
        entry={pendingRestoreEntry}
        getEntryTitle={(entry) => getHistoryEntryTitle(entry, tCrops)}
        formatTimestamp={formatHistoryTimestamp}
        tCrops={tCrops}
        onClose={() => setPendingRestoreEntry(null)}
        onConfirm={(historyId) => void handleRestoreProjectVersion(historyId)}
        onConfirmRevertBatch={(batchId) => void handleRevertBatch(batchId)}
      />

      <CreateProjectDialog
        open={isCreateProjectOpen}
        name={newProjectName}
        onNameChange={setNewProjectName}
        isCreating={isCreatingProject}
        onClose={closeCreateProjectDialog}
        onSubmit={handleCreateProjectSubmit}
      />

      <AlertSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        message={snackbar.message}
        severity={snackbar.severity}
        closeText={t('common:actions.close')}
        alertSx={{ width: '100%' }}
        action={snackbar.actionLabel && snackbar.onAction ? (
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setSnackbar((prev) => ({ ...prev, open: false }));
              void snackbar.onAction?.();
            }}
          >
            {snackbar.actionLabel}
          </Button>
        ) : undefined}
      />
    </Box>
  );
}


export default RootLayout;
