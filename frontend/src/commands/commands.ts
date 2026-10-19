import type { CommandSpec } from './types';

export interface RootCommandFactoryOptions {
  currentPath: string;
  activeProjectId: number | null;
  memberships: { project_id: number; project_name: string }[];
  onNextPage: () => void;
  onPreviousPage: () => void;
  onOpenProjectSettings: () => void;
  onOpenCreateProject: () => void;
  onSwitchProject: (projectId: number) => void | Promise<void>;
  onOpenAccountSettings: () => void;
  onOpenVersionHistory: () => void | Promise<void>;
  onLeaveDemoProject?: () => void | Promise<void>;
  onLogout?: () => void | Promise<void>;
  onOpenPalette: () => void;
  onOpenPageHelp: () => void;
  onOpenShortcutsHelp: () => void;
  onToggleSidebar: () => void;
  isSidebarToggleVisible: () => boolean;
  labels: {
    nextPage: string;
    previousPage: string;
    openProjectSettings: string;
    createProject: string;
    switchProjectPrefix: string;
    openAccountSettings: string;
    openVersionHistory: string;
    leaveDemo?: string;
    logout: string;
    openPalette: string;
    openPageHelp: string;
    openShortcutsHelp: string;
    toggleSidebar: string;
  };
}

export const SHORTCUTS_HELP_HINT = '?';

export function getVisibleCommands(commands: CommandSpec[]): CommandSpec[] {
  return commands.filter((command) => command.isVisible?.() ?? true);
}

export function getEnabledCommands(commands: CommandSpec[]): CommandSpec[] {
  return commands.filter((command) => command.isEnabled?.() ?? true);
}

export function getRunnableCommands(commands: CommandSpec[]): CommandSpec[] {
  return getEnabledCommands(getVisibleCommands(commands));
}

export function createRootCommands(options: RootCommandFactoryOptions): CommandSpec[] {
  const switchableMemberships = options.memberships.filter((membership) => membership.project_id !== options.activeProjectId);

  const projectCommands: CommandSpec[] = [
    {
      id: 'project.settings',
      label: options.labels.openProjectSettings,
      keywords: ['projekt', 'einstellungen', 'verwaltung'],
      group: 'project',
      contextTags: ['global'],
      isVisible: () => options.activeProjectId !== null,
      action: options.onOpenProjectSettings,
    },
    {
      id: 'project.create',
      label: options.labels.createProject,
      keywords: ['projekt', 'neu', 'erstellen'],
      group: 'project',
      contextTags: ['global'],
      action: options.onOpenCreateProject,
    },
    ...switchableMemberships.map<CommandSpec>((membership) => ({
      id: `project.switch.${membership.project_id}`,
      label: `${options.labels.switchProjectPrefix}: ${membership.project_name}`,
      keywords: ['projekt', 'wechseln', 'umschalten', membership.project_name],
      group: 'project',
      contextTags: ['global'],
      action: () => options.onSwitchProject(membership.project_id),
    })),
  ];

  const accountCommands: CommandSpec[] = [
    {
      id: 'account.settings',
      label: options.labels.openAccountSettings,
      keywords: ['konto', 'account', 'einstellungen'],
      group: 'account',
      contextTags: ['global'],
      action: options.onOpenAccountSettings,
    },
    {
      id: 'account.versionHistory',
      label: options.labels.openVersionHistory,
      keywords: ['versionen', 'verlauf', 'historie', 'projekt'],
      group: 'account',
      shortcutHint: 'Alt+V',
      keys: { alt: true, key: 'v' },
      contextTags: ['global'],
      isVisible: () => options.activeProjectId !== null,
      action: options.onOpenVersionHistory,
    },
    ...(options.onLeaveDemoProject && options.labels.leaveDemo ? [{
      id: 'account.leaveDemo',
      label: options.labels.leaveDemo,
      keywords: ['demo', 'verlassen', 'zurück'],
      group: 'account',
      contextTags: ['global'],
      action: options.onLeaveDemoProject,
    } satisfies CommandSpec] : []),
    ...(options.onLogout ? [{
      id: 'account.logout',
      label: options.labels.logout,
      keywords: ['logout', 'abmelden', 'konto'],
      group: 'account',
      contextTags: ['global'],
      action: options.onLogout,
    } satisfies CommandSpec] : []),
  ];

  const navigationCommands: CommandSpec[] = [
    {
      id: 'navigation.nextPage',
      label: options.labels.nextPage,
      keywords: ['seite', 'nächste', 'navigation', 'weiter'],
      group: 'navigation',
      shortcutHint: 'Ctrl+Shift+↓',
      keys: { ctrl: true, shift: true, key: 'ArrowDown' },
      contextTags: ['global'],
      action: options.onNextPage,
    },
    {
      id: 'navigation.previousPage',
      label: options.labels.previousPage,
      keywords: ['seite', 'vorherige', 'navigation', 'zurück'],
      group: 'navigation',
      shortcutHint: 'Ctrl+Shift+↑',
      keys: { ctrl: true, shift: true, key: 'ArrowUp' },
      contextTags: ['global'],
      action: options.onPreviousPage,
    },
    {
      id: 'navigation.toggleSidebar',
      label: options.labels.toggleSidebar,
      keywords: ['sidebar', 'seitenleiste', 'ein-', 'ausklappen'],
      group: 'navigation',
      shortcutHint: 'Ctrl+B',
      keys: { ctrl: true, key: 'b' },
      contextTags: ['global'],
      isVisible: options.isSidebarToggleVisible,
      action: options.onToggleSidebar,
    },
  ];

  const helpCommands: CommandSpec[] = [
    {
      id: 'help.openPalette',
      label: options.labels.openPalette,
      keywords: ['aktionssuche', 'palette', 'befehl', 'hilfe', 'suche'],
      group: 'help',
      // Ctrl+K is the convention most professional apps (VS Code, Slack,
      // Linear, GitHub) use for "search/command everywhere" — kept as the
      // primary hint, with the app's original Alt+K still working.
      shortcutHint: 'Ctrl+K / Alt+K',
      keys: [{ ctrl: true, key: 'k' }, { alt: true, key: 'k' }],
      contextTags: ['global'],
      action: options.onOpenPalette,
    },
    {
      id: 'help.openPageHelp',
      label: options.labels.openPageHelp,
      keywords: ['seitenhilfe', 'hilfe'],
      group: 'help',
      shortcutHint: 'Alt+H',
      keys: { alt: true, key: 'h' },
      contextTags: ['global'],
      action: options.onOpenPageHelp,
    },
    {
      id: 'help.openShortcutsHelp',
      label: options.labels.openShortcutsHelp,
      keywords: ['tastenkürzel', 'shortcuts', 'hilfe'],
      group: 'help',
      shortcutHint: SHORTCUTS_HELP_HINT,
      keys: { key: '?' },
      contextTags: ['global'],
      action: options.onOpenShortcutsHelp,
    },
  ];

  return [...projectCommands, ...accountCommands, ...navigationCommands, ...helpCommands];
}
