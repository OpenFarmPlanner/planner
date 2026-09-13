import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { useCropListKeyboardNavigation } from '../useCropListKeyboardNavigation';

type Navigation = ReturnType<typeof useCropListKeyboardNavigation<Row>>;

/** Filled in on every render so tests can call the hook's own functions. */
const navigationRef: { current: Navigation | null } = { current: null };

const navigation = (): Navigation => {
  if (!navigationRef.current) throw new Error('harness not rendered');
  return navigationRef.current;
};

interface Row {
  id: number | string | null;
  label: string;
}

const ROWS: Row[] = [
  { id: 1, label: 'Möhre' },
  { id: 2, label: 'Zwiebel' },
  { id: 3, label: 'Kohlrabi' },
];

interface HarnessProps {
  items?: Row[];
  selectedId?: number | string | null;
  autoFocusSelected?: boolean;
  onSelect?: (item: Row) => void;
  /** Rows the list pretends are still hidden behind a collapsed parent. */
  hiddenIds?: (number | string)[];
  /**
   * Whether selecting a row also moves the harness's own selection, as the
   * real list does. Turning it off isolates what `selectItem` does from what
   * the follow-up render's mount effect does.
   */
  trackSelection?: boolean;
}

/**
 * A real list rather than a bare `renderHook`: the hook hands out `ref`
 * callbacks and then reads focus and scroll off the elements they register,
 * so nothing about focus movement is observable without actual DOM nodes
 * mounted through those refs.
 *
 * `hiddenIds` models the case the hook's two retries exist for -- a row that
 * is not mounted yet because a collapsed parent is about to expand.
 */
function Harness({
  items = ROWS,
  selectedId = null,
  autoFocusSelected = false,
  onSelect,
  hiddenIds = [],
  trackSelection = true,
}: HarnessProps) {
  const [selected, setSelected] = useState<number | string | null>(selectedId ?? null);
  const navigationValue = useCropListKeyboardNavigation<Row>({
    items,
    selectedId: selected,
    getId: (item) => item.id,
    onSelect: (item) => {
      onSelect?.(item);
      if (trackSelection && item.id !== null) setSelected(item.id);
    },
    autoFocusSelected,
  });
  const navigation = navigationValue;

  // `selectItem` and `focusItem` are part of what the hook returns and are
  // called directly by the crop list (a click on a row, a programmatic jump),
  // so the harness has to reach them rather than only the keyboard path.
  // Published from an effect rather than during render, which writing to a
  // module-level object from the render body is not allowed to do.
  useEffect(() => {
    navigationRef.current = navigation;
  });

  return (
    <div data-testid="list" role="listbox" {...navigation.getListProps()}>
      {items
        .filter((item) => item.id === null || !hiddenIds.includes(item.id))
        .map((item) => {
          const { ref, ...props } = navigation.getItemProps(item);
          return (
            <div key={String(item.id)} ref={ref} {...props} data-testid={`row-${item.id}`}>
              {item.label}
            </div>
          );
        })}
    </div>
  );
}

const row = (id: number | string) => screen.getByTestId(`row-${id}`);
const rows = () => screen.getAllByRole('option');

/** Every mounted row's scrollIntoView, which jsdom does not implement. */
const stubScroll = () => {
  const calls: string[] = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    calls.push(this.getAttribute('data-testid') ?? '');
  };
  return calls;
};

const press = (element: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { element.dispatchEvent(event); });
  return event;
};

/** Lets the hook's requestAnimationFrame follow-ups run. */
const flushFrames = async (count = 2) => {
  for (let index = 0; index < count; index += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(16); });
  }
};

let scrollCalls: string[];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  scrollCalls = stubScroll();
  navigationRef.current = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('item props', () => {
  it('marks every row as an option', () => {
    render(<Harness />);

    expect(rows()).toHaveLength(3);
  });

  it('marks only the selected row as selected', () => {
    render(<Harness selectedId={2} />);

    expect(row(2)).toHaveAttribute('aria-selected', 'true');
    expect(row(1)).toHaveAttribute('aria-selected', 'false');
  });

  it('gives each row a distinct dom id', () => {
    render(<Harness />);

    const ids = rows().map((element) => element.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every(Boolean)).toBe(true);
  });

  it('strips characters that are not valid in a dom id', () => {
    // Crop ids can be composite strings like "species:12/variety"; an id
    // containing a slash or colon breaks any selector built from it.
    render(<Harness items={[{ id: 'species:12/variety', label: 'Möhre' }]} />);

    expect(rows()[0].id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(rows()[0].id).toContain('species-12-variety');
  });

  it('gives a row without an id no dom id at all', () => {
    render(<Harness items={[{ id: null, label: 'Kein Eintrag' }]} />);

    expect(rows()[0].id).toBe('');
  });

  it('does not call a row without an id selected when nothing is selected', () => {
    // Both sides are null, so a bare equality check would report the row as
    // the current selection and announce it to a screen reader as such.
    render(<Harness items={[{ id: null, label: 'Kein Eintrag' }]} />);

    expect(rows()[0]).toHaveAttribute('aria-selected', 'false');
  });
});

describe('the roving tab stop', () => {
  it('puts the only tab stop on the selected row', () => {
    // One tab stop for the whole list, so Tab moves past it rather than
    // through every crop.
    render(<Harness selectedId={2} />);

    expect(rows().map((element) => element.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('falls back to the first row when nothing is selected', () => {
    render(<Harness />);

    expect(rows().map((element) => element.tabIndex)).toEqual([0, -1, -1]);
  });

  it('falls back to the first row when the selection is not in the list', () => {
    // A crop selected before a filter was applied is still the selection, but
    // it has no row to carry the tab stop.
    render(<Harness selectedId={404} />);

    expect(rows().map((element) => element.tabIndex)).toEqual([0, -1, -1]);
  });

  it('leaves a list of id-less rows with no tab stop at all', () => {
    // The fallback walks to the first row, but a row without an id cannot
    // carry the tab stop -- so the list has none rather than an invalid one.
    render(<Harness items={[{ id: null, label: 'Eins' }, { id: null, label: 'Zwei' }]} />);

    expect(rows().map((element) => element.tabIndex)).toEqual([-1, -1]);
  });

  it('renders nothing for an empty list', () => {
    render(<Harness items={[]} />);

    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('never gives the tab stop to a row without an id', () => {
    render(<Harness items={[{ id: null, label: 'Kein Eintrag' }, ...ROWS]} />);

    expect(rows()[0].tabIndex).toBe(-1);
  });
});

describe('arrow navigation', () => {
  it('moves down to the next row', async () => {
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    press(row(1), 'ArrowDown');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it('moves up to the previous row', async () => {
    const onSelect = vi.fn();
    render(<Harness selectedId={2} onSelect={onSelect} />);

    press(row(2), 'ArrowUp');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[0]);
  });

  it('jumps to the first row on Home', async () => {
    const onSelect = vi.fn();
    render(<Harness selectedId={3} onSelect={onSelect} />);

    press(row(3), 'Home');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[0]);
  });

  it('jumps to the last row on End', async () => {
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    press(row(1), 'End');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[2]);
  });

  it('stops at the last row rather than wrapping', async () => {
    // Wrapping in a long crop list loses the user's place entirely.
    const onSelect = vi.fn();
    render(<Harness selectedId={3} onSelect={onSelect} />);

    press(row(3), 'ArrowDown');
    await flushFrames();

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stops at the first row rather than wrapping', async () => {
    // The clamp matters twice over: without it the index goes to -1, which
    // selects nothing *and* leaves the keypress with no row to focus, so the
    // list goes dead instead of staying on its first row.
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);
    row(3).focus();

    press(row(1), 'ArrowUp');
    await flushFrames();

    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row(1));
  });

  it('still moves focus when it has nowhere further to select', async () => {
    // The row stays selected, but the keypress must not feel dead: focus is
    // put back on it so the next arrow continues from there.
    render(<Harness selectedId={3} />);
    row(1).focus();

    press(row(3), 'ArrowDown');
    await flushFrames();

    expect(document.activeElement).toBe(row(3));
  });

  it('starts at the top when nothing is selected or focused', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    press(screen.getByTestId('list'), 'ArrowDown');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[0]);
  });

  it('starts at the bottom for ArrowUp when nothing is selected', async () => {
    // Symmetry with the case above: an up-arrow into an unpositioned list
    // enters it from the end.
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    press(screen.getByTestId('list'), 'ArrowUp');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[2]);
  });

  it('does nothing in an empty list', () => {
    // Also guarded further down, where the computed index finds no row and
    // the move is abandoned -- so the explicit check at the top cannot change
    // the outcome on its own. Kept for the same reason as the one above.
    const onSelect = vi.fn();
    render(<Harness items={[]} onSelect={onSelect} />);

    press(screen.getByTestId('list'), 'ArrowDown');

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('focus wins over selection', () => {
  it('continues from the focused first row rather than the selection', async () => {
    // Index 0 is the case a truthiness check on the focused index gets
    // wrong: the first row is a real position, not "no position".
    const onSelect = vi.fn();
    render(<Harness selectedId={3} onSelect={onSelect} />);

    press(row(1), 'ArrowDown');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it('continues from the focused row, not the selected one', async () => {
    // A list can hold rows that take focus without changing the selection --
    // a Kultur group header with no general entry of its own. Moving on from
    // such a row has to continue where the focus is.
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    press(row(3), 'ArrowUp');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it('uses the selection when the event came from the list itself', async () => {
    // A keypress on the container has no row target, so the selection is the
    // only position available.
    //
    // The list-level handler asks `getFocusedItemId` which row the event came
    // from, but that lookup can only ever answer "none" in practice: a key
    // pressed on a row is handled by the row's own handler, which stops the
    // event before it reaches the list. Its element-matching branches -- the
    // `contains` check for a keypress on something inside a row, and the
    // guard against a non-element target -- are therefore unreachable as the
    // list is wired today, and are left as they are rather than given a
    // fixture that would make them look load-bearing.
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    press(screen.getByTestId('list'), 'ArrowDown');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it('finds the row from a keypress on something inside it', async () => {
    // The rows render their own content; a key pressed on a chip or a button
    // inside a row still belongs to that row.
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);
    const inner = document.createElement('span');
    row(3).append(inner);

    press(inner, 'ArrowUp');
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });
});

describe('keys the list does not take', () => {
  it.each(['Tab', 'Enter', 'a', 'PageDown', 'ArrowLeft', 'ArrowRight'])(
    'ignores %s',
    (key) => {
      const onSelect = vi.fn();
      render(<Harness selectedId={1} onSelect={onSelect} />);

      const event = press(row(1), key);

      expect(onSelect).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it.each([
    ['alt', { altKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
  ])('ignores an arrow held with %s', (_name, init) => {
    // Those combinations belong to the browser and the window manager.
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    const event = press(row(1), 'ArrowDown', init);

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('takes shift-arrow, since the list has no range selection to protect', async () => {
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    press(row(1), 'ArrowDown', { shiftKey: true });
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
  });

  it('leaves an event another handler already claimed', () => {
    // An inner control that has handled the key itself marks the event; the
    // list must not act on it a second time.
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);
    const claimed = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    claimed.preventDefault();

    act(() => { row(1).dispatchEvent(claimed); });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('claims the keys it does take, so the page does not scroll', () => {
    const event = (() => {
      render(<Harness selectedId={1} />);
      return press(row(1), 'ArrowDown');
    })();

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('focus after a move', () => {
  it('puts focus on the newly selected row', async () => {
    render(<Harness selectedId={1} />);

    press(row(1), 'ArrowDown');
    await flushFrames();

    expect(document.activeElement).toBe(row(2));
  });

  it('scrolls the newly selected row into view', async () => {
    render(<Harness selectedId={1} />);
    scrollCalls.length = 0;

    press(row(1), 'ArrowDown');
    await flushFrames();

    expect(scrollCalls).toContain('row-2');
  });

  it('waits for the row to exist before focusing it', async () => {
    // The selected row can still be behind a collapsed parent that the
    // selection itself expands, so the focus is retried on a later frame
    // rather than dropped.
    const { rerender } = render(<Harness selectedId={1} hiddenIds={[2]} />);

    press(row(1), 'ArrowDown');
    await act(async () => { await vi.advanceTimersByTimeAsync(16); });
    rerender(<Harness selectedId={2} hiddenIds={[]} />);
    await flushFrames();

    expect(screen.queryByTestId('row-2')).not.toBeNull();
  });
});

describe('focusing the selected row on mount', () => {
  it('focuses it when asked to', () => {
    // Arriving from a deep link: the list opens with the linked crop under
    // the keyboard rather than at the top.
    render(<Harness selectedId={2} autoFocusSelected />);

    expect(document.activeElement).toBe(row(2));
  });

  it('only scrolls when auto-focus is off', () => {
    // The default: the crop list must not steal focus from the search field
    // the user is typing in.
    render(<Harness selectedId={2} />);

    expect(document.activeElement).not.toBe(row(2));
    expect(scrollCalls).toContain('row-2');
  });

  it('does nothing at all without a selection', () => {
    // The early return is belt and braces: with no selection the registry
    // lookups below it find nothing either, so removing it changes no
    // outcome. It states the intent at the top instead of relying on two
    // optional chains further down.
    render(<Harness autoFocusSelected />);

    expect(scrollCalls).toEqual([]);
  });

  it('retries on the next frame when the row is not mounted yet', async () => {
    // Same collapsed-parent case as above, on the initial render: another
    // effect expands the parent in the same commit, so the row appears only
    // after this one has already run.
    const { rerender } = render(<Harness selectedId={2} autoFocusSelected hiddenIds={[2]} />);
    expect(screen.queryByTestId('row-2')).toBeNull();

    rerender(<Harness selectedId={2} autoFocusSelected hiddenIds={[]} />);
    await flushFrames();

    expect(document.activeElement).toBe(row(2));
  });
});

describe('focusItem', () => {
  it('scrolls the row into view as well as focusing it', () => {
    // Focusing alone leaves a row that is off-screen focused but unseen,
    // which is exactly the case a long crop list produces.
    render(<Harness selectedId={1} />);
    scrollCalls.length = 0;

    act(() => navigation().focusItem(3));

    expect(document.activeElement).toBe(row(3));
    expect(scrollCalls).toContain('row-3');
  });

  it('does nothing for an id the list does not have', () => {
    render(<Harness selectedId={1} />);
    row(1).focus();

    act(() => navigation().focusItem(404));

    expect(document.activeElement).toBe(row(1));
  });

  it('does nothing for a row that has since left the list', () => {
    // The ref cleanup takes the element out of the registry. Without it the
    // detached node stays reachable and gets scrolled and focused -- the
    // scroll is what shows it, since focusing a node that is no longer in the
    // document is a no-op in the browser and so proves nothing either way.
    const { rerender } = render(<Harness selectedId={1} />);
    rerender(<Harness selectedId={1} items={ROWS.slice(0, 2)} />);
    row(1).focus();
    scrollCalls.length = 0;

    act(() => navigation().focusItem(3));

    expect(scrollCalls).toEqual([]);
    expect(document.activeElement).toBe(row(1));
  });
});

describe('selectItem', () => {
  it('selects the row and moves focus to it', async () => {
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    act(() => navigation().selectItem(ROWS[2]));
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[2]);
    expect(document.activeElement).toBe(row(3));
  });

  it('can select without taking focus', async () => {
    // A click already put focus where the user meant it; stealing it back
    // onto the row would undo that.
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    act(() => navigation().selectItem(ROWS[2], false));
    await flushFrames();

    expect(onSelect).toHaveBeenCalledWith(ROWS[2]);
    expect(document.activeElement).not.toBe(row(3));
  });

  it('scrolls the row into view even when it does not take focus', async () => {
    // The selection is invisible if the row is off-screen, so the scroll is
    // the part that has to happen either way.
    //
    // `onSelect` deliberately does not move the harness's own selection here:
    // when it does, the mount effect scrolls the newly selected row on the
    // next commit and hides whether `selectItem` scrolled at all.
    render(<Harness selectedId={1} trackSelection={false} />);
    scrollCalls.length = 0;

    act(() => navigation().selectItem(ROWS[2], false));
    await flushFrames();

    expect(scrollCalls).toContain('row-3');
  });

  it('ignores a row with no id', () => {
    // Nothing to focus or scroll to afterwards, so the selection would leave
    // the list in a state it cannot act on.
    const onSelect = vi.fn();
    render(<Harness selectedId={1} onSelect={onSelect} />);

    act(() => navigation().selectItem({ id: null, label: 'Kein Eintrag' }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('retries on a later frame when the row is not mounted yet', async () => {
    // The row can be behind a collapsed parent that this very selection
    // expands, so it appears a commit or two after onSelect ran. One frame is
    // not enough; the second retry is what actually lands the focus.
    const { rerender } = render(<Harness selectedId={1} hiddenIds={[3]} />);

    act(() => navigation().selectItem(ROWS[2]));
    await act(async () => { await vi.advanceTimersByTimeAsync(16); });
    rerender(<Harness selectedId={3} hiddenIds={[]} />);
    await flushFrames();

    expect(document.activeElement).toBe(row(3));
  });
});

describe('the ref registry', () => {
  it('forgets a row that leaves the list', async () => {
    // Otherwise a stale element would keep answering focus moves for an id
    // that is no longer rendered.
    const { rerender } = render(<Harness selectedId={1} />);
    const removed = row(3);

    rerender(<Harness selectedId={1} items={ROWS.slice(0, 2)} />);
    press(row(1), 'End');
    await flushFrames();

    expect(document.activeElement).not.toBe(removed);
    expect(document.activeElement).toBe(row(2));
  });

  it('picks up a row that appears later', async () => {
    const { rerender } = render(<Harness selectedId={1} items={ROWS.slice(0, 2)} />);

    rerender(<Harness selectedId={1} items={ROWS} />);
    press(row(1), 'End');
    await flushFrames();

    expect(document.activeElement).toBe(row(3));
  });
});
