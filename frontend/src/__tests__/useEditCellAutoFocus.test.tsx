import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useEditCellAutoFocus } from '../components/data-grid/useEditCellAutoFocus';

interface Props {
  hasFocus: boolean;
  onFocused?: (input: HTMLInputElement) => void;
}

const setup = ({ hasFocus = false, withInput = true }: { hasFocus?: boolean; withInput?: boolean } = {}) => {
  const input = document.createElement('input');
  if (withInput) document.body.append(input);
  const inputRef: RefObject<HTMLInputElement | null> = { current: withInput ? input : null };
  const focus = vi.spyOn(input, 'focus');
  const onFocused = vi.fn();
  const view = renderHook(
    (props: Props) => useEditCellAutoFocus(props.hasFocus, inputRef, props.onFocused),
    { initialProps: { hasFocus, onFocused } as Props },
  );
  return { ...view, input, inputRef, focus, onFocused };
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('taking focus', () => {
  it('focuses the input once the grid says the cell has focus', () => {
    const { focus } = setup({ hasFocus: true });

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not focus while the cell does not have focus', () => {
    // Every edit cell in the row mounts this hook; only the one the grid
    // points at may take focus.
    const { focus } = setup({ hasFocus: false });

    expect(focus).not.toHaveBeenCalled();
  });

  it('focuses when the cell gains focus later', () => {
    // The follow-up callback is passed unchanged across the rerender so the
    // only thing that moved is `hasFocus` -- dropping it would let a changed
    // callback re-run the effect and make this pass for the wrong reason.
    const { focus, rerender, onFocused } = setup({ hasFocus: false });

    rerender({ hasFocus: true, onFocused });

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not refocus on an unrelated re-render', () => {
    // Refocusing would move the caret back to where the browser puts it on
    // focus, undoing the user's cursor position mid-edit.
    //
    // The follow-up callback has to be held stable for that to hold, since it
    // is one of the effect's dependencies -- both callers wrap theirs in
    // useCallback with an empty dependency list. The test below pins what
    // happens when it is not.
    const { focus, rerender, onFocused } = setup({ hasFocus: true });

    rerender({ hasFocus: true, onFocused });

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('refocuses when the follow-up callback is a fresh function', () => {
    // Recorded so the constraint on callers is visible: an inline arrow here
    // would re-run the effect on every render of the row, taking focus again
    // and resetting the caret while the user is typing. Neither caller does
    // this today.
    const { focus, rerender, input } = setup({ hasFocus: true });

    rerender({ hasFocus: true, onFocused: (value: HTMLInputElement) => void value });

    expect(focus).toHaveBeenCalledTimes(2);
    expect(input).toBeInstanceOf(HTMLInputElement);
  });

  it('does nothing when the input is not mounted yet', () => {
    // The ref is filled in by the render that creates the input, so the very
    // first pass can legitimately find nothing.
    const { focus, onFocused } = setup({ hasFocus: true, withInput: false });

    expect(focus).not.toHaveBeenCalled();
    expect(onFocused).not.toHaveBeenCalled();
  });
});

describe('not scrolling while focusing', () => {
  it('asks the browser not to scroll', () => {
    // Documented at the hook: an unguarded focus fights the mobile on-screen
    // keyboard. Tapping a cell scrolls it into view against the pre-keyboard
    // viewport, then the keyboard opens and the browser re-scrolls the
    // focused input against the shrunk one -- two targets a moment apart,
    // which reads as a jump and a correction.
    const { focus } = setup({ hasFocus: true });

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('passes the option rather than calling focus bare', () => {
    // Pinned as the argument itself: `focus()` and `focus({preventScroll:
    // true})` both focus, so only the argument separates them.
    const { focus } = setup({ hasFocus: true });

    expect(focus.mock.calls[0]).toEqual([{ preventScroll: true }]);
  });
});

describe('the follow-up callback', () => {
  it('runs with the focused input', () => {
    // The numeric cells use it to select the existing value so typing
    // replaces it.
    const { onFocused, input } = setup({ hasFocus: true });

    expect(onFocused).toHaveBeenCalledWith(input);
  });

  it('runs after the focus, not before', () => {
    // Selecting a range before the element has focus is discarded by the
    // browser when focus then arrives.
    const order: string[] = [];
    const input = document.createElement('input');
    document.body.append(input);
    vi.spyOn(input, 'focus').mockImplementation(() => { order.push('focus'); });
    const inputRef: RefObject<HTMLInputElement | null> = { current: input };

    renderHook(() => useEditCellAutoFocus(true, inputRef, () => { order.push('onFocused'); }));

    expect(order).toEqual(['focus', 'onFocused']);
  });

  it('is optional', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const focus = vi.spyOn(input, 'focus');
    const inputRef: RefObject<HTMLInputElement | null> = { current: input };

    expect(() => renderHook(() => useEditCellAutoFocus(true, inputRef))).not.toThrow();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not run while the cell does not have focus', () => {
    const { onFocused } = setup({ hasFocus: false });

    expect(onFocused).not.toHaveBeenCalled();
  });

  it('re-runs when the callback itself changes', () => {
    // It is in the dependency list, so a cell that swaps its follow-up gets
    // the new one applied rather than the stale closure.
    const { rerender, input } = setup({ hasFocus: true });
    const replacement = vi.fn();

    rerender({ hasFocus: true, onFocused: replacement });

    expect(replacement).toHaveBeenCalledWith(input);
  });
});
