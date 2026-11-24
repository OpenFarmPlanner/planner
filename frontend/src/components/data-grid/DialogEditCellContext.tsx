import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { GridRowId } from '@mui/x-data-grid';

/**
 * `EditableDataGrid` sends an explicit edit request to cells whose renderer
 * manages its own editor outside the grid's row-edit state.
 *
 * The request carries a token that is bumped on every entry. A cell opens for a
 * token exactly once and consumes the request while doing so, which is what
 * makes repeated entries work: the grid can hand out a *new* token for the same
 * cell any number of times, while a re-render, a re-mount (grid virtualization),
 * or a simultaneous focus/click event can never replay an old one.
 */
export interface DialogEditCellRequest {
  cellKey: string;
  token: number;
  initialQuery?: string;
}

export const buildDialogEditCellKey = (rowId: GridRowId, field: string): string =>
  `${String(rowId)}:${field}`;

export function createDialogEditCellRequests() {
  let request: DialogEditCellRequest | null = null;
  let token = 0;
  const listeners = new Map<string, Set<() => void>>();
  const publish = (next: DialogEditCellRequest | null) => {
    const previousKey = request?.cellKey;
    request = next;
    if (previousKey && previousKey !== next?.cellKey) listeners.get(previousKey)?.forEach(notify => notify());
    if (next) listeners.get(next.cellKey)?.forEach(notify => notify());
  };

  // Virtualization can mount the target after the request. Keep the snapshot
  // until that cell consumes it, and notify only listeners for the affected key.
  return {
    open: (rowId: GridRowId, field: string, initialQuery?: string): void => {
      publish({ cellKey: buildDialogEditCellKey(rowId, field), token: ++token, initialQuery });
    },
    getRequest: (cellKey: string): DialogEditCellRequest | null => (
      request?.cellKey === cellKey ? request : null
    ),
    subscribe: (cellKey: string, notify: () => void): (() => void) => {
      const current = listeners.get(cellKey) ?? new Set();
      current.add(notify);
      listeners.set(cellKey, current);
      return () => {
        current.delete(notify);
        if (current.size === 0) listeners.delete(cellKey);
      };
    },
    consumeRequest: (handledToken: number): void => {
      if (request?.token === handledToken) publish(null);
    },
  };
}

export type DialogEditCellContextValue = ReturnType<typeof createDialogEditCellRequests>;
export const DialogEditCellContext = createContext<DialogEditCellContextValue | null>(null);
const getEmptySnapshot = () => null;
const unsubscribeEmpty = () => {};

/**
 * Runs `onOpenRequested` once per explicit edit request for the cell identified
 * by `rowId`/`field`. Cells rendered outside an `EditableDataGrid` (or without
 * a cell identity) simply never get a request.
 */
export function useDialogEditCellOpenRequest(
  rowId: GridRowId | undefined,
  field: string | undefined,
  onOpenRequested: (initialQuery?: string) => void,
): void {
  const context = useContext(DialogEditCellContext);
  const onOpenRequestedRef = useRef(onOpenRequested);
  const handledTokenRef = useRef<number | null>(null);

  useEffect(() => {
    onOpenRequestedRef.current = onOpenRequested;
  }, [onOpenRequested]);

  const cellKey = rowId === undefined || field === undefined
    ? null
    : buildDialogEditCellKey(rowId, field);
  const subscribe = useCallback((notify: () => void) => (
    cellKey !== null ? context?.subscribe(cellKey, notify) ?? unsubscribeEmpty : unsubscribeEmpty
  ), [cellKey, context]);
  const getSnapshot = useCallback(() => (
    cellKey !== null ? context?.getRequest(cellKey) ?? null : null
  ), [cellKey, context]);
  const request = useSyncExternalStore(subscribe, getSnapshot, getEmptySnapshot);

  useEffect(() => {
    if (!request || handledTokenRef.current === request.token) {
      return;
    }
    handledTokenRef.current = request.token;
    context?.consumeRequest(request.token);
    onOpenRequestedRef.current(request.initialQuery);
  }, [context, request]);
}
