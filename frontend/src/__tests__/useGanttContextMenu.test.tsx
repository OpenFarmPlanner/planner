import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import type { TFunction } from 'i18next';
import i18n from '../i18n';
import type { GanttTask, GanttTaskGroup } from '../pages/ganttChartUtils';
import type { GanttContextMenuCallbacks } from '../pages/ganttContextMenuActions';
import { useGanttContextMenu } from '../pages/useGanttContextMenu';

const t = i18n.getFixedT('de') as TFunction;

const task = (overrides: Partial<GanttTask> = {}): GanttTask => ({
  id: 't1',
  name: 'Aufgabe',
  plantingPlanId: 5,
  cropName: 'Möhre',
  startDate: new Date(2026, 2, 15),
  endDate: new Date(2026, 5, 20),
  ...overrides,
} as GanttTask);

const group = (overrides: Partial<GanttTaskGroup> = {}): GanttTaskGroup => ({
  id: 'g1', name: 'Beet A', tasks: [], bedId: 3, fieldId: 2, locationId: 1, ...overrides,
} as GanttTaskGroup);

const createCallbacks = (): GanttContextMenuCallbacks => ({
  openPlantingPlanFromTask: vi.fn(),
  openCropFromTask: vi.fn(),
  openAreasPage: vi.fn(),
  copyTaskSummary: vi.fn(),
  deletePlantingPlanFromTask: vi.fn(),
  addPlantingPlanForBed: vi.fn(),
});

/**
 * The chart's own DOM markers. The hook finds its target by walking up to the
 * nearest element carrying one, so the target has to be a real element inside
 * one rather than a stub.
 */
const mountTarget = (component: 'task' | 'task-group', inner: 'cell' | 'input' = 'cell') => {
  const host = document.createElement('div');
  host.dataset.rmgComponent = component;
  const child = document.createElement(inner === 'input' ? 'input' : 'span');
  host.append(child);
  document.body.append(host);
  return { host, child };
};

/**
 * Only `target`, the coordinates and the suppression methods are read, so a
 * literal with those fields is a faithful stand-in for a React synthetic
 * event -- and lets each suppression call be observed separately.
 */
const mouseEvent = (target: Element, { clientX = 320, clientY = 240 } = {}) => ({
  target,
  currentTarget: target,
  clientX,
  clientY,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  stopImmediatePropagation: vi.fn(),
  nativeEvent: { stopImmediatePropagation: vi.fn() },
});

const touchEvent = (
  target: Element,
  { changedTouches = [{ clientX: 60, clientY: 90 }], touches = [{ clientX: 11, clientY: 12 }] } = {},
) => ({
  target,
  currentTarget: target,
  changedTouches,
  touches,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  nativeEvent: { stopImmediatePropagation: vi.fn() },
});

const setup = (callbacks = createCallbacks()) => ({
  callbacks,
  ...renderHook(() => useGanttContextMenu(callbacks, t)),
});

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/**
 * The target predicate is internal to the hook, but it decides what happens to
 * an already-open menu when a native context-menu event arrives: one on the
 * chart is left alone for the chart's own handler to reposition, while one
 * anywhere else dismisses the menu. That is the route these tests take.
 */
const openMenuOn = (element: Element, view: ReturnType<typeof setup>) => {
  act(() => view.result.current.handleTaskContextMenu(
    mouseEvent(element) as unknown as React.MouseEvent, task(), group(),
  ));
};

const nativeContextMenuOn = (target: EventTarget) => {
  act(() => {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
};

describe('what counts as a target', () => {
  it.each(['task', 'task-group'] as const)('keeps the menu open for a %s', (component) => {
    const { host, child } = mountTarget(component);
    const view = setup();
    openMenuOn(child, view);

    nativeContextMenuOn(host);

    expect(view.result.current.contextMenuState).not.toBeNull();
  });

  it('keeps the menu open for an element inside a task', () => {
    const { child } = mountTarget('task');
    const view = setup();
    openMenuOn(child, view);

    nativeContextMenuOn(child);

    expect(view.result.current.contextMenuState).not.toBeNull();
  });

  it('dismisses the menu for a right-click on the chart background', () => {
    const { child } = mountTarget('task');
    const background = document.createElement('div');
    document.body.append(background);
    const view = setup();
    openMenuOn(child, view);

    nativeContextMenuOn(background);

    expect(view.result.current.contextMenuState).toBeNull();
  });

  it('dismisses the menu for a right-click on a text input inside a task', () => {
    // The browser's own cut/copy/paste menu has to win there, so this one
    // gets out of the way rather than staying open behind it.
    const { child } = mountTarget('task');
    const { child: input } = mountTarget('task', 'input');
    const view = setup();
    openMenuOn(child, view);

    nativeContextMenuOn(input);

    expect(view.result.current.contextMenuState).toBeNull();
  });

  it('dismisses the menu for an element marked as another chart part', () => {
    // The marker is matched exactly; a calendar header is not a row.
    const { child } = mountTarget('task');
    const other = document.createElement('div');
    other.dataset.rmgComponent = 'calendar';
    document.body.append(other);
    const view = setup();
    openMenuOn(child, view);

    nativeContextMenuOn(other);

    expect(view.result.current.contextMenuState).toBeNull();
  });
});

describe('opening on a task', () => {
  it('opens just below and right of the pointer', () => {
    // The offset keeps the menu clear of the cursor, where its first entry
    // would otherwise sit directly under the click.
    const { child } = mountTarget('task');
    const { result } = setup();

    act(() => result.current.handleTaskContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, task(), group(),
    ));

    expect(result.current.contextMenuState).toMatchObject({ mouseX: 322, mouseY: 234 });
  });

  it('records the task and its group as the target', () => {
    const { child } = mountTarget('task');
    const { result } = setup();
    const theTask = task();
    const theGroup = group();

    act(() => result.current.handleTaskContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, theTask, theGroup,
    ));

    expect(result.current.contextMenuState?.key).toEqual({
      type: 'task', task: theTask, group: theGroup,
    });
  });

  it('suppresses the browser menu on every channel', () => {
    // React's synthetic listener and any DOM listener on an ancestor both
    // have to be stopped, or the native menu opens on top of this one.
    const { child } = mountTarget('task');
    const { result } = setup();
    const event = mouseEvent(child);

    act(() => result.current.handleTaskContextMenu(
      event as unknown as React.MouseEvent, task(), group(),
    ));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.nativeEvent.stopImmediatePropagation).toHaveBeenCalled();
  });

  it('leaves an editable target to the browser', () => {
    const { child } = mountTarget('task', 'input');
    const { result } = setup();
    const event = mouseEvent(child);

    act(() => result.current.handleTaskContextMenu(
      event as unknown as React.MouseEvent, task(), group(),
    ));

    expect(result.current.contextMenuState).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('opening on a group', () => {
  it('records the group alone as the target', () => {
    // A group row has no task behind it, so the action list is the shorter
    // one the builder produces for a group.
    const { child } = mountTarget('task-group');
    const { result } = setup();
    const theGroup = group();

    act(() => result.current.handleGroupContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, theGroup,
    ));

    expect(result.current.contextMenuState?.key).toEqual({ type: 'group', group: theGroup });
  });

  it('uses the same pointer offsets as a task', () => {
    const { child } = mountTarget('task-group');
    const { result } = setup();

    act(() => result.current.handleGroupContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, group(),
    ));

    expect(result.current.contextMenuState).toMatchObject({ mouseX: 322, mouseY: 234 });
  });

  it('leaves an editable target to the browser', () => {
    const { child } = mountTarget('task-group', 'input');
    const { result } = setup();

    act(() => result.current.handleGroupContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, group(),
    ));

    expect(result.current.contextMenuState).toBeNull();
  });
});

describe('opening from a touch', () => {
  it('reads the finger that was lifted', () => {
    // `changedTouches` holds the finger the event is about; `touches` holds
    // the ones still down, which on a touchend is everything except it.
    const { child } = mountTarget('task');
    const { result } = setup();

    act(() => result.current.handleTaskContextMenu(
      touchEvent(child) as unknown as React.TouchEvent, task(), group(),
    ));

    expect(result.current.contextMenuState).toMatchObject({ mouseX: 62, mouseY: 84 });
  });

  it('falls back to a finger still down when none was lifted', () => {
    // A touchstart-driven open has an empty `changedTouches` in some
    // browsers, and the position has to come from somewhere.
    const { child } = mountTarget('task');
    const { result } = setup();

    act(() => result.current.handleTaskContextMenu(
      touchEvent(child, { changedTouches: [] }) as unknown as React.TouchEvent, task(), group(),
    ));

    expect(result.current.contextMenuState).toMatchObject({ mouseX: 13, mouseY: 6 });
  });

  it('opens nothing when there is no finger at all', () => {
    // Without a position the menu would open at the top-left corner of the
    // screen, far from whatever was touched.
    const { child } = mountTarget('task');
    const { result } = setup();
    const event = touchEvent(child, { changedTouches: [], touches: [] });

    act(() => result.current.handleTaskContextMenu(
      event as unknown as React.TouchEvent, task(), group(),
    ));

    expect(result.current.contextMenuState).toBeNull();
  });

  it('still suppresses the browser menu before giving up', () => {
    // The long press has already been recognised by then; letting the native
    // menu through afterwards would show it with nothing else happening.
    const { child } = mountTarget('task');
    const { result } = setup();
    const event = touchEvent(child, { changedTouches: [], touches: [] });

    act(() => result.current.handleTaskContextMenu(
      event as unknown as React.TouchEvent, task(), group(),
    ));

    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe('the action list', () => {
  it('is empty while the menu is closed', () => {
    const { result } = setup();

    expect(result.current.contextMenuActions).toEqual([]);
  });

  it('is built for the open target', () => {
    const { child } = mountTarget('task');
    const { result } = setup();

    act(() => result.current.handleTaskContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, task(), group(),
    ));

    expect(result.current.contextMenuActions.map((action) => action.id)).toContain('open-plan');
  });

  it('offers a group the group actions rather than the task ones', () => {
    // The two lists differ, so building the wrong one would offer actions
    // that have no task to act on.
    const { child } = mountTarget('task-group');
    const { result } = setup();

    act(() => result.current.handleGroupContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, group(),
    ));

    const ids = result.current.contextMenuActions.map((action) => action.id);
    expect(ids).not.toContain('open-plan');
    expect(ids.length).toBeGreaterThan(0);
  });

  it('runs the page callback the action stands for', () => {
    const { child } = mountTarget('task');
    const { callbacks, result } = setup();
    const theTask = task();

    act(() => result.current.handleTaskContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, theTask, group(),
    ));
    const openPlan = result.current.contextMenuActions.find((action) => action.id === 'open-plan');
    act(() => openPlan?.onClick());

    expect(callbacks.openPlantingPlanFromTask).toHaveBeenCalledWith(theTask);
  });

  it('is empty again once the menu closes', () => {
    const { child } = mountTarget('task');
    const { result } = setup();
    act(() => result.current.handleTaskContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, task(), group(),
    ));

    act(() => result.current.closeContextMenu());

    expect(result.current.contextMenuActions).toEqual([]);
    expect(result.current.contextMenuState).toBeNull();
  });

  it('follows the target when the menu moves to another row', () => {
    const { child } = mountTarget('task');
    const { result } = setup();
    act(() => result.current.handleTaskContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, task(), group(),
    ));

    act(() => result.current.handleGroupContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent, group(),
    ));

    expect(result.current.contextMenuActions.map((action) => action.id)).not.toContain('open-plan');
  });
});
