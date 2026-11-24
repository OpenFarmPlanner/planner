import { createContext, useContext, type SyntheticEvent } from 'react';
import { isAnyContextMenuOpen, subscribeToContextMenuOpenState } from '../contextMenu/contextMenuOpenState';

export function createGridTooltipScope(initialEditing: boolean) {
  let editing = initialEditing;
  let suppressRestoredFocus = false;
  let previousPointer: Point | null = null;
  const scope = {
    isEditing: () => editing,
    isRestoringFocus: () => suppressRestoredFocus,
    setEditing(next: boolean) {
      if (editing === next) return;
      editing = next;
      dismissGridTooltipForEdit(scope);
    },
    suppressRestoredInteraction() {
      suppressRestoredFocus = true;
      previousPointer = pointer;
    },
    isStationaryHover(event: MouseEvent) {
      return Boolean(previousPointer && previousPointer === pointer
        && event.clientX === previousPointer.x && event.clientY === previousPointer.y);
    },
    allowFocus() { suppressRestoredFocus = false; },
    dispose() {
      if (active?.scope === scope) dismissGridTooltip(active.id, null);
    },
  };
  return scope;
}

type Scope = ReturnType<typeof createGridTooltipScope>;
type Point = { x: number; y: number };
type TooltipDismissEvent = Event | SyntheticEvent | null;

interface TooltipRequest {
  id: string;
  scope: Scope;
  anchor: HTMLElement;
  allowedDuringEdit: boolean;
  event?: Event;
  dismiss: (event: TooltipDismissEvent) => void;
}

interface ActiveTooltip extends TooltipRequest {
  cell: Element | null;
  row: string | null;
  field: string | null;
  scrollOffsets: ReadonlyMap<Element, Point>;
}

export const GridTooltipContext = createContext<Scope | null>(null);
const CELL = '[role="gridcell"], [role="columnheader"]';
const EDITOR = '.MuiDataGrid-cell--editing, [data-grid-dedicated-editor]';
const FLOATING_OVERLAY = '.MuiAutocomplete-popper [role="listbox"], .MuiPopper-root [role="menu"], dialog[open], [role="dialog"][aria-modal="true"]';
const claimedEvents = new WeakSet<Event>();
const gridCellPreviews = new WeakMap<Element, () => void>();
let active: ActiveTooltip | null = null;
let stopWatching: (() => void) | undefined;
let pointer: Point | null = null;
let pointerTrackers = 0;

function updatePointer(event: MouseEvent): void {
  if (pointer?.x !== event.clientX || pointer?.y !== event.clientY) {
    pointer = { x: event.clientX, y: event.clientY };
  }
}

function showFocusedCellPreview(event: FocusEvent): void {
  if (event.target instanceof Element) gridCellPreviews.get(event.target)?.();
}

export function registerGridCellPreview(anchor: HTMLElement, show: () => void): () => void {
  const cell = anchor.closest(CELL);
  if (!cell) return () => {};
  gridCellPreviews.set(cell, show);
  return () => {
    if (gridCellPreviews.get(cell) === show) gridCellPreviews.delete(cell);
  };
}

export function trackGridTooltipInteractions(doc: Document): () => void {
  // Browsers can dispatch mouseover when a mounted editor changes the element
  // under a stationary pointer. A real move distinguishes a fresh hover.
  if (pointerTrackers++ === 0) {
    doc.addEventListener('mousemove', updatePointer, true);
    doc.addEventListener('mousedown', updatePointer, true);
    doc.addEventListener('focusin', showFocusedCellPreview, true);
  }
  return () => {
    if (--pointerTrackers !== 0) return;
    doc.removeEventListener('mousemove', updatePointer, true);
    doc.removeEventListener('mousedown', updatePointer, true);
    doc.removeEventListener('focusin', showFocusedCellPreview, true);
    pointer = null;
  };
}

export function useGridTooltipScope(): Scope | null {
  return useContext(GridTooltipContext);
}

function hasForegroundOverlay(anchor: HTMLElement): boolean {
  if (anchor.closest('[aria-hidden="true"], [hidden], [inert]')) return true;
  // Portaled menus can be outside MUI's modal manager. A menu's own controls
  // are still allowed to explain themselves.
  const overlays = anchor.ownerDocument.querySelectorAll(FLOATING_OVERLAY);
  const front = overlays[overlays.length - 1];
  return Boolean(front && !front.contains(anchor));
}

function canShowGridTooltip({ scope, anchor, allowedDuringEdit }: TooltipRequest): boolean {
  if (!anchor.isConnected || isAnyContextMenuOpen() || hasForegroundOverlay(anchor)) return false;
  const grid = anchor.closest('[role="grid"]');
  return !grid || allowedDuringEdit || Boolean(anchor.closest(EDITOR))
    || (!scope.isEditing() && !grid.querySelector('[data-grid-dedicated-editor]'));
}

export function dismissGridTooltip(id?: string, event?: TooltipDismissEvent): void {
  if (!active || (id !== undefined && active.id !== id)) return;
  const dismissed = active;
  active = null;
  stopWatching?.();
  stopWatching = undefined;
  dismissed.dismiss(event === undefined ? new Event('gridtooltipdismiss') : event);
}

export function dismissGridTooltipForEdit(scope: Scope | null): void {
  if (!scope) return;
  scope.suppressRestoredInteraction();
  if (active?.scope === scope) dismissGridTooltip();
}

function isInsideTooltip(target: Node, tooltip: ActiveTooltip): boolean {
  return target instanceof Element
    && target.closest('[data-ofp-grid-tooltip]')?.getAttribute('data-ofp-grid-tooltip') === tooltip.id;
}

function watchTooltip(doc: Document): () => void {
  const onFocus = (event: FocusEvent): void => {
    if (!active || !(event.target instanceof Node)) return;
    if (active.anchor.contains(event.target) || event.target === active.cell || isInsideTooltip(event.target, active)) return;
    if (hasForegroundOverlay(active.anchor)) active.scope.suppressRestoredInteraction();
    dismissGridTooltip(undefined, event);
  };
  const onPointerDown = (event: Event): void => {
    if (!active || !(event.target instanceof Node) || isInsideTooltip(event.target, active)) return;
    if (!(event.target instanceof Element) || !event.target.closest(CELL)) active.scope.suppressRestoredInteraction();
    dismissGridTooltip(undefined, event);
  };
  const onScroll = (event: Event): void => {
    if (!active || (event.target instanceof Node && isInsideTooltip(event.target, active))) return;
    const scroller = event.target === doc ? doc.scrollingElement : event.target;
    if (!(scroller instanceof Element)) return;
    const previous = active.scrollOffsets.get(scroller);
    // Scroll-into-view can move the anchor before hover and dispatch its
    // scroll event afterward. Only a change since this request invalidates it.
    if (!previous || (scroller.scrollLeft === previous.x && scroller.scrollTop === previous.y)) return;
    active.scope.suppressRestoredInteraction();
    dismissGridTooltip(undefined, event);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismissGridTooltip(undefined, event);
  };
  const onChange = (): void => {
    if (!active) return;
    if (!canShowGridTooltip(active) ||
        active.anchor.closest(CELL) !== active.cell ||
        (active.cell?.closest('[role="row"]')?.getAttribute('data-id') ?? null) !== active.row ||
        (active.cell?.getAttribute('data-field') ?? null) !== active.field) {
      active.scope.suppressRestoredInteraction();
      dismissGridTooltip();
    }
  };
  const observer = new MutationObserver(onChange);
  observer.observe(doc.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'aria-modal', 'data-id', 'data-field', 'hidden', 'inert', 'open'],
  });
  const unsubscribeMenu = subscribeToContextMenuOpenState(onChange);
  doc.addEventListener('focusin', onFocus, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('scroll', onScroll, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('touchcancel', onPointerDown, true);
  return () => {
    observer.disconnect();
    unsubscribeMenu();
    doc.removeEventListener('focusin', onFocus, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('scroll', onScroll, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('touchcancel', onPointerDown, true);
  };
}

export function claimGridTooltip(request: TooltipRequest): boolean {
  if (!canShowGridTooltip(request)) return false;
  // A nested label and its outer wrapper can receive the same event. The
  // inner eligible trigger sees it first.
  if (request.event) {
    if (claimedEvents.has(request.event)) return false;
    claimedEvents.add(request.event);
  }
  const previous = active;
  const cell = request.anchor.closest(CELL);
  const scrollOffsets = new Map<Element, Point>();
  for (let node: Element | null = request.anchor; node; node = node.parentElement) {
    scrollOffsets.set(node, { x: node.scrollLeft, y: node.scrollTop });
  }
  active = {
    ...request,
    cell,
    row: cell?.closest('[role="row"]')?.getAttribute('data-id') ?? null,
    field: cell?.getAttribute('data-field') ?? null,
    scrollOffsets,
  };
  if (previous && previous.id !== request.id) {
    previous.dismiss(request.event ?? new Event('gridtooltipdismiss'));
  }
  stopWatching ??= watchTooltip(request.anchor.ownerDocument);
  return true;
}

export function isCurrentGridTooltipRequest(id: string, event: Event): boolean {
  return active?.id === id && active.event === event && canShowGridTooltip(active);
}
