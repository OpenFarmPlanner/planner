import { useCallback, useEffect, useRef, useState } from 'react';
import type { GridRowId } from '@mui/x-data-grid';
import { HIGHLIGHT_FLASH_DURATION_MS } from '../../feedback/highlightFlashStyles';

const NO_ROWS: ReadonlySet<string> = new Set();

export interface CreatedRowPinning {
  /** Rows created in this session, kept at the top and visible despite filters. */
  pinnedRowKeys: ReadonlySet<string>;
  /** The row that is flashing right now, if any. */
  flashingRowKey: string | null;
  pin: (rowId: GridRowId) => void;
  /** Drops every pin; called when the order is rebuilt (sort change, reload). */
  clear: () => void;
}

/**
 * Keeps freshly created rows of an `EditableDataGrid` with
 * `pinCreatedRowsToTop` at the top until the user re-sorts or the rows are
 * reloaded, and flashes the newest one briefly. The pin never expires on a
 * timer, so a row does not jump away from under the user.
 */
export function useCreatedRowPinning(): CreatedRowPinning {
  const [pinnedRowKeys, setPinnedRowKeys] = useState<ReadonlySet<string>>(NO_ROWS);
  const [flashingRowKey, setFlashingRowKey] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
  }, []);

  const pin = useCallback((rowId: GridRowId): void => {
    const rowKey = String(rowId);
    setPinnedRowKeys((previous) => new Set(previous).add(rowKey));
    setFlashingRowKey(rowKey);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashingRowKey(null);
      flashTimerRef.current = null;
    }, HIGHLIGHT_FLASH_DURATION_MS);
  }, []);

  const clear = useCallback((): void => {
    setPinnedRowKeys((previous) => (previous.size === 0 ? previous : NO_ROWS));
  }, []);

  return { pinnedRowKeys, flashingRowKey, pin, clear };
}
