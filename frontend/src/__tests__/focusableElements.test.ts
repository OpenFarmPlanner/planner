import {
  getFirstFocusable,
  getFocusableElements,
  getTabbableNeighbour,
} from '../focus/focusableElements';

/** Builds a detached-but-attached container: jsdom only computes styles for
 * elements that are in the document. */
function mount(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const ids = (elements: HTMLElement[]): string[] => elements.map((element) => element.id);

describe('getFocusableElements', () => {
  it('collects the standard focusable controls in reading order', () => {
    const container = mount(`
      <a id="link" href="/crops">Kulturen</a>
      <button id="button">Speichern</button>
      <input id="input" />
      <select id="select"></select>
      <textarea id="textarea"></textarea>
    `);

    expect(ids(getFocusableElements(container))).toEqual(['link', 'button', 'input', 'select', 'textarea']);
  });

  it('skips disabled controls', () => {
    const container = mount(`
      <button id="enabled">Speichern</button>
      <button id="disabled" disabled>Speichern</button>
      <input id="disabled-input" disabled />
    `);

    expect(ids(getFocusableElements(container))).toEqual(['enabled']);
  });

  it('skips an anchor without an href', () => {
    const container = mount('<a id="no-href">Kein Ziel</a><a id="with-href" href="/x">Ziel</a>');

    expect(ids(getFocusableElements(container))).toEqual(['with-href']);
  });

  it('includes elements made focusable by a non-negative tabindex', () => {
    const container = mount('<div id="roving" tabindex="0"></div><span id="ordered" tabindex="2"></span>');

    expect(ids(getFocusableElements(container))).toEqual(['roving', 'ordered']);
  });

  it('skips tabindex="-1", the parking spot of roving-tabindex widgets', () => {
    const container = mount('<div id="active" tabindex="0"></div><div id="parked" tabindex="-1"></div>');

    expect(ids(getFocusableElements(container))).toEqual(['active']);
  });

  it('skips a button that a negative tabindex has taken out of the tab order', () => {
    const container = mount('<button id="parked" tabindex="-1">Speichern</button><button id="real">Speichern</button>');

    expect(ids(getFocusableElements(container))).toEqual(['real']);
  });

  it('skips an aria-hidden control even when it is otherwise tabbable', () => {
    // The shadow input MUI renders next to every Select is aria-hidden; the
    // guard has to stand on its own, without relying on a negative tabindex.
    const container = mount(`
      <div id="select-root" tabindex="0" role="combobox"></div>
      <input id="mui-shadow" aria-hidden="true" />
      <input id="real-input" />
    `);

    expect(container.querySelector<HTMLElement>('#mui-shadow')!.tabIndex).toBe(0);
    expect(ids(getFocusableElements(container))).toEqual(['select-root', 'real-input']);
  });

  it('only looks at the element itself, not at an aria-hidden ancestor', () => {
    const container = mount('<div aria-hidden="true"><button id="inside">Innen</button></div>');

    expect(ids(getFocusableElements(container))).toEqual(['inside']);
  });

  it('includes a content-editable host, which jsdom reports as tabIndex -1', () => {
    const container = mount('<div id="editor" contenteditable="true"></div>');

    expect(container.querySelector<HTMLElement>('#editor')!.tabIndex).toBe(-1);
    expect(ids(getFocusableElements(container))).toEqual(['editor']);
  });

  it('skips a contenteditable="false" host', () => {
    const container = mount('<div id="readonly" contenteditable="false"></div><button id="button">OK</button>');

    expect(ids(getFocusableElements(container))).toEqual(['button']);
  });

  it('skips elements hidden by display or visibility', () => {
    const container = mount(`
      <button id="shown">Sichtbar</button>
      <button id="display" style="display: none">Weg</button>
      <button id="visibility" style="visibility: hidden">Unsichtbar</button>
    `);

    expect(ids(getFocusableElements(container))).toEqual(['shown']);
  });

  it('looks at descendants at any depth, not just direct children', () => {
    const container = mount('<div><section><button id="deep">Tief</button></section></div>');

    expect(ids(getFocusableElements(container))).toEqual(['deep']);
  });

  it('does not include the container itself', () => {
    const container = mount('<button id="inner">Innen</button>');
    container.tabIndex = 0;
    container.id = 'container';

    expect(ids(getFocusableElements(container))).toEqual(['inner']);
  });

  it('returns an empty list for a container with nothing focusable', () => {
    expect(getFocusableElements(mount('<p>Nur Text</p>'))).toEqual([]);
  });
});

describe('getFirstFocusable', () => {
  it('returns the element an F6-focused region should land on', () => {
    const container = mount('<button id="first">Eins</button><button id="second">Zwei</button>');

    expect(getFirstFocusable(container)?.id).toBe('first');
  });

  it('skips over an unfocusable leading element', () => {
    const container = mount('<button id="disabled" disabled>Eins</button><button id="second">Zwei</button>');

    expect(getFirstFocusable(container)?.id).toBe('second');
  });

  it('returns null when the region holds nothing focusable, so callers can fall back', () => {
    expect(getFirstFocusable(mount('<p>Nur Text</p>'))).toBeNull();
  });
});

describe('getTabbableNeighbour', () => {
  const three = (): HTMLElement => mount(`
    <button id="a">A</button>
    <button id="b">B</button>
    <button id="c">C</button>
  `);

  const at = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`#${id}`)!;

  it('moves forward on Tab', () => {
    const container = three();

    expect(getTabbableNeighbour(container, at(container, 'a'), 1)?.id).toBe('b');
  });

  it('moves backward on Shift+Tab', () => {
    const container = three();

    expect(getTabbableNeighbour(container, at(container, 'c'), -1)?.id).toBe('b');
  });

  it('returns null at the end without wrap, so Tab may leave the container', () => {
    const container = three();

    expect(getTabbableNeighbour(container, at(container, 'c'), 1)).toBeNull();
    expect(getTabbableNeighbour(container, at(container, 'a'), -1)).toBeNull();
  });

  it('closes the cycle with wrap, the way a modal focus trap does', () => {
    const container = three();

    expect(getTabbableNeighbour(container, at(container, 'c'), 1, { wrap: true })?.id).toBe('a');
    expect(getTabbableNeighbour(container, at(container, 'a'), -1, { wrap: true })?.id).toBe('c');
  });

  it('wraps to the only element when the container holds just one', () => {
    const container = mount('<button id="only">Nur</button>');

    expect(getTabbableNeighbour(container, at(container, 'only'), 1, { wrap: true })?.id).toBe('only');
    expect(getTabbableNeighbour(container, at(container, 'only'), -1, { wrap: true })?.id).toBe('only');
  });

  it('returns null when the origin is not inside the container', () => {
    const container = three();
    const outside = mount('<button id="outside">Draußen</button>');

    expect(getTabbableNeighbour(container, at(outside, 'outside'), 1)).toBeNull();
    expect(getTabbableNeighbour(container, at(outside, 'outside'), 1, { wrap: true })).toBeNull();
  });

  it('returns null when the origin is in the container but not itself tabbable', () => {
    const container = mount('<button id="parked" tabindex="-1">A</button><button id="b">B</button>');

    expect(getTabbableNeighbour(container, at(container, 'parked'), 1)).toBeNull();
  });

  it('steps over elements that are not tabbable rather than landing on them', () => {
    const container = mount(`
      <button id="a">A</button>
      <button id="hidden" style="display: none">Weg</button>
      <input id="shadow" aria-hidden="true" />
      <button id="b">B</button>
    `);

    expect(getTabbableNeighbour(container, at(container, 'a'), 1)?.id).toBe('b');
  });
});
