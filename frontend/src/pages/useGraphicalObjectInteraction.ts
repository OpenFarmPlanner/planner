import { useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { ROW_LONG_PRESS_MS, useLongPressTimer } from '../components/contextMenu/useLongPressTimer';
import { useContextMenuOpenSnapshot } from '../components/contextMenu/contextMenuOpenState';
import type { HierarchyEntityType } from '../components/hierarchy/details/hierarchyDetailRoutes';
import type { Point } from './graphicalFieldsGeometry';
import type { GraphicalDisplayMode } from './graphicalCultivation';

type Device = 'desktop' | 'touch';
type StagePressEvent = KonvaEventObject<MouseEvent | TouchEvent>;
const PRESS_SLOP = 8;
export function graphicalObjectKey(type: HierarchyEntityType, id: number): string {
  return `${type}:${id}`;
}

// Read the single Konva hit. Decorative paint is non-listening, so nested beds
// and plant controls keep their own target instead of activating a parent.
const OBJECT_ATTR = 'data-graphical-object-key';

function objectAt(event: StagePressEvent): string | null {
  return event.target === event.target.getStage() ? null : event.target.getAttrs()[OBJECT_ATTR] ?? null;
}

function eventPoint(event: MouseEvent | TouchEvent): Point | undefined {
  const pointer = 'touches' in event ? event.changedTouches?.[0] : event;
  return pointer && { x: pointer.clientX, y: pointer.clientY };
}

export function useGraphicalObjectInteraction(enabled: boolean, scope: number | null, mode: GraphicalDisplayMode) {
  const [selection, setSelection] = useState<{ key: string; scope: number | null } | null>(null);
  const [hover, setHover] = useState<{ key: string; point: Point; mode: GraphicalDisplayMode; menuSequence: number } | null>(null);
  const { open: contextMenuOpen, openSequence: menuSequence } = useContextMenuOpenSnapshot();
  const [menu, setMenu] = useState<{ point: Point; key: string; trigger?: HTMLElement; gesture?: Device } | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const press = useRef<{ key: string | null; point: Point } | null>(null);
  const pendingTap = useRef<{ timer: number; key: string | null } | null>(null);
  const recentLongPress = useRef(0);
  const { start, clear, endTouch } = useLongPressTimer(ROW_LONG_PRESS_MS);

  const cancelTap = useCallback(() => {
    if (pendingTap.current) window.clearTimeout(pendingTap.current.timer);
    pendingTap.current = null;
  }, []);
  const cancelPress = useCallback(() => {
    clear();
    cancelTap();
    press.current = null;
  }, [cancelTap, clear]);
  const close = useCallback(() => {
    setHover(null);
    setSelection(null);
    setMenu(null);
    cancelPress();
  }, [cancelPress]);

  useEffect(() => {
    queueMicrotask(close);
    return cancelPress;
  }, [enabled, scope, close, cancelPress]);

  const select = (key: string) => {
    cancelTap();
    setMenu(null);
    setHover(null);
    setSelection({ key, scope });
  };

  const openMenu = (key: string, point: Point, trigger?: HTMLElement, gesture?: Device) => {
    setHover(null);
    setSelection(null);
    setMenu({ key, point, trigger, gesture });
    cancelPress();
  };

  const begin = (key: string | null, point: Point, input: Device) => {
    setDevice(input);
    setHover(null);
    press.current = { key, point };
    if (key && input === 'touch') {
      start(() => {
        recentLongPress.current = Date.now();
        openMenu(key, point, undefined, 'touch');
      });
    }
  };

  const moved = (point: Point): boolean => {
    const origin = press.current?.point;
    if (!origin || Math.hypot(point.x - origin.x, point.y - origin.y) <= PRESS_SLOP) return false;
    cancelPress();
    setHover(null);
    return true;
  };

  const release = (key: string | null, point: Point) => {
    clear();
    if (moved(point) || !press.current) return;
    const from = press.current;
    press.current = null;
    if (from.key !== key) return;
    // Konva delivers the first click before it knows whether a second click
    // will zoom the stage. Wait through its double-click window before selecting.
    const previousTap = pendingTap.current;
    cancelTap();
    if (previousTap?.key === key) return;
    const timer = window.setTimeout(() => {
      pendingTap.current = null;
      if (key) select(key);
      else close();
    }, Konva.dblClickWindow);
    pendingTap.current = { timer, key };
  };

  const hoverObject = (key: string | null, point: Point | undefined) => {
    if (key && point) setDevice('desktop');
    setHover(current => key && point && !menu && !selection && !contextMenuOpen
      ? (current?.key === key && current.mode === mode && current.menuSequence === menuSequence
        ? current : { key, point, mode, menuSequence }) : null);
  };

  const beginStage = (event: StagePressEvent) => {
    if (!enabled) return;
    const input = 'touches' in event.evt ? 'touch' : 'desktop';
    if (('button' in event.evt && event.evt.button !== 0)
        || ('touches' in event.evt && event.evt.touches.length !== 1)) {
      cancelPress();
      return;
    }
    const key = objectAt(event);
    if (!key && event.target !== event.target.getStage()) {
      close();
      return;
    }
    const point = eventPoint(event.evt);
    if (point) begin(key, point, input);
  };

  return {
    selection: enabled && selection?.scope === scope ? selection.key : null,
    menu: enabled ? menu : null,
    hover: enabled && !contextMenuOpen && hover?.mode === mode && hover.menuSequence === menuSequence ? hover : null,
    device,
    noteDevice: setDevice,
    select,
    openMenu,
    close,
    cancelPress,
    clearHover: () => setHover(null),
    hoverObject,
    isObjectTarget: (event: StagePressEvent) => enabled && objectAt(event) !== null,
    beginStage,
    moveStage: (event: StagePressEvent) => {
      if (!enabled) return;
      const point = eventPoint(event.evt);
      if ('touches' in event.evt) {
        if (event.evt.touches.length > 1) cancelPress();
        else if (point) moved(point);
        return;
      }
      if (point && event.evt.buttons) {
        moved(point);
        return;
      }
      hoverObject(objectAt(event), point);
    },
    endTouch: (event: TouchEvent) => endTouch(event),
    releaseStage: (event: StagePressEvent) => {
      if (!enabled) return;
      const point = eventPoint(event.evt);
      if (point) release(objectAt(event), point);
    },
    contextStage: (event: KonvaEventObject<MouseEvent>) => {
      if (!enabled) return;
      const key = objectAt(event);
      if (!key) {
        if (menu) close();
        return;
      }
      const { clientX: x, clientY: y, pointerType } = event.evt as PointerEvent;
      event.evt.preventDefault();
      if (pointerType === 'touch' || (!pointerType && Date.now() - recentLongPress.current < 750)) return;
      setDevice('desktop');
      openMenu(key, { x, y }, undefined, 'desktop');
      return 'desktop' as const;
    },
    begin,
    moved,
    release,
    didLongPress: () => Date.now() - recentLongPress.current < 750,
  };
}

export type GraphicalObjectInteraction = ReturnType<typeof useGraphicalObjectInteraction>;
