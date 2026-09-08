import { useCallback, useState } from 'react';

/** Per-row, per-field validation messages, keyed by the row's string id. */
export type RowFieldErrors = Record<string, Record<string, string>>;

export interface RowEditTracking {
  /** String ids of rows with unsaved local edits. */
  dirtyRowIds: Set<string>;
  activeValidationErrors: RowFieldErrors;
  markRowDirty: (rowKey: string) => void;
  /**
   * Drop everything tracked about these rows. A row can be tracked under two
   * keys at once - its temporary id and the id the server gave it - so this
   * takes several.
   */
  forgetRows: (...rowKeys: string[]) => void;
  setRowFieldErrors: (rowKey: string, fieldErrors: Record<string, string>) => void;
}

/**
 * What the grid knows about rows the user has touched: which ones are dirty,
 * and which fields on them failed validation.
 *
 * The two travel together. Every point that stops tracking a row - cancelling
 * an edit, saving it, removing it - has to forget both, and forgetting only
 * one leaves either a stale "unsaved changes" guard or an error message on a
 * row that is gone.
 */
export function useRowEditTracking(): RowEditTracking {
  const [dirtyRowIds, setDirtyRowIds] = useState<Set<string>>(new Set());
  const [activeValidationErrors, setActiveValidationErrors] = useState<RowFieldErrors>({});

  const markRowDirty = useCallback((rowKey: string): void => {
    setDirtyRowIds((previous) => {
      if (previous.has(rowKey)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(rowKey);
      return next;
    });
  }, []);

  const forgetRows = useCallback((...rowKeys: string[]): void => {
    setDirtyRowIds((previous) => {
      if (!rowKeys.some((rowKey) => previous.has(rowKey))) {
        return previous;
      }
      const next = new Set(previous);
      rowKeys.forEach((rowKey) => next.delete(rowKey));
      return next;
    });
    setActiveValidationErrors((previous) => {
      if (!rowKeys.some((rowKey) => rowKey in previous)) {
        return previous;
      }
      const next = { ...previous };
      rowKeys.forEach((rowKey) => delete next[rowKey]);
      return next;
    });
  }, []);

  const setRowFieldErrors = useCallback((
    rowKey: string,
    fieldErrors: Record<string, string>,
  ): void => {
    setActiveValidationErrors((previous) => ({ ...previous, [rowKey]: fieldErrors }));
  }, []);

  return {
    dirtyRowIds,
    activeValidationErrors,
    markRowDirty,
    forgetRows,
    setRowFieldErrors,
  };
}
