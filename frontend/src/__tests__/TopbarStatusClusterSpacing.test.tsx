import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';
import { createAuthStateMock, createTestUser, stubCompactTopbarViewport } from '../test-utils/appHarness';

// The topbar's trailing items (season switcher, project switcher, notification
// bell, "Mehr" overflow menu) intentionally keep the trailing controls tight
// with equal gaps between each neighbour. These tests pin that spacing plus the
// compact topbar, which has its own tighter sub-group and must not inherit the
// desktop values.
const authState = createAuthStateMock();

vi.mock('../auth/useAuth', () => ({ useAuth: () => authState }));

function gapOf(element: Element): number {
  // An unset gap computes to `normal`, which is 0 for flex and grid containers.
  const gap = window.getComputedStyle(element).gap;
  return gap === '' || gap === 'normal' ? 0 : Number.parseFloat(gap);
}

function pixelsOf(element: Element, property: 'marginLeft' | 'paddingLeft' | 'paddingRight' | 'width'): number {
  return Number.parseFloat(window.getComputedStyle(element)[property] || '0');
}

describe('topbar trailing status cluster spacing', () => {
  beforeEach(() => {
    authState.user = createTestUser();
    authState.activeProjectId = 1;
    window.localStorage.clear();
  });

  it('keeps equal gaps between the trailing topbar controls', async () => {
    window.history.pushState({}, '', '/app/crops');
    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    const projectButton = await screen.findByRole('button', { name: 'Aktives Projekt wechseln' }, { timeout: 10000 });
    const cluster = projectButton.parentElement!;
    const overflowGroup = cluster.parentElement!;
    const actionGroup = overflowGroup.previousElementSibling!;

    expect(cluster).toContainElement(screen.getByRole('button', { name: 'Aktive Saison wechseln' }));
    expect(cluster).toContainElement(screen.getByRole('button', { name: /Benachrichtigungen/ }));
    expect(cluster).not.toContainElement(screen.getByRole('button', { name: 'Mehr' }));
    expect(overflowGroup).toContainElement(screen.getByRole('button', { name: 'Mehr' }));

    const seasonButton = screen.getByRole('button', { name: 'Aktive Saison wechseln' });
    const notificationButton = screen.getByRole('button', { name: /Benachrichtigungen/ });

    expect(gapOf(cluster)).toBe(gapOf(overflowGroup));
    expect(pixelsOf(seasonButton, 'paddingLeft')).toBe(8);
    expect(pixelsOf(projectButton, 'paddingLeft')).toBe(8);
    expect(pixelsOf(notificationButton, 'width')).toBe(36);

    // The boundary towards the primary action button is still separate from
    // the neighbour gaps inside the trailing control run.
    expect(gapOf(overflowGroup.parentElement!)).toBe(0);
    expect(pixelsOf(overflowGroup, 'marginLeft')).toBe(10);
    expect(pixelsOf(actionGroup, 'paddingRight')).toBe(4);
  });

  it('leaves the compact topbar spacing untouched', async () => {
    // Deliberately not the crops page: its trailing group uses a
    // page-specific 0.25 gap, which would hide a regression of the shared
    // action-group gap this assertion is meant to catch.
    window.history.pushState({}, '', '/app/dashboard');
    stubCompactTopbarViewport();
    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    // The compact topbar folds the notifications into its overflow menu, so
    // that button carries the notification label as soon as anything is unread.
    const menuButton = await screen.findByRole('button', { name: /Mehr|Benachrichtigung/ }, { timeout: 10000 });
    const compactGroup = menuButton.parentElement!;

    expect(compactGroup).toContainElement(screen.getByRole('button', { name: 'Aktive Saison wechseln' }));
    expect(screen.queryByRole('button', { name: 'Aktives Projekt wechseln' })).not.toBeInTheDocument();
    expect(gapOf(compactGroup)).toBe(2);
    expect(gapOf(compactGroup.parentElement!)).toBe(10);
  });
});
