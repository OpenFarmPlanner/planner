import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearchExpandedGroups } from '../useSearchExpandedGroups';

/**
 * A stand-in for the crop list's expand state: the hook reads it through
 * `isExpanded` and writes it through `ensureExpanded`/`collapse`, so keeping
 * the three consistent is what makes "the user closed it again" expressible.
 * Wiring `isExpanded` to a fixed value instead would let a group be opened
 * twice without the test noticing.
 *
 * The set is replaced rather than mutated, and `setup` builds a fresh
 * `isExpanded` closure over the current one on every render. That is what the
 * callers do -- each passes an inline `(rowId) => expandedRows.has(rowId)`
 * over its own React state -- and it matters: an `isExpanded` that read one
 * long-lived mutable set would always look current, hiding whether the hook
 * keeps its own copy of the predicate up to date.
 */
const createExpandState = (initiallyExpanded: string[] = []) => {
  const store = { expanded: new Set(initiallyExpanded) as ReadonlySet<string> };
  const expand = (rowId: string) => {
    store.expanded = new Set(store.expanded).add(rowId);
  };
  const remove = (rowId: string) => {
    const next = new Set(store.expanded);
    next.delete(rowId);
    store.expanded = next;
  };
  return {
    get expanded() { return store.expanded; },
    snapshotIsExpanded: () => {
      const snapshot = store.expanded;
      return (rowId: string) => snapshot.has(rowId);
    },
    ensureExpanded: vi.fn(expand),
    collapse: vi.fn(remove),
    /** Toggles the user performed, which must not go through the spies. */
    userCollapse: remove,
    userExpand: expand,
  };
};

type ExpandState = ReturnType<typeof createExpandState>;

interface Props {
  matchedGroupRowIds: ReadonlySet<string>;
  keepExpandedRowIds?: ReadonlySet<string>;
}

const NO_MATCHES: ReadonlySet<string> = new Set<string>();

const setup = (state: ExpandState, initialProps: Props = { matchedGroupRowIds: NO_MATCHES }) =>
  renderHook(
    (props: Props) => useSearchExpandedGroups({
      matchedGroupRowIds: props.matchedGroupRowIds,
      isExpanded: state.snapshotIsExpanded(),
      ensureExpanded: state.ensureExpanded,
      collapse: state.collapse,
      keepExpandedRowIds: props.keepExpandedRowIds,
    }),
    { initialProps },
  );

let state: ExpandState;

beforeEach(() => {
  state = createExpandState();
});

describe('opening on a hit', () => {
  it('opens a closed group that starts matching', () => {
    const { rerender } = setup(state);

    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    expect(state.ensureExpanded).toHaveBeenCalledWith('kultur-1');
    expect(state.expanded.has('kultur-1')).toBe(true);
  });

  it('opens every group in the hit set', () => {
    const { rerender } = setup(state);

    rerender({ matchedGroupRowIds: new Set(['kultur-1', 'kultur-2']) });

    expect(state.ensureExpanded.mock.calls.map(([id]) => id).sort())
      .toEqual(['kultur-1', 'kultur-2']);
  });

  it('opens a group already matching on the very first render', () => {
    // Arriving on the page with a search term already in the URL.
    setup(state, { matchedGroupRowIds: new Set(['kultur-1']) });

    expect(state.ensureExpanded).toHaveBeenCalledWith('kultur-1');
  });

  it('leaves a group the user had already opened alone', () => {
    // It is theirs, not the search's -- which is what makes it safe from the
    // clearing pass later.
    state = createExpandState(['kultur-1']);
    const { rerender } = setup(state);

    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    expect(state.ensureExpanded).not.toHaveBeenCalled();
  });

  it('opens a group only once while it keeps matching', () => {
    const matched = new Set(['kultur-1']);
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: matched });

    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    expect(state.ensureExpanded).toHaveBeenCalledTimes(1);
  });

  it('does not reopen a group the user closed while it still matches', () => {
    // The whole reason handled groups are remembered separately from the
    // expanded set: re-deriving from expansion would fight the user on every
    // keystroke, since the set no longer holds a group they just closed.
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    state.userCollapse('kultur-1');
    // Cleared so the assertion below covers the pass under test only -- the
    // opening call from the line above would otherwise satisfy it.
    state.ensureExpanded.mockClear();

    rerender({ matchedGroupRowIds: new Set(['kultur-1', 'kultur-2']) });

    expect(state.ensureExpanded).toHaveBeenCalledExactlyOnceWith('kultur-2');
    expect(state.expanded.has('kultur-1')).toBe(false);
  });

  it('opens a newly matching group on the same pass as an old one drops out', () => {
    // The two passes are disjoint by construction -- the drop-out pass skips
    // anything still matching, and the hit pass skips anything already
    // handled -- so running them in the other order gives the same result.
    // Recorded rather than asserted: there is no input that separates them.
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    state.ensureExpanded.mockClear();

    rerender({ matchedGroupRowIds: new Set(['kultur-2']) });

    expect(state.collapse).toHaveBeenCalledWith('kultur-1');
    expect(state.ensureExpanded).toHaveBeenCalledWith('kultur-2');
  });
});

describe('closing when a group stops matching', () => {
  it('closes a group it opened itself', () => {
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.collapse).toHaveBeenCalledWith('kultur-1');
    expect(state.expanded.has('kultur-1')).toBe(false);
  });

  it('leaves a group the user had opened before searching', () => {
    // Clearing the field must return the list to exactly how they left it,
    // which means not closing anything the search did not open.
    state = createExpandState(['kultur-1']);
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.collapse).not.toHaveBeenCalled();
    expect(state.expanded.has('kultur-1')).toBe(true);
  });

  it('does not close a group the user already closed themselves', () => {
    // Closing an already-closed group is not harmful, but it would move the
    // grid's expand state and with it the scroll position.
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    state.userCollapse('kultur-1');
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.collapse).toHaveBeenCalledWith('kultur-1');
  });

  it('closes only the groups that dropped out', () => {
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1', 'kultur-2']) });

    rerender({ matchedGroupRowIds: new Set(['kultur-2']) });

    expect(state.collapse).toHaveBeenCalledExactlyOnceWith('kultur-1');
    expect(state.expanded.has('kultur-2')).toBe(true);
  });

  it('closes every auto-opened group when the field is cleared', () => {
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1', 'kultur-2', 'kultur-3']) });

    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.collapse.mock.calls.map(([id]) => id).sort())
      .toEqual(['kultur-1', 'kultur-2', 'kultur-3']);
  });

  it('does not close the same group twice', () => {
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    rerender({ matchedGroupRowIds: NO_MATCHES });

    rerender({ matchedGroupRowIds: new Set(['kultur-2']) });

    expect(state.collapse).toHaveBeenCalledExactlyOnceWith('kultur-1');
  });
});

describe('a group that matches again later', () => {
  it('is opened again as a fresh hit', () => {
    // Dropping out forgets the group, which is what lets a later hit reopen
    // it -- otherwise typing past a group and back would leave it shut.
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    rerender({ matchedGroupRowIds: NO_MATCHES });
    state.ensureExpanded.mockClear();

    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    expect(state.ensureExpanded).toHaveBeenCalledWith('kultur-1');
  });

  it('is opened again even after the user had closed it', () => {
    // The user's close applied to that search. A new one starts over.
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    state.userCollapse('kultur-1');
    rerender({ matchedGroupRowIds: NO_MATCHES });
    state.ensureExpanded.mockClear();

    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    expect(state.ensureExpanded).toHaveBeenCalledWith('kultur-1');
  });

  it('can be closed again after being reopened', () => {
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    rerender({ matchedGroupRowIds: NO_MATCHES });
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    state.collapse.mockClear();

    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.collapse).toHaveBeenCalledWith('kultur-1');
  });

  it('is left alone on the second hit if the user opened it in between', () => {
    // Between the two searches the group became the user's, so the second
    // search must not adopt it and close it afterwards.
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    rerender({ matchedGroupRowIds: NO_MATCHES });
    state.userExpand('kultur-1');
    state.ensureExpanded.mockClear();
    state.collapse.mockClear();

    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.ensureExpanded).not.toHaveBeenCalled();
    expect(state.collapse).not.toHaveBeenCalled();
    expect(state.expanded.has('kultur-1')).toBe(true);
  });
});

describe('groups pinned open', () => {
  it('is not closed when it drops out of the results', () => {
    // The group holding the current selection: closing it would hide the row
    // while the detail view still shows it.
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    rerender({
      matchedGroupRowIds: NO_MATCHES,
      keepExpandedRowIds: new Set(['kultur-1']),
    });

    expect(state.collapse).not.toHaveBeenCalled();
    expect(state.expanded.has('kultur-1')).toBe(true);
  });

  it('is still opened on a hit, since pinning only blocks closing', () => {
    const { rerender } = setup(state);

    rerender({
      matchedGroupRowIds: new Set(['kultur-1']),
      keepExpandedRowIds: new Set(['kultur-1']),
    });

    expect(state.ensureExpanded).toHaveBeenCalledWith('kultur-1');
  });

  it('protects only the pinned group', () => {
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1', 'kultur-2']) });

    rerender({
      matchedGroupRowIds: NO_MATCHES,
      keepExpandedRowIds: new Set(['kultur-1']),
    });

    expect(state.collapse).toHaveBeenCalledExactlyOnceWith('kultur-2');
  });

  it('is read at the moment the group drops out, not when it was opened', () => {
    // The selection can move onto a group after the search already opened it.
    const { rerender } = setup(state, {
      matchedGroupRowIds: new Set(['kultur-1']),
      keepExpandedRowIds: NO_MATCHES,
    });

    rerender({
      matchedGroupRowIds: NO_MATCHES,
      keepExpandedRowIds: new Set(['kultur-1']),
    });

    expect(state.collapse).not.toHaveBeenCalled();
  });

  it('stops protecting once the selection moves away', () => {
    const { rerender } = setup(state, {
      matchedGroupRowIds: new Set(['kultur-1']),
      keepExpandedRowIds: new Set(['kultur-1']),
    });
    rerender({
      matchedGroupRowIds: new Set(['kultur-1']),
      keepExpandedRowIds: NO_MATCHES,
    });

    rerender({ matchedGroupRowIds: NO_MATCHES, keepExpandedRowIds: NO_MATCHES });

    expect(state.collapse).toHaveBeenCalledWith('kultur-1');
  });

  it('is forgotten when it drops out, so a later hit reopens it', () => {
    // Protection stops the close but must not also cancel the forgetting --
    // otherwise a pinned group would never be reopened by a later search.
    const { rerender } = setup(state, {
      matchedGroupRowIds: new Set(['kultur-1']),
      keepExpandedRowIds: new Set(['kultur-1']),
    });
    rerender({ matchedGroupRowIds: NO_MATCHES, keepExpandedRowIds: new Set(['kultur-1']) });
    state.userCollapse('kultur-1');
    state.ensureExpanded.mockClear();

    rerender({ matchedGroupRowIds: new Set(['kultur-1']), keepExpandedRowIds: NO_MATCHES });

    expect(state.ensureExpanded).toHaveBeenCalledWith('kultur-1');
  });

  it('defaults to protecting nothing when no pinned set is given', () => {
    const { rerender } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.collapse).toHaveBeenCalledWith('kultur-1');
  });
});

describe('reading the live expand state', () => {
  it('sees an expansion the user made since the last search pass', () => {
    // Each render hands the hook a new `isExpanded` closed over that render's
    // expand state. The hook keeps its own copy and has to refresh it, or it
    // decides with the state as it stood when the search last changed -- and
    // would then adopt a group the user had opened in the meantime, only to
    // close it again when the search clears.
    const { rerender } = setup(state);
    state.userExpand('kultur-1');

    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    expect(state.ensureExpanded).not.toHaveBeenCalled();
  });

  it('does not close a group it wrongly believed it had opened', () => {
    // The consequence of the above, one step further on: the group must
    // survive the search being cleared.
    const { rerender } = setup(state);
    state.userExpand('kultur-1');
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.collapse).not.toHaveBeenCalled();
    expect(state.expanded.has('kultur-1')).toBe(true);
  });
});

describe('what does and does not re-run the effect', () => {
  it('does not re-run when only the expand state changed', () => {
    // `isExpanded` is read as current state at the moment a group is handled,
    // rather than listed as a trigger, so an expand or collapse does not by
    // itself start another pass.
    //
    // Note this is a cost choice, not a correctness one: the handled-groups
    // memory already makes a repeated pass a no-op, so widening the
    // dependency list would not change any outcome in this suite. What it
    // would change is how often the pass runs -- once per search change
    // instead of once per toggle, on a list that re-renders per keystroke.
    const matched = new Set(['kultur-1']);
    const { rerender } = setup(state, { matchedGroupRowIds: matched });
    state.userCollapse('kultur-1');

    rerender({ matchedGroupRowIds: matched });

    expect(state.ensureExpanded).toHaveBeenCalledTimes(1);
  });

  it('does not re-run when only the pinned set changed', () => {
    const matched = new Set(['kultur-1']);
    const { rerender } = setup(state, { matchedGroupRowIds: matched });
    state.collapse.mockClear();

    rerender({ matchedGroupRowIds: matched, keepExpandedRowIds: new Set(['kultur-2']) });

    expect(state.collapse).not.toHaveBeenCalled();
    expect(state.ensureExpanded).toHaveBeenCalledTimes(1);
  });

  it('re-runs on a new set with the same contents', () => {
    // The crop list rebuilds the set per keystroke, so identity is the only
    // signal available -- and re-running has to be harmless, which the
    // handled-groups memory is what makes true.
    const { rerender } = setup(state, { matchedGroupRowIds: new Set(['kultur-1']) });

    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });

    expect(state.ensureExpanded).toHaveBeenCalledTimes(1);
    expect(state.collapse).not.toHaveBeenCalled();
  });

  it('does nothing at all while no search is running', () => {
    const { rerender } = setup(state);

    rerender({ matchedGroupRowIds: NO_MATCHES });

    expect(state.ensureExpanded).not.toHaveBeenCalled();
    expect(state.collapse).not.toHaveBeenCalled();
  });

  it('leaves the groups open when the component unmounts mid-search', () => {
    // Navigating away should not thrash the expand state on the way out; the
    // list is about to be gone anyway.
    const { rerender, unmount } = setup(state);
    rerender({ matchedGroupRowIds: new Set(['kultur-1']) });
    state.collapse.mockClear();

    unmount();

    expect(state.collapse).not.toHaveBeenCalled();
  });
});
