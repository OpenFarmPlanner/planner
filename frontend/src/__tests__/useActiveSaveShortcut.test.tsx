import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveSaveShortcut } from '../hooks/useActiveSaveShortcut';

interface Props {
  enabled?: boolean;
  disabled?: boolean;
  activeElement?: HTMLElement | null;
}

const setup = ({ enabled = true, disabled = false, activeElement }: Props = {}) => {
  const element = activeElement === undefined ? document.createElement('div') : activeElement;
  if (element) document.body.append(element);
  const onSave = vi.fn();
  const getActiveElement = vi.fn(() => element);
  const view = renderHook(
    (props: Required<Omit<Props, 'activeElement'>>) => useActiveSaveShortcut({
      enabled: props.enabled,
      disabled: props.disabled,
      getActiveElement,
      onSave,
    }),
    { initialProps: { enabled, disabled } },
  );
  return { ...view, onSave, getActiveElement, element };
};

const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true, ...init,
  });
  act(() => { window.dispatchEvent(event); });
  return event;
};

const save = (init: KeyboardEventInit = {}) => press('s', { ctrlKey: true, ...init });

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('saving', () => {
  it('saves on Ctrl+S', () => {
    const { onSave } = setup();

    save();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('saves on Cmd+S', () => {
    // The same shortcut on macOS, where Ctrl is not the modifier.
    const { onSave } = setup();

    press('s', { metaKey: true });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('accepts the uppercase key a shifted or capslocked keyboard sends', () => {
    // Caps lock does not mean a different shortcut.
    const { onSave } = setup();

    press('S', { ctrlKey: true });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('stops the browser from opening its own save dialog', () => {
    const event = (() => { setup(); return save(); })();

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('when it stays out of the way', () => {
  it('ignores a plain s, so typing is unaffected', () => {
    const { onSave } = setup();

    const event = press('s');

    expect(onSave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores Ctrl+Shift+S, which is Save As', () => {
    const { onSave } = setup();

    const event = save({ shiftKey: true });

    expect(onSave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores Ctrl+Alt+S', () => {
    const { onSave } = setup();

    const event = save({ altKey: true });

    expect(onSave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores another key held with Ctrl', () => {
    const { onSave } = setup();

    press('a', { ctrlKey: true });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('does nothing at all while not enabled', () => {
    // The page that owns the shortcut is not the one on screen.
    const { onSave } = setup({ enabled: false });

    const event = save();

    expect(onSave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves the browser dialog alone when nothing is being edited', () => {
    // No active row means there is nothing of ours to save, so the keypress
    // is none of our business and Ctrl+S should do what it normally does.
    const { onSave } = setup({ activeElement: null });

    const event = save();

    expect(onSave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('when a save is not currently possible', () => {
  it('does not save but still claims the key', () => {
    // A row that is open but invalid: the browser's save dialog would be a
    // confusing answer to the user's Ctrl+S, so the key is swallowed even
    // though nothing is saved.
    const { onSave } = setup({ disabled: true });

    const event = save();

    expect(onSave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('saves again once the row becomes valid', () => {
    const { onSave, rerender } = setup({ disabled: true });
    save();
    expect(onSave).not.toHaveBeenCalled();

    rerender({ enabled: true, disabled: false });
    save();

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('a held key', () => {
  it('does not save repeatedly', () => {
    // Holding Ctrl+S would otherwise fire a save per repeat and send a burst
    // of identical requests.
    const { onSave } = setup();

    save();
    save({ repeat: true });
    save({ repeat: true });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('still claims each repeat', () => {
    // Letting a repeat through would open the browser's dialog partway into
    // a held shortcut.
    setup();

    const event = save({ repeat: true });

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('listener lifecycle', () => {
  it('listens before anything else can stop the event', () => {
    // Registered in the capture phase: an editor inside the row may stop
    // propagation of its own keydown, and the save shortcut has to win.
    const { onSave } = setup();
    const inner = document.createElement('input');
    document.body.append(inner);
    inner.addEventListener('keydown', (event) => event.stopPropagation());

    act(() => {
      inner.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's', ctrlKey: true, bubbles: true, cancelable: true,
      }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('stops listening on unmount', () => {
    const { onSave, unmount } = setup();

    unmount();
    save();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('stops listening once it is switched off', () => {
    const { onSave, rerender } = setup();

    rerender({ enabled: false, disabled: false });
    save();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not stack listeners across re-renders', () => {
    // A duplicate listener would save twice per keypress.
    const { onSave, rerender } = setup();

    rerender({ enabled: true, disabled: false });
    rerender({ enabled: true, disabled: false });
    save();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('asks for the active element at keypress time', () => {
    // The row being edited changes while the listener stays registered, so
    // reading it once at subscribe time would save the wrong row.
    const { getActiveElement } = setup();

    save();

    expect(getActiveElement).toHaveBeenCalledTimes(1);
  });

  it('does not ask for the active element for an unrelated key', () => {
    // The lookup walks the grid; doing it on every keystroke while the user
    // types would be wasteful.
    const { getActiveElement } = setup();

    press('a');

    expect(getActiveElement).not.toHaveBeenCalled();
  });
});
