// State of the contextual "double-click, Enter or just start typing" hint
// shared by every inline-editing table: one flag and one display counter per
// user, stored on the server (see backend accounts/table_edit_hint.py) so the
// hint is retired on every device at once. The module-level store carries
// changes across tables within the session without waiting for a /me reload;
// it is read only when the hint is about to show, so nothing subscribes to it.
import { useCallback, useContext, useRef, useState } from 'react';
import { AuthContext } from '../../auth/authContextShared';
import { recordTableEditHintEvent } from '../../auth/authApi';
import type { TableEditHintEvent, TableEditHintState } from '../../auth/types';

export const TABLE_EDIT_HINT_MAX_SHOWN = 3;

const NEVER_SHOWN: TableEditHintState = { done: false, shown_count: 0 };
const ANONYMOUS_KEY = 'anonymous';

const sessionStates = new Map<string, TableEditHintState>();

const writeState = (key: string, next: TableEditHintState): void => {
  sessionStates.set(key, next);
};

const mergeServerState = (key: string, server: TableEditHintState): void => {
  const local = sessionStates.get(key) ?? NEVER_SHOWN;
  const done = local.done || server.done;
  const shownCount = Math.max(local.shown_count, server.shown_count);
  if (done !== local.done || shownCount !== local.shown_count) {
    writeState(key, { done, shown_count: shownCount });
  }
};

export function isTableEditHintRetired(state: TableEditHintState): boolean {
  return state.done || state.shown_count >= TABLE_EDIT_HINT_MAX_SHOWN;
}

/** Only for tests: forget everything the session learned about the hint. */
export function resetTableEditHintSessionState(): void {
  sessionStates.clear();
}

export interface EditHintControls {
  open: boolean;
  /** The cell the visible hint points at. */
  anchorEl: HTMLElement | null;
  /**
   * Show the hint at `anchorEl` unless it is retired or was already shown
   * since this table mounted: once per page visit, so moving on to other
   * cells does not bring it back and use up its displays.
   */
  requestHint: (anchorEl: HTMLElement) => void;
  /** The user started an edit by double click, Enter, F2 or typing. */
  markEdited: () => void;
  /** Hidden by the timeout, the next click, scrolling or Escape; does not retire the hint. */
  close: () => void;
  /** The close button: retires the hint for good. */
  dismiss: () => void;
}

export function useEditHint(): EditHintControls {
  const user = useContext(AuthContext)?.user ?? null;
  const key = user ? `user:${user.id}` : ANONYMOUS_KEY;
  const seed = user?.table_edit_hint ?? NEVER_SHOWN;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = anchorEl !== null;
  const shownSinceMountRef = useRef(false);

  const report = useCallback((event: TableEditHintEvent): void => {
    if (key === ANONYMOUS_KEY) {
      return;
    }
    // Best effort: a failed write only means the hint may show once more.
    recordTableEditHintEvent(event)
      .then((serverState) => mergeServerState(key, serverState))
      .catch(() => undefined);
  }, [key]);

  const requestHint = useCallback((nextAnchorEl: HTMLElement): void => {
    const current = sessionStates.get(key) ?? seed;
    if (shownSinceMountRef.current || isTableEditHintRetired(current)) {
      return;
    }
    shownSinceMountRef.current = true;
    const shownCount = current.shown_count + 1;
    writeState(key, {
      done: shownCount >= TABLE_EDIT_HINT_MAX_SHOWN,
      shown_count: shownCount,
    });
    setAnchorEl(nextAnchorEl);
    report('shown');
  }, [key, report, seed]);

  const retire = useCallback((event: Exclude<TableEditHintEvent, 'shown'>): void => {
    setAnchorEl(null);
    const current = sessionStates.get(key) ?? seed;
    if (current.done) {
      return;
    }
    writeState(key, { ...current, done: true });
    report(event);
  }, [key, report, seed]);

  const markEdited = useCallback((): void => retire('edited'), [retire]);
  const dismiss = useCallback((): void => retire('dismissed'), [retire]);
  const close = useCallback((): void => setAnchorEl(null), []);

  return {
    open,
    anchorEl,
    requestHint,
    markEdited,
    close,
    dismiss,
  };
}
