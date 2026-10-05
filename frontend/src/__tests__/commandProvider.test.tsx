import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo } from 'react';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';
import { useCommandContext, useCommandContextTag, useRegisterCommands } from '../commands/useCommandContext';
import { createRootCommands } from '../commands/commands';
import type { CommandSpec } from '../commands/types';

function CommandFixture({ available }: { available: boolean }): React.ReactElement {
  const commands = useMemo<CommandSpec[]>(() => [
    {
      id: 'fixture.command',
      label: 'Fixture Command',
      group: 'project',
      keywords: ['fixture'],
      shortcutHint: 'Alt+X',
      contextTags: ['global'],
      isEnabled: () => available,
      action: vi.fn(),
    },
  ], [available]);

  useRegisterCommands('fixture', commands);
  return <div>fixture</div>;
}

function RootCommandFixture(props: {
  currentPath?: string;
  onNextPage?: () => void;
  onPreviousPage?: () => void;
  onOpenPalette?: () => void;
  onOpenProjectSettings?: () => void;
  onOpenPageHelp?: () => void;
}): React.ReactElement {
  const { openPalette, openShortcutsHelp } = useCommandContext();
  const commands = useMemo(() => createRootCommands({
    currentPath: props.currentPath ?? '/app/crops',
    activeProjectId: 1,
    memberships: [
      { project_id: 1, project_name: 'Demo' },
      { project_id: 2, project_name: 'Garten' },
    ],
    onNextPage: props.onNextPage ?? vi.fn(),
    onPreviousPage: props.onPreviousPage ?? vi.fn(),
    onOpenProjectSettings: props.onOpenProjectSettings ?? vi.fn(),
    onOpenCreateProject: vi.fn(),
    onSwitchProject: vi.fn(),
    onOpenAccountSettings: vi.fn(),
    onOpenVersionHistory: vi.fn(),
    onLogout: vi.fn(),
    onOpenPalette: props.onOpenPalette ?? openPalette,
    onOpenPageHelp: props.onOpenPageHelp ?? vi.fn(),
    onOpenShortcutsHelp: openShortcutsHelp,
    onToggleSidebar: vi.fn(),
    isSidebarToggleVisible: () => true,
    labels: {
      nextPage: 'Nächste Seite',
      previousPage: 'Vorherige Seite',
      openProjectSettings: 'Projekteinstellungen',
      createProject: 'Projekt erstellen',
      switchProjectPrefix: 'Projekt wechseln',
      openAccountSettings: 'Kontoeinstellungen',
      openVersionHistory: 'Versionsverlauf',
      logout: 'Abmelden',
      openPalette: 'Aktionssuche',
      openPageHelp: 'Seitenhilfe',
      openShortcutsHelp: 'Tastenkürzel anzeigen',
      toggleSidebar: 'Sidebar ein-/ausklappen',
    },
  }), [openPalette, openShortcutsHelp, props.currentPath, props.onNextPage, props.onOpenPalette, props.onOpenProjectSettings, props.onOpenPageHelp, props.onPreviousPage]);

  useRegisterCommands('root', commands);
  return <div>root fixture</div>;
}

describe('CommandProvider', () => {
  beforeEach(() => {
    localStorage.setItem('ofp.shortcutHintSeen', '1');
  });

  it('hides unavailable commands in palette', async () => {
    render(
      <FocusManagerProvider><CommandProvider>
        <CommandFixture available={false} />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: 'k', altKey: true });

    expect(screen.queryByText('Fixture Command')).not.toBeInTheDocument();
  });

  it('shows one-time shortcut hint only once', async () => {
    vi.useFakeTimers();
    localStorage.removeItem('ofp.shortcutHintSeen');

    function FeaturePageFixture(): React.ReactElement {
      useCommandContextTag('crops');
      return <div>feature page</div>;
    }

    const { rerender } = render(
      <FocusManagerProvider><CommandProvider>
        <FeaturePageFixture />
      </CommandProvider></FocusManagerProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(localStorage.getItem('ofp.shortcutHintSeen')).toBe('1');

    rerender(
      <FocusManagerProvider><CommandProvider>
        <div>second</div>
      </CommandProvider></FocusManagerProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(localStorage.getItem('ofp.shortcutHintSeen')).toBe('1');

    vi.useRealTimers();
  });

  it('defers the one-time shortcut hint while a dialog is open, instead of overlapping its buttons', () => {
    // Regression test: the hint used to fire on a fixed timer regardless of
    // what was on screen, and its Snackbar renders above any open MUI
    // Dialog - so it could land right on top of a dialog's action buttons
    // and block clicks on them (this is how a crop-library E2E test ended
    // up hanging on a dialog button it could no longer hit).
    vi.useFakeTimers();
    localStorage.removeItem('ofp.shortcutHintSeen');

    function FeaturePageFixture({ dialogOpen }: { dialogOpen: boolean }): React.ReactElement {
      useCommandContextTag('crops');
      return (
        <div>
          feature page
          {dialogOpen ? <div role="dialog" aria-modal="true">a dialog is open</div> : null}
        </div>
      );
    }

    const { rerender } = render(
      <FocusManagerProvider><CommandProvider>
        <FeaturePageFixture dialogOpen />
      </CommandProvider></FocusManagerProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(localStorage.getItem('ofp.shortcutHintSeen')).toBeNull();
    expect(screen.queryByText(/Command Palette/)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(localStorage.getItem('ofp.shortcutHintSeen')).toBeNull();

    // Once the dialog closes and stays closed, the hint still shows - this
    // guards against a fix that waits forever instead of just deferring.
    rerender(
      <FocusManagerProvider><CommandProvider>
        <FeaturePageFixture dialogOpen={false} />
      </CommandProvider></FocusManagerProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(localStorage.getItem('ofp.shortcutHintSeen')).toBe('1');

    vi.useRealTimers();
  });

  it('shows root shortcut commands but hides direct page navigation entries', () => {
    render(
      <FocusManagerProvider><CommandProvider>
        <RootCommandFixture currentPath="/app/crops" />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: 'k', altKey: true });

    expect(screen.getAllByText('Aktionssuche').length).toBeGreaterThan(0);
    expect(screen.getByText('Seitenhilfe')).toBeInTheDocument();
    expect(screen.getByText('Projekteinstellungen')).toBeInTheDocument();
    expect(screen.getByText('Projekt wechseln: Garten')).toBeInTheDocument();
    expect(screen.getByText('Nächste Seite')).toBeInTheDocument();
        expect(screen.queryByText('Standorte')).not.toBeInTheDocument();
  });

  it('opens the command palette with Alt+K when not typing', () => {
    render(
      <FocusManagerProvider><CommandProvider>
        <RootCommandFixture />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: 'k', altKey: true });

    expect(screen.getByRole('textbox', { name: 'Aktionssuche' })).toBeInTheDocument();
  });

  it('does not open the command palette with Alt+K while typing in an input', () => {
    render(
      <FocusManagerProvider><CommandProvider>
        <RootCommandFixture />
        <input aria-label="focused input" />
      </CommandProvider></FocusManagerProvider>,
    );

    const input = screen.getByRole('textbox', { name: 'focused input' });
    input.focus();
    fireEvent.keyDown(window, { key: 'k', altKey: true });

    expect(screen.queryByRole('textbox', { name: 'Aktionssuche' })).not.toBeInTheDocument();
  });

  it('keeps Ctrl+Shift+Arrow navigation working through root commands', () => {
    const onNextPage = vi.fn();
    render(
      <FocusManagerProvider><CommandProvider>
        <RootCommandFixture onNextPage={onNextPage} />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true, shiftKey: true });

    expect(onNextPage).toHaveBeenCalledTimes(1);
  });

  it('shows project settings as root command without requiring a keyboard shortcut', () => {
    const onOpenProjectSettings = vi.fn();
    render(
      <FocusManagerProvider><CommandProvider>
        <RootCommandFixture onOpenProjectSettings={onOpenProjectSettings} />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: 'k', altKey: true });

    expect(screen.getByText('Projekteinstellungen')).toBeInTheDocument();
    expect(onOpenProjectSettings).toHaveBeenCalledTimes(0);
  });

  it('runs page help shortcut with Alt+H', () => {
    const onOpenPageHelp = vi.fn();
    render(
      <FocusManagerProvider><CommandProvider>
        <RootCommandFixture onOpenPageHelp={onOpenPageHelp} />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: 'h', altKey: true });

    expect(onOpenPageHelp).toHaveBeenCalledTimes(1);
  });

  it('opens the command palette with Ctrl+K, the professional-app convention, alongside the legacy Alt+K', () => {
    render(
      <FocusManagerProvider><CommandProvider>
        <RootCommandFixture />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(screen.getByRole('textbox', { name: 'Aktionssuche' })).toBeInTheDocument();
  });

  it('opens the dynamic shortcuts-help dialog with a bare "?" and only lists assigned shortcuts', () => {
    render(
      <FocusManagerProvider><CommandProvider>
        <RootCommandFixture />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: '?' });

    const actionSearchTitle = screen.getByText('Aktionssuche');
    const basicNavigationTitle = screen.getByText('Grundlegende Navigation');
    expect(actionSearchTitle.compareDocumentPosition(basicNavigationTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText('Aktionssuche')).toHaveLength(1);
    const primaryShortcutSection = actionSearchTitle.closest('section');
    expect(primaryShortcutSection).not.toBeNull();
    expect(within(primaryShortcutSection as HTMLElement).getByText('Ctrl+K')).toBeInTheDocument();
    expect(within(primaryShortcutSection as HTMLElement).getByText('Alt+K')).toBeInTheDocument();
    expect(screen.getByText('Versionsverlauf')).toBeInTheDocument();
    expect(screen.getByText('Alt+V')).toBeInTheDocument();
    expect(screen.getByText('Tastenkürzel anzeigen')).toBeInTheDocument();
    expect(screen.getByText('Seitenspezifische Tastenkürzel')).toBeInTheDocument();
    expect(screen.getByText('Kultur hinzufügen')).toBeInTheDocument();
    expect(screen.getByText('Kultur bearbeiten')).toBeInTheDocument();
    expect(screen.getByText('Anbaukalender')).toBeInTheDocument();
    expect(screen.getByText('Zur aktuellen Periode springen')).toBeInTheDocument();
    expect(screen.getByText('Lieferant hinzufügen')).toBeInTheDocument();
    const globalSection = screen.getByText('Global').closest('section');
    expect(globalSection).not.toBeNull();
    expect(within(globalSection as HTMLElement).queryByText('Aktionssuche')).not.toBeInTheDocument();
    expect(screen.queryByText('Projekteinstellungen')).not.toBeInTheDocument();
    expect(screen.queryByText('Projekt erstellen')).not.toBeInTheDocument();
    expect(screen.queryByText('Projekt wechseln: Garten')).not.toBeInTheDocument();
    expect(screen.queryByText('Kontoeinstellungen')).not.toBeInTheDocument();
    expect(screen.queryByText('Abmelden')).not.toBeInTheDocument();
  });

  it('toggles the sidebar with Ctrl+B through the registered command', () => {
    const onToggleSidebar = vi.fn();
    function Fixture() {
      const commands = useMemo<CommandSpec[]>(() => [
        {
          id: 'view.toggleSidebar',
          label: 'Sidebar ein-/ausklappen',
          group: 'navigation',
          keywords: ['sidebar'],
          shortcutHint: 'Ctrl+B',
          keys: { ctrl: true, key: 'b' },
          contextTags: ['global'],
          action: onToggleSidebar,
        },
      ], []);
      useRegisterCommands('fixture-sidebar', commands);
      return <div>fixture</div>;
    }

    render(
      <FocusManagerProvider><CommandProvider>
        <Fixture />
      </CommandProvider></FocusManagerProvider>,
    );

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });

    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });
});
