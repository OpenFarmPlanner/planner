import { createContext, useContext, useEffect, useRef } from 'react';
import type { GridRowId } from '@mui/x-data-grid';

/**
 * `dialogEditFields` cells have no inline edit session — their dialog *is* the
 * edit session. This context is how `EditableDataGrid` tells such a cell that
 * an explicit keyboard edit command wants to start that session by opening its
 * dialog.
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

export interface DialogEditCellContextValue {
  request: DialogEditCellRequest | null;
  consumeRequest: (token: number) => void;
}

export const buildDialogEditCellKey = (rowId: GridRowId, field: string): string =>
  `${String(rowId)}:${field}`;

export const DialogEditCellContext = createContext<DialogEditCellContextValue | null>(null);

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

  const request = context?.request ?? null;
  const consumeRequest = context?.consumeRequest;
  const cellKey = rowId === undefined || field === undefined
    ? null
    : buildDialogEditCellKey(rowId, field);
  const pendingToken = request && cellKey !== null && request.cellKey === cellKey
    ? request.token
    : null;
  const initialQuery = request?.initialQuery;

  useEffect(() => {
    if (pendingToken === null || handledTokenRef.current === pendingToken) {
      return;
    }

    handledTokenRef.current = pendingToken;
    consumeRequest?.(pendingToken);
    onOpenRequestedRef.current(initialQuery);
  }, [consumeRequest, initialQuery, pendingToken]);
}
