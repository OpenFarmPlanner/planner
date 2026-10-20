import type { ShortcutKeyBinding } from '../hooks/useKeyboardShortcuts';

export type CommandContextTag =
  | 'global'
  | 'crops'
  | 'publicCropLibrary'
  | 'locations'
  | 'areas'
  | 'plans'
  | 'calendar'
  | 'seedDemand'
  | 'youngPlantDemand';

export type CommandGroup = 'project' | 'account' | 'navigation' | 'help';

export interface CreateAction {
  id: string;
  label: string;
  shortcut?: string;
  priority?: number;
  disabled?: boolean;
  hidden?: boolean;
  handler: () => void;
}

export interface CommandSpec {
  id: string;
  label: string;
  keywords: string[];
  group: CommandGroup;
  shortcutHint?: string;
  keys?: ShortcutKeyBinding;
  allowRepeat?: boolean;
  contextTags: CommandContextTag[];
  isVisible?: () => boolean;
  isEnabled?: () => boolean;
  action: () => void | Promise<void>;
}
