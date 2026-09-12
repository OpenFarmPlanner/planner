import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GlobalMenu } from '../navigation/GlobalMenu';

const labels: Record<string, string> = {
  'project.settings': 'Projekteinstellungen',
  'commandPalette.commands.openVersionHistory': 'Versionsverlauf öffnen',
  accountSettings: 'Kontoeinstellungen',
  'globalMenu.shortcuts': 'Tastenkürzel',
  'globalMenu.pageHelp': 'Hilfe zu dieser Seite',
  'globalMenu.pageHelpUnavailable': 'Für diese Seite ist keine spezifische Hilfe verfügbar.',
  'globalMenu.appHelp': 'App-Hilfe',
  'globalMenu.feedback': 'Feedback geben',
  'globalMenu.feedbackNewBadge': 'NEU',
  'commandPalette.commands.logout': 'Abmelden',
  'language.label': 'Sprache',
  'projectSwitcher.ariaLabel': 'Aktives Projekt wechseln',
  'project.create': 'Neues Projekt',
  'common:disabledReasons.busy': 'Aktion wird gerade verarbeitet.',
};

const t = (key: string) => labels[key] ?? key;

const baseProps = {
  open: true,
  historyLoading: false,
  userLabel: 'test@example.com',
  isMobile: false,
  onClose: vi.fn(),
  onOpenProjectSwitcher: vi.fn(),
  onOpenCreateProject: vi.fn(),
  onOpenProjectSettings: vi.fn(),
  onOpenProjectHistory: vi.fn(async () => undefined),
  onOpenAccountSettings: vi.fn(),
  onOpenShortcuts: vi.fn(),
  onOpenHelp: vi.fn(),
  onOpenFeedback: vi.fn(),
  canLeaveDemoProject: false,
  isGuestDemoSession: false,
  onLeaveDemoProject: vi.fn(async () => undefined),
  onLogout: vi.fn(async () => undefined),
  t,
};

describe('GlobalMenu (desktop)', () => {
  it('keeps the global menu scoped to project, account, and application settings', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(<GlobalMenu {...baseProps} anchorEl={anchor} />);

    const menuItems = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(menuItems).toEqual([
      'Projekteinstellungen',
      'Versionsverlauf öffnen',
      'Kontoeinstellungen',
      'Sprache',
      'Tastenkürzel',
      'App-Hilfe',
      'Feedback geben',
      'Abmelden test@example.com',
    ]);

    const menu = screen.getByRole('menu');
    const separators = menu.querySelectorAll('hr');
    expect(separators).toHaveLength(3);
  });

  it('does not show crop library moderation in the global menu', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(<GlobalMenu {...baseProps} anchorEl={anchor} />);

    expect(screen.queryByRole('menuitem', { name: 'Kulturbibliothek moderieren' })).not.toBeInTheDocument();
  });

  it('explains why project history is temporarily disabled', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(<GlobalMenu {...baseProps} anchorEl={anchor} historyLoading />);

    const historyItem = screen.getByRole('menuitem', { name: 'Versionsverlauf öffnen' });
    expect(historyItem).toHaveAttribute('aria-disabled', 'true');
    await userEvent.hover(historyItem.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Aktion wird gerade verarbeitet.');
  });
});

describe('GlobalMenu (mobile) "Hilfe zu dieser Seite" entry', () => {
  it('is not shown at all when the caller does not wire up page help', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(<GlobalMenu {...baseProps} isMobile anchorEl={anchor} />);

    expect(screen.queryByRole('menuitem', { name: 'Hilfe zu dieser Seite' })).not.toBeInTheDocument();
  });

  it('sits directly above "App-Hilfe" and is clickable when page help is available', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const onOpenPageHelp = vi.fn();

    render(
      <GlobalMenu {...baseProps} isMobile anchorEl={anchor} onOpenPageHelp={onOpenPageHelp} pageHelpAvailable />,
    );

    const labelsInOrder = screen.getAllByRole('menuitem').map((item) => item.textContent);
    const pageHelpIndex = labelsInOrder.indexOf('Hilfe zu dieser Seite');
    expect(pageHelpIndex).toBeGreaterThan(-1);
    expect(labelsInOrder[pageHelpIndex + 1]).toBe('App-Hilfe');

    const item = screen.getByRole('menuitem', { name: 'Hilfe zu dieser Seite' });
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('is disabled with an explanatory tooltip when the current page has no page-specific help', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const onOpenPageHelp = vi.fn();

    render(
      <GlobalMenu {...baseProps} isMobile anchorEl={anchor} onOpenPageHelp={onOpenPageHelp} pageHelpAvailable={false} />,
    );

    const item = screen.getByRole('menuitem', { name: 'Hilfe zu dieser Seite' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    await userEvent.hover(item.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Für diese Seite ist keine spezifische Hilfe verfügbar.');
  });
});

describe('GlobalMenu "Feedback geben" entry', () => {
  it('sits directly below "App-Hilfe" and opens the feedback dialog', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const onOpenFeedback = vi.fn();
    const onClose = vi.fn();

    render(<GlobalMenu {...baseProps} anchorEl={anchor} onOpenFeedback={onOpenFeedback} onClose={onClose} />);

    const labelsInOrder = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labelsInOrder[labelsInOrder.indexOf('App-Hilfe') + 1]).toBe('Feedback geben');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Feedback geben' }));
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the "NEU" badge only until it has been marked as seen', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    const { rerender } = render(<GlobalMenu {...baseProps} anchorEl={anchor} showFeedbackNewBadge />);
    expect(screen.getByRole('menuitem', { name: /Feedback geben/ }).textContent).toContain('NEU');

    rerender(<GlobalMenu {...baseProps} anchorEl={anchor} showFeedbackNewBadge={false} />);
    expect(screen.getByRole('menuitem', { name: /Feedback geben/ }).textContent).not.toContain('NEU');
  });

  it('is also available in the mobile menu', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(<GlobalMenu {...baseProps} isMobile anchorEl={anchor} />);

    const labelsInOrder = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labelsInOrder[labelsInOrder.indexOf('App-Hilfe') + 1]).toBe('Feedback geben');
  });
});
