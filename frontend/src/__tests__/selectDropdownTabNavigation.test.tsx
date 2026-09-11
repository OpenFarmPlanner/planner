import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useOpenSelectTabNavigation,
} from '../components/inputs/selectDropdownTabNavigation';
import type { SelectMenuKeyboardEvent } from '../components/inputs/selectDropdownTabNavigation';
import type { SelectTypeaheadOption } from '../components/inputs/selectTypeahead';

const OPTIONS: SelectTypeaheadOption<number>[] = [
  { value: 1, label: 'Bingenheimer' },
  { value: 2, label: 'Sativa' },
  { value: 3, label: 'Gesperrt', disabled: true },
  { value: 4, label: 'Versteckt', hidden: true },
];

/**
 * Builds the DOM MUI actually renders: a form (or dialog) holding the Select
 * trigger and its neighbours, plus a listbox in a detached portal linked to the
 * trigger only through `aria-controls`.
 */
const buildDom = ({ scope = 'form' }: { scope?: 'form' | 'dialog' | 'none' } = {}) => {
  const root = document.createElement('div');
  const container = document.createElement(scope === 'form' ? 'form' : 'div');
  if (scope === 'dialog') {
    container.setAttribute('role', 'dialog');
  }

  const before = document.createElement('input');
  before.id = 'before';
  const trigger = document.createElement('div');
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', 'listbox-1');
  trigger.tabIndex = 0;
  const after = document.createElement('input');
  after.id = 'after';

  container.append(before, trigger, after);
  if (scope === 'none') {
    root.append(before, trigger, after);
  } else {
    root.append(container);
  }

  const listbox = document.createElement('ul');
  listbox.id = 'listbox-1';
  const optionElements = OPTIONS.map((option) => {
    const element = document.createElement('li');
    element.setAttribute('role', 'option');
    element.setAttribute('data-value', String(option.value));
    element.tabIndex = -1;
    if (option.disabled) {
      element.setAttribute('aria-disabled', 'true');
    }
    listbox.append(element);
    return element;
  });

  root.append(listbox);
  document.body.append(root);
  return { root, trigger, listbox, optionElements, before, after };
};

const keyEvent = (
  listbox: HTMLElement,
  overrides: Partial<SelectMenuKeyboardEvent> = {},
): SelectMenuKeyboardEvent => ({
  key: 'Tab',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  currentTarget: listbox as HTMLUListElement,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  nativeEvent: { stopImmediatePropagation: vi.fn() },
  ...overrides,
} as unknown as SelectMenuKeyboardEvent);

const setup = (props: Partial<Parameters<typeof useOpenSelectTabNavigation<number>>[0]> = {}) => {
  const onSelect = vi.fn();
  const onKeyDown = vi.fn();
  const { result } = renderHook(() => useOpenSelectTabNavigation<number>({
    options: OPTIONS, onSelect, onKeyDown, ...props,
  }));
  return { handle: result.current, onSelect, onKeyDown };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useOpenSelectTabNavigation — Tab commits the highlighted option', () => {
  it('selects the option the user had highlighted', () => {
    // MUI closes the menu on Tab but keeps the highlight unapplied, so Tab
    // reads as "nothing happened" without this.
    const dom = buildDom();
    const { handle, onSelect } = setup();
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox)));

    expect(onSelect).toHaveBeenCalledWith(2, expect.anything(), OPTIONS[1]);
  });

  it('selects nothing when no option is highlighted', () => {
    const dom = buildDom();
    const { handle, onSelect } = setup();

    act(() => handle(keyEvent(dom.listbox)));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores a highlight that sits outside this listbox', () => {
    // Two selects can be mounted at once; only the focused one's menu counts.
    const dom = buildDom();
    const stray = document.createElement('li');
    stray.setAttribute('role', 'option');
    stray.setAttribute('data-value', '2');
    stray.tabIndex = -1;
    document.body.append(stray);
    stray.focus();
    const { handle, onSelect } = setup();

    act(() => handle(keyEvent(dom.listbox)));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('refuses to commit a disabled option', () => {
    const dom = buildDom();
    const { handle, onSelect } = setup();
    dom.optionElements[2].focus();

    act(() => handle(keyEvent(dom.listbox)));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('refuses to commit a hidden option', () => {
    // Hidden options stay in the list for typeahead but must not be reachable.
    const dom = buildDom();
    const { handle, onSelect } = setup();
    dom.optionElements[3].focus();

    act(() => handle(keyEvent(dom.listbox)));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('commits nothing for a highlight that matches no known option', () => {
    const dom = buildDom();
    dom.optionElements[0].setAttribute('data-value', '999');
    const { handle, onSelect } = setup();
    dom.optionElements[0].focus();

    act(() => handle(keyEvent(dom.listbox)));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves a multi-select alone, since its menu stays open', () => {
    // Silently toggling the highlighted option on the way out would be
    // surprising when the user is still picking.
    const dom = buildDom();
    const { handle, onSelect } = setup({ multiple: true });
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox)));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('finds the highlight from a child element inside the option', () => {
    // MUI puts the focus on an inner node in some option layouts.
    const dom = buildDom();
    const inner = document.createElement('span');
    inner.tabIndex = -1;
    dom.optionElements[1].append(inner);
    const { handle, onSelect } = setup();
    inner.focus();

    act(() => handle(keyEvent(dom.listbox)));

    expect(onSelect).toHaveBeenCalledWith(2, expect.anything(), OPTIONS[1]);
  });
});

describe('useOpenSelectTabNavigation — Tab moves focus on', () => {
  it('lands on the field after the trigger', () => {
    const dom = buildDom();
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox)));
    act(() => { vi.runAllTimers(); });

    expect(document.activeElement).toBe(dom.after);
  });

  it('lands on the field before the trigger for Shift+Tab', () => {
    const dom = buildDom();
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox, { shiftKey: true })));
    act(() => { vi.runAllTimers(); });

    expect(document.activeElement).toBe(dom.before);
  });

  it('moves focus after committing the selection, not instead of it', () => {
    const dom = buildDom();
    const { handle, onSelect } = setup();
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox)));
    act(() => { vi.runAllTimers(); });

    expect(onSelect).toHaveBeenCalled();
    expect(document.activeElement).toBe(dom.after);
  });

  it('defers the focus move, because MUI restores focus while closing', () => {
    // A focus call made synchronously would be overwritten again by MUI's own
    // restore, which is why the move runs from a timeout in an effect.
    const dom = buildDom();
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox)));

    expect(document.activeElement).not.toBe(dom.after);
  });

  it('stops at the end of a plain form rather than cycling back to its start', () => {
    // A page form is not a focus scope: Tab has to be able to leave it.
    const dom = buildDom();
    dom.after.remove();
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox)));
    act(() => { vi.runAllTimers(); });

    expect(document.activeElement).not.toBe(dom.before);
  });

  it('wraps to the first field inside a dialog, which owns its focus order', () => {
    const dom = buildDom({ scope: 'dialog' });
    dom.after.remove();
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox)));
    act(() => { vi.runAllTimers(); });

    expect(document.activeElement).toBe(dom.before);
  });

  it('does nothing when the trigger is in no scope at all', () => {
    const dom = buildDom({ scope: 'none' });
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox)));
    expect(() => act(() => { vi.runAllTimers(); })).not.toThrow();
    expect(document.activeElement).not.toBe(dom.after);
  });

  it('does nothing when no trigger claims this listbox', () => {
    const dom = buildDom();
    dom.trigger.removeAttribute('aria-controls');
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox)));
    expect(() => act(() => { vi.runAllTimers(); })).not.toThrow();
  });

  it('picks the trigger that names this listbox, not just any open one', () => {
    // Two selects can be open at once in a dialog. The decoy is inserted first,
    // so a lookup that ignored aria-controls would find it instead and move
    // focus around the wrong field.
    const dom = buildDom();
    const decoy = document.createElement('div');
    decoy.setAttribute('role', 'combobox');
    decoy.setAttribute('aria-expanded', 'true');
    decoy.setAttribute('aria-controls', 'listbox-other');
    decoy.tabIndex = 0;
    document.body.insertBefore(decoy, document.body.firstChild);
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox)));
    act(() => { vi.runAllTimers(); });

    expect(document.activeElement).toBe(dom.after);
  });

  it('ignores a collapsed combobox when matching the listbox', () => {
    // A second, closed select could otherwise claim this menu.
    const dom = buildDom();
    dom.trigger.setAttribute('aria-expanded', 'false');
    const { handle } = setup();

    act(() => handle(keyEvent(dom.listbox)));
    act(() => { vi.runAllTimers(); });

    expect(document.activeElement).not.toBe(dom.after);
  });
});

describe('useOpenSelectTabNavigation — keys it leaves alone', () => {
  it.each([
    ['Alt+Tab', { altKey: true }],
    ['Ctrl+Tab', { ctrlKey: true }],
    ['Meta+Tab', { metaKey: true }],
  ])('does not hijack %s, which belongs to the OS or browser', (_label, modifiers) => {
    const dom = buildDom();
    const { handle, onSelect } = setup();
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox, modifiers)));
    act(() => { vi.runAllTimers(); });

    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(dom.after);
  });

  it.each(['ArrowDown', 'Escape', 'a'])('leaves %s to MUI', (key) => {
    const dom = buildDom();
    const { handle, onSelect } = setup();
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox, { key })));
    act(() => { vi.runAllTimers(); });

    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(dom.after);
  });

  it('always forwards the event to the caller first', () => {
    const dom = buildDom();
    const { handle, onKeyDown } = setup();

    act(() => handle(keyEvent(dom.listbox, { key: 'ArrowDown' })));

    expect(onKeyDown).toHaveBeenCalled();
  });

  it('works without an onKeyDown handler', () => {
    const dom = buildDom();
    const { result } = renderHook(() => useOpenSelectTabNavigation<number>({
      options: OPTIONS, onSelect: vi.fn(),
    }));

    expect(() => act(() => result.current(keyEvent(dom.listbox)))).not.toThrow();
  });
});

describe('useOpenSelectTabNavigation — Enter', () => {
  it('clicks the highlighted option itself rather than selecting around MUI', () => {
    const dom = buildDom();
    const clicked = vi.fn();
    dom.optionElements[1].addEventListener('click', clicked);
    const { handle } = setup();
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox, { key: 'Enter' })));

    expect(clicked).toHaveBeenCalled();
  });

  it('stops the event from reaching anything else', () => {
    // Without this the same Enter would also submit the surrounding form.
    const dom = buildDom();
    const event = keyEvent(dom.listbox, { key: 'Enter' });
    const { handle } = setup();
    dom.optionElements[1].focus();

    act(() => handle(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.nativeEvent.stopImmediatePropagation).toHaveBeenCalled();
  });

  it('does nothing for a disabled option', () => {
    const dom = buildDom();
    const clicked = vi.fn();
    dom.optionElements[2].addEventListener('click', clicked);
    const event = keyEvent(dom.listbox, { key: 'Enter' });
    const { handle } = setup();
    dom.optionElements[2].focus();

    act(() => handle(event));

    expect(clicked).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does nothing when no option is highlighted', () => {
    const dom = buildDom();
    const event = keyEvent(dom.listbox, { key: 'Enter' });
    const { handle } = setup();

    act(() => handle(event));

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a highlight that sits outside this listbox', () => {
    // The Enter path resolves the option separately from the Tab path, so it
    // needs its own containment check — a focused option belonging to another
    // select must not be clicked by this menu's Enter.
    const dom = buildDom();
    const stray = document.createElement('li');
    stray.setAttribute('role', 'option');
    stray.setAttribute('data-value', '2');
    stray.tabIndex = -1;
    const clicked = vi.fn();
    stray.addEventListener('click', clicked);
    document.body.append(stray);
    stray.focus();
    const event = keyEvent(dom.listbox, { key: 'Enter' });
    const { handle } = setup();

    act(() => handle(event));

    expect(clicked).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves Enter to MUI in a multi-select', () => {
    const dom = buildDom();
    const clicked = vi.fn();
    dom.optionElements[1].addEventListener('click', clicked);
    const { handle } = setup({ multiple: true });
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox, { key: 'Enter' })));

    expect(clicked).not.toHaveBeenCalled();
  });

  it.each([
    ['Alt', { altKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ])('does not hijack %s+Enter', (_label, modifiers) => {
    const dom = buildDom();
    const clicked = vi.fn();
    dom.optionElements[1].addEventListener('click', clicked);
    const { handle } = setup();
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox, { key: 'Enter', ...modifiers })));

    expect(clicked).not.toHaveBeenCalled();
  });

  it('does not move focus to the neighbouring field', () => {
    // Enter commits and closes; the user stays where they are. Note that the
    // `return` after the click is redundant against the Tab guard just below
    // it, which rejects any key that is not Tab — removing it leaves this file
    // green.
    const dom = buildDom();
    const { handle } = setup();
    dom.optionElements[1].focus();

    act(() => handle(keyEvent(dom.listbox, { key: 'Enter' })));
    act(() => { vi.runAllTimers(); });

    expect(document.activeElement).not.toBe(dom.after);
  });
});
