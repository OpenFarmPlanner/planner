import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import {
  collectSelectTypeaheadOptions,
  useClosedSelectTypeahead,
  type SelectTypeaheadOption,
} from '../components/inputs/selectTypeahead';

const OPTIONS: SelectTypeaheadOption<string>[] = [
  { value: 'a', label: 'Apfel' },
  { value: 'b', label: 'Birne' },
  { value: 'c', label: 'Brombeere' },
  { value: 'd', label: 'Dattel', disabled: true },
  { value: 'e', label: 'Erdbeere', hidden: true },
];

/** A keyboard event shaped the way the hook reads it. */
function keyEvent(key: string, overrides: Partial<KeyboardEvent<Element>> = {}) {
  const target = overrides.target ?? document.createElement('div');
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target,
    currentTarget: overrides.currentTarget ?? target,
    defaultPrevented: false,
    preventDefault: vi.fn(function (this: { defaultPrevented: boolean }) { this.defaultPrevented = true; }),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent<Element> & { preventDefault: ReturnType<typeof vi.fn> };
}

function setup(props: Partial<Parameters<typeof useClosedSelectTypeahead>[0]> = {}) {
  const onSelect = vi.fn();
  const view = renderHook(() => useClosedSelectTypeahead<string>({
    options: OPTIONS,
    value: undefined,
    onSelect,
    ...props,
  } as never));
  return { ...view, onSelect };
}

function type(handler: (e: KeyboardEvent<Element>) => void, keys: string, shared?: Element) {
  const events = [];
  for (const key of keys) {
    const event = keyEvent(key, shared ? { target: shared, currentTarget: shared } : {});
    act(() => { handler(event); });
    events.push(event);
  }
  return events;
}

describe('useClosedSelectTypeahead', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('selects the first option starting with the typed letter', () => {
    const { result, onSelect } = setup();

    type(result.current, 'b');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBe('b');
  });

  it('narrows as more letters arrive, rather than restarting each key', () => {
    const { result, onSelect } = setup();

    type(result.current, 'br');

    expect(onSelect.mock.calls.at(-1)?.[0]).toBe('c');
  });

  it('starts a fresh search once the buffer times out', () => {
    const { result, onSelect } = setup();

    type(result.current, 'b');
    act(() => { vi.advanceTimersByTime(1000); });
    type(result.current, 'r');

    // "r" alone matches nothing; had the buffer survived it would be "br".
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('claims every eligible keystroke, even one that matches nothing', () => {
    // The hook must beat MUI v9's own closed-select typeahead, which bails
    // out when defaultPrevented is already set. Claiming only matches would
    // let the competing buffer see the rest.
    const { result } = setup();

    const [event] = type(result.current, 'z');

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('skips disabled and hidden options', () => {
    const { result, onSelect } = setup();

    type(result.current, 'd');
    type(result.current, 'e');

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not fire when the match is already selected', () => {
    const { result, onSelect } = setup({ value: 'b' });

    type(result.current, 'b');

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores a key the caller already handled', () => {
    const onKeyDown = vi.fn((e: KeyboardEvent<Element>) => { (e as { defaultPrevented: boolean }).defaultPrevented = true; });
    const { result, onSelect } = setup({ onKeyDown });

    type(result.current, 'b');

    expect(onKeyDown).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores modified keystrokes, which are shortcuts not searches', () => {
    const { result, onSelect } = setup();

    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      act(() => { result.current(keyEvent('b', { [mod]: true } as never)); });
    }

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores multi-character keys such as ArrowDown', () => {
    const { result, onSelect } = setup();

    act(() => { result.current(keyEvent('ArrowDown')); });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves typing inside a text field alone', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const { result, onSelect } = setup();

    act(() => { result.current(keyEvent('b', { target: input, currentTarget: input })); });

    expect(onSelect).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('stands aside while the select is open, where MUI drives the list', () => {
    const combobox = document.createElement('div');
    combobox.setAttribute('role', 'combobox');
    combobox.setAttribute('aria-expanded', 'true');
    document.body.appendChild(combobox);
    const { result, onSelect } = setup();

    act(() => { result.current(keyEvent('b', { target: combobox, currentTarget: combobox })); });

    expect(onSelect).not.toHaveBeenCalled();
    document.body.removeChild(combobox);
  });

  it('keeps the buffer across Shift, so a capital letter continues the search', () => {
    const { result, onSelect } = setup();

    type(result.current, 'b');
    act(() => { result.current(keyEvent('Shift')); });
    type(result.current, 'r');

    expect(onSelect.mock.calls.at(-1)?.[0]).toBe('c');
  });

  it('matches regardless of case', () => {
    const { result, onSelect } = setup();

    type(result.current, 'B');

    expect(onSelect.mock.calls[0][0]).toBe('b');
  });

  describe('multiple selection', () => {
    it('adds to the selection rather than replacing it', () => {
      const { result, onSelect } = setup({ multiple: true, value: ['a'] });

      type(result.current, 'b');

      expect(onSelect.mock.calls[0][0]).toEqual(['a', 'b']);
    });

    it('does not fire when the option is already selected', () => {
      const { result, onSelect } = setup({ multiple: true, value: ['b'] });

      type(result.current, 'b');

      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});

describe('collectSelectTypeaheadOptions', () => {
  it('reads value and label from each option', () => {
    const options = collectSelectTypeaheadOptions(
      <>
        <div value="a">Apfel</div>
        <div value="b">Birne</div>
      </>,
    );

    expect(options.map((o) => [o.value, o.label])).toEqual([['a', 'Apfel'], ['b', 'Birne']]);
  });

  it('flattens options nested inside groups', () => {
    const options = collectSelectTypeaheadOptions(
      <div>
        <div value="a">Apfel</div>
      </div>,
    );

    expect(options.map((o) => o.value)).toEqual(['a']);
  });

  it('joins the text of a composite label', () => {
    const options = collectSelectTypeaheadOptions(
      <div value="a"><span>Apfel</span><span>Boskoop</span></div>,
    );

    expect(options[0].label).toBe('Apfel Boskoop');
  });

  it('reads a nested primary prop, the way a ListItemText carries its label', () => {
    const options = collectSelectTypeaheadOptions(
      <div value="a"><span primary="Apfel">ignoriert</span></div>,
    );

    expect(options[0].label).toBe('Apfel');
  });

  it('ignores a primary prop on the option element itself', () => {
    // The option's own props are never consulted: collectSelectTypeaheadOptions
    // hands getNodeText the option's *children*, so `primary` only applies one
    // level down.
    const options = collectSelectTypeaheadOptions(
      <div value="a" primary="Apfel">Birne</div>,
    );

    expect(options[0].label).toBe('Birne');
  });

  it('carries the disabled flag through', () => {
    const options = collectSelectTypeaheadOptions(<div value="a" disabled>Apfel</div>);

    expect(options[0].disabled).toBe(true);
  });

  it.each([
    ['the hidden attribute', { hidden: true }],
    ['display none', { style: { display: 'none' } }],
    ['visibility hidden', { style: { visibility: 'hidden' } }],
  ])('treats %s as hidden', (_label, props) => {
    const options = collectSelectTypeaheadOptions(<div value="a" {...props}>Apfel</div>);

    expect(options[0].hidden).toBe(true);
  });

  it('ignores anything that is not an element', () => {
    expect(collectSelectTypeaheadOptions(['text', null, undefined, false])).toEqual([]);
  });
});
