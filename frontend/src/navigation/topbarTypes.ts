import type { NotificationsController } from '../notifications/useNotifications';
import type { Season } from '../api/types';
import type { ReactNode } from 'react';

/**
 * Shared types for the topbar action contract between the root layout and pages.
 *
 * Pages publish contextual actions into the persistent topbar via the outlet
 * context; the root layout renders them. Kept in a standalone module so pages
 * and hooks do not need to import the (heavy) root layout component.
 */

export interface TopbarContextAction {
  id: string;
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  shortcutHint?: string;
  active?: boolean;
  hidden?: boolean;
  reserveSpace?: boolean;
  groupId?: string;
  tooltip?: string;
  /**
   * 'segmented' (default) renders the compact pill style used for toggle groups and
   * quick topbar actions. 'standard' renders the app's standard outlined secondary
   * button (same border/color/typography/height/padding as DetailPageActions) for
   * standalone actions that should read as a normal secondary action, not a pill.
   */
  appearance?: 'segmented' | 'standard';
  menuActions?: Array<{ id: string; label: string; onClick: () => void; disabled?: boolean; destructive?: boolean }>;
  /** Small numeric badge rendered on the action's button, e.g. a pending-items count. Omitted/0 shows no badge. */
  badgeContent?: number;
}

export interface RootLayoutOutletContext {
  setTopbarContextActions: (actions: TopbarContextAction[]) => void;
  setTopbarTitleActions: (actions: TopbarContextAction[]) => void;
  /** Extra labelled controls placed beside title actions, or together in a shared wrapped row. */
  setTopbarWorkspaceControls?: (controls: ReactNode) => void;
  /** Start year of the currently active season, once loaded; null while loading or without a project/season. */
  activeSeasonYear: number | null;
  /** The currently active season, once loaded; null while loading or without a project/season. */
  activeSeason: Season | null;
  /** Seasons available in the active project, including the origin of a plan read from another season. */
  projectSeasons?: readonly Season[];
  switchActiveSeason?: (seasonId: number, destination?: string) => void;
  /** Whether the root layout is currently loading seasons for the active project. */
  activeSeasonLoading: boolean;
  /** Whether the active project's season list has completed its first load. */
  activeSeasonLoaded: boolean;
  /** The season list could not be loaded. */
  activeSeasonError?: string | null;
  /** True when the active project already has at least one season. */
  hasSeasons: boolean;
  /** Opens the shared suggested-season creation dialog. */
  requestSeasonCreation: () => void;
  /** Opens the topbar's existing season picker. */
  requestSeasonSelection?: () => void;
  /**
   * Re-fetches the active project's seasons and the due-season suggestion.
   * Call after something outside the season list changes what the suggestion
   * derives from (e.g. editing the season pattern in project settings).
   */
  reloadActiveSeason: () => void;
  /**
   * The single notification controller the topbar owns. Handed to pages so the
   * notification history page marks rows read through the same state the bell's
   * unread badge reads from, instead of a second copy that would drift.
   */
  notifications: NotificationsController;
}
