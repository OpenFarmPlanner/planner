import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonSetupStatus } from '../../api/types';
import { useSeasonSetupPrompt } from '../useSeasonSetupPrompt';

const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));
vi.mock('../../api/api', () => ({ seasonSetupAPI: { status: statusMock } }));

const status = (needsSetup: boolean, unassigned = 3): { data: SeasonSetupStatus } => ({
  data: {
    needs_setup: needsSetup,
    unassigned_planting_plan_count: unassigned,
    start_day: 1,
    start_month: 3,
    computed_start_date: '2026-03-01',
    computed_end_date: '2027-02-28',
  },
});

const PLANNING_ROUTE = '/app/planting-plans';

interface Props {
  activeProjectId: number | null | undefined;
  pathname: string;
}

const setup = (initialProps: Props = { activeProjectId: 1, pathname: PLANNING_ROUTE }) =>
  renderHook(
    (props: Props) => useSeasonSetupPrompt(props.activeProjectId, props.pathname),
    { initialProps },
  );

/**
 * The real `seasonSetupDismissal` module is used rather than a stub, so the
 * per-project storage key is exercised alongside the hook. Storage is cleared
 * between tests since it otherwise leaks a dismissal into the next one.
 */
const dismissalKey = (projectId: number) => `seasonSetupDismissed:${projectId}`;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  statusMock.mockResolvedValue(status(true));
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('prompting', () => {
  it('offers the setup when the project needs it', async () => {
    const { result } = setup();

    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.status?.unassigned_planting_plan_count).toBe(3);
  });

  it('stays closed while the status is still loading', () => {
    // The first render happens before the request resolves; a non-null status
    // there would flash the dialog on every navigation.
    const { result } = setup();

    expect(result.current.status).toBeNull();
  });

  it('stays closed when the project does not need setting up', async () => {
    statusMock.mockResolvedValue(status(false));
    const { result } = setup();

    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(result.current.status).toBeNull();
  });

  it('hands over the whole status, not just the flag', async () => {
    // The dialog renders the computed season dates and the plan count from it.
    const { result } = setup();

    await waitFor(() => expect(result.current.status).toEqual(status(true).data));
  });
});

describe('project-independent routes', () => {
  it.each([
    '/app/account-settings',
    '/app/project-selection',
    '/app/notifications',
    '/app/public-library-moderation',
  ])('does not prompt on %s', async (pathname) => {
    // There is no project to set up on these pages, so the dialog would be
    // asking about something the user cannot see.
    const { result } = setup({ activeProjectId: 1, pathname });

    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(result.current.status).toBeNull();
  });

  it('does not prompt on a sub-route of an exempt page', async () => {
    const { result } = setup({ activeProjectId: 1, pathname: '/app/account-settings/security' });

    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(result.current.status).toBeNull();
  });

  it('does not prompt on an exempt page with a trailing slash', async () => {
    const { result } = setup({ activeProjectId: 1, pathname: '/app/account-settings/' });

    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(result.current.status).toBeNull();
  });

  it('prompts once the user navigates to a project page', async () => {
    // The status was already loaded while they were on the exempt page; only
    // the route was blocking the prompt.
    const { result, rerender } = setup({ activeProjectId: 1, pathname: '/app/account-settings' });
    await waitFor(() => expect(statusMock).toHaveBeenCalled());

    rerender({ activeProjectId: 1, pathname: PLANNING_ROUTE });

    expect(result.current.status).not.toBeNull();
  });

  it('stops prompting when the user navigates to an exempt page', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());

    rerender({ activeProjectId: 1, pathname: '/app/account-settings' });

    expect(result.current.status).toBeNull();
  });

  it('does not refetch on a route change alone', async () => {
    // The status belongs to the project, not to the page.
    const { rerender } = setup();
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1));

    rerender({ activeProjectId: 1, pathname: '/app/crops' });

    expect(statusMock).toHaveBeenCalledTimes(1);
  });
});

describe('without an active project', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('does not ask the API when the project is %s', async (_label, activeProjectId) => {
    setup({ activeProjectId, pathname: PLANNING_ROUTE });

    expect(statusMock).not.toHaveBeenCalled();
  });

  it('stays closed', () => {
    const { result } = setup({ activeProjectId: null, pathname: PLANNING_ROUTE });

    expect(result.current.status).toBeNull();
  });

  it('clears a status loaded for a project that is being left', async () => {
    // Switching to "no project" must not leave the previous project's dialog
    // on screen.
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());

    rerender({ activeProjectId: null, pathname: PLANNING_ROUTE });

    expect(result.current.status).toBeNull();
  });

  it('loads once a project becomes active', async () => {
    const { result, rerender } = setup({ activeProjectId: null, pathname: PLANNING_ROUTE });

    rerender({ activeProjectId: 1, pathname: PLANNING_ROUTE });

    await waitFor(() => expect(result.current.status).not.toBeNull());
  });
});

describe('dismissing', () => {
  it('closes the dialog', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());

    act(() => result.current.dismiss());

    expect(result.current.status).toBeNull();
  });

  it('remembers the dismissal for this project', async () => {
    // Persisted rather than held in React state: the original bug was that a
    // page reload brought the dialog straight back.
    const { result } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());

    act(() => result.current.dismiss());

    expect(window.sessionStorage.getItem(dismissalKey(1))).toBe('true');
  });

  it('starts dismissed when this project was already dismissed', async () => {
    // The stored value is read twice over -- once by the `useState`
    // initializer and again by the mount effect -- but only the effect's read
    // is observable. `status` is still null on the first render, so
    // `shouldPrompt` is false whatever the initializer produced, and the
    // effect has overwritten it by the time a status exists. The initializer
    // is kept as the honest initial value rather than removed.
    window.sessionStorage.setItem(dismissalKey(1), 'true');
    const { result } = setup();

    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(result.current.status).toBeNull();
  });

  it('records the dismissal under the project that is actually active', async () => {
    const { result } = setup({ activeProjectId: 7, pathname: PLANNING_ROUTE });
    await waitFor(() => expect(result.current.status).not.toBeNull());

    act(() => result.current.dismiss());

    expect(window.sessionStorage.getItem(dismissalKey(7))).toBe('true');
    expect(window.sessionStorage.getItem(dismissalKey(1))).toBeNull();
  });

  it('records the dismissal under the project the user switched to', async () => {
    // The callback captures the project id, so one built for the previous
    // project would file the dismissal under it -- leaving the new project
    // prompting forever and silently suppressing the old one.
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());

    rerender({ activeProjectId: 2, pathname: PLANNING_ROUTE });
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
    act(() => result.current.dismiss());

    expect(window.sessionStorage.getItem(dismissalKey(2))).toBe('true');
    expect(window.sessionStorage.getItem(dismissalKey(1))).toBeNull();
  });

  it('does not carry a dismissal across projects', async () => {
    // Each project has its own unassigned plans, so declining for one says
    // nothing about the next.
    window.sessionStorage.setItem(dismissalKey(1), 'true');
    const { result, rerender } = setup();
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(result.current.status).toBeNull();

    rerender({ activeProjectId: 2, pathname: PLANNING_ROUTE });

    await waitFor(() => expect(result.current.status).not.toBeNull());
  });

  it('keeps a dismissal when returning to that project', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());
    act(() => result.current.dismiss());

    rerender({ activeProjectId: 2, pathname: PLANNING_ROUTE });
    await waitFor(() => expect(result.current.status).not.toBeNull());
    rerender({ activeProjectId: 1, pathname: PLANNING_ROUTE });

    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(3));
    expect(result.current.status).toBeNull();
  });

  it('stays dismissed across a route change', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());
    act(() => result.current.dismiss());

    rerender({ activeProjectId: 1, pathname: '/app/crops' });

    expect(result.current.status).toBeNull();
  });

  it('does nothing to storage without an active project', () => {
    const { result } = setup({ activeProjectId: null, pathname: PLANNING_ROUTE });

    act(() => result.current.dismiss());

    expect(window.sessionStorage.length).toBe(0);
  });

  it('survives storage being unavailable', async () => {
    // Private browsing: the dismissal simply does not outlive the render,
    // and the dialog stays usable.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());

    expect(() => act(() => result.current.dismiss())).not.toThrow();
    expect(result.current.status).toBeNull();
    setItem.mockRestore();
  });

  it('keeps a stable identity while the project does not change', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());
    const before = result.current.dismiss;

    rerender({ activeProjectId: 1, pathname: '/app/crops' });

    expect(result.current.dismiss).toBe(before);
  });
});

describe('failures', () => {
  it('stays closed and logs rather than throwing', async () => {
    // A failed status means the app cannot tell whether setup is needed, and
    // guessing "yes" would open a dialog over a project that is already set up.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    statusMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(result.current.status).toBeNull();
  });

  it('keeps the previous project\'s dialog closed when the next status fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.status).not.toBeNull());
    statusMock.mockRejectedValue(new Error('offline'));

    rerender({ activeProjectId: 2, pathname: PLANNING_ROUTE });

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(result.current.status?.needs_setup).toBe(true);
  });
});

describe('a status that is no longer wanted', () => {
  it('ignores one that resolves after the component is gone', async () => {
    let settle!: (value: unknown) => void;
    statusMock.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    const { unmount } = setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    unmount();
    await act(async () => {
      settle(status(true));
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps the newer project when an older status resolves last', async () => {
    // Switching projects faster than the network answers: the first project's
    // status must not decide what the second one shows.
    let settleFirst!: (value: unknown) => void;
    statusMock.mockReturnValue(new Promise((resolve) => { settleFirst = resolve; }));
    const { result, rerender } = setup();
    let settleSecond!: (value: unknown) => void;
    statusMock.mockReturnValue(new Promise((resolve) => { settleSecond = resolve; }));

    rerender({ activeProjectId: 2, pathname: PLANNING_ROUTE });
    await act(async () => {
      settleSecond(status(false));
      await Promise.resolve();
    });
    await act(async () => {
      settleFirst(status(true));
      await Promise.resolve();
    });

    expect(result.current.status).toBeNull();
  });
});
