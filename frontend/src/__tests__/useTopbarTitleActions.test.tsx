import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopbarContextAction } from '../navigation/topbarTypes';
import { useTopbarTitleActions } from '../hooks/useTopbarTitleActions';

const action = (id: string): TopbarContextAction => ({ id, label: id, onClick: () => {} });

const ACTIONS = [action('save'), action('delete')];
const OTHER_ACTIONS = [action('publish')];

interface Props {
  setActions?: ((actions: TopbarContextAction[]) => void) | undefined;
  actions: TopbarContextAction[];
}

const setup = (initialProps: Props) =>
  renderHook((props: Props) => useTopbarTitleActions(props.setActions, props.actions), { initialProps });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('publishing the page actions', () => {
  it('hands them to the topbar on mount', () => {
    const setActions = vi.fn();

    setup({ setActions, actions: ACTIONS });

    expect(setActions).toHaveBeenCalledWith(ACTIONS);
  });

  it('replaces them when the page changes its actions', () => {
    const setActions = vi.fn();
    const { rerender } = setup({ setActions, actions: ACTIONS });

    rerender({ setActions, actions: OTHER_ACTIONS });

    expect(setActions).toHaveBeenLastCalledWith(OTHER_ACTIONS);
  });

  it('does not republish while the same array is passed', () => {
    // The page rebuilds its actions on every render unless it memoizes them;
    // republishing each time would reset the topbar continuously.
    const setActions = vi.fn();
    const { rerender } = setup({ setActions, actions: ACTIONS });

    rerender({ setActions, actions: ACTIONS });

    expect(setActions).toHaveBeenCalledTimes(1);
  });

  it('republishes for an equal but newly built array', () => {
    // Recorded so the constraint on callers is visible: identity is the only
    // signal available, so a page that builds its action list inline pushes
    // to the topbar on every render.
    const setActions = vi.fn();
    const { rerender } = setup({ setActions, actions: ACTIONS });

    rerender({ setActions, actions: [...ACTIONS] });

    expect(setActions).toHaveBeenCalledTimes(3);
  });
});

describe('clearing up', () => {
  it('empties the topbar when the page leaves', () => {
    // Otherwise the previous page's buttons stay in the topbar of the next.
    const setActions = vi.fn();
    const { unmount } = setup({ setActions, actions: ACTIONS });
    setActions.mockClear();

    unmount();

    expect(setActions).toHaveBeenCalledWith([]);
  });

  it('empties before publishing a replacement', () => {
    // React runs the cleanup of the previous effect before the next one, so
    // the topbar never holds two pages' actions at once.
    const calls: string[] = [];
    const setActions = vi.fn((actions: TopbarContextAction[]) => {
      calls.push(actions.length === 0 ? 'clear' : actions[0].id);
    });
    const { rerender } = setup({ setActions, actions: ACTIONS });

    rerender({ setActions, actions: OTHER_ACTIONS });

    expect(calls).toEqual(['save', 'clear', 'publish']);
  });
});

describe('a page with no topbar to publish to', () => {
  it('does nothing when no setter is given', () => {
    // Not every page renders inside the topbar layout.
    expect(() => setup({ setActions: undefined, actions: ACTIONS })).not.toThrow();
  });

  it('does not try to clear on unmount either', () => {
    const { unmount } = setup({ setActions: undefined, actions: ACTIONS });

    expect(() => unmount()).not.toThrow();
  });

  it('starts publishing once a setter arrives', () => {
    const setActions = vi.fn();
    const { rerender } = setup({ setActions: undefined, actions: ACTIONS });

    rerender({ setActions, actions: ACTIONS });

    expect(setActions).toHaveBeenCalledWith(ACTIONS);
  });

  it('clears through the setter it was given, not a later one', () => {
    // The topbar instance can be swapped out; the cleanup belongs to the one
    // the actions were published to.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = setup({ setActions: first, actions: ACTIONS });

    rerender({ setActions: second, actions: ACTIONS });

    expect(first).toHaveBeenCalledWith([]);
    expect(second).toHaveBeenCalledWith(ACTIONS);
  });
});

describe('an empty action list', () => {
  it('is published like any other', () => {
    // A page that has actions on some rows and none on others must be able
    // to clear the topbar without unmounting.
    const setActions = vi.fn();

    setup({ setActions, actions: [] });

    expect(setActions).toHaveBeenCalledWith([]);
  });
});
