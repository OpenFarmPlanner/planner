import { useCallback, useEffect, useRef } from 'react';

import { createTransientId } from '../utils/transientId';

interface UseOverlayHistoryOptions {
  open: boolean;
  onClose: () => void;
  historyKey?: string;
  enabled?: boolean;
}

const DEFAULT_OVERLAY_HISTORY_KEY = 'openFarmPlannerOverlay';

function getHistoryState(): Record<string, unknown> {
  const state = window.history.state;
  return state && typeof state === 'object' ? state as Record<string, unknown> : {};
}

export function useOverlayHistory({
  open,
  onClose,
  historyKey = DEFAULT_OVERLAY_HISTORY_KEY,
  enabled = true,
}: UseOverlayHistoryOptions): (action: () => void) => void {
  const entryIdRef = useRef<string | null>(null);
  const pushedUrlRef = useRef<string | null>(null);
  const closingFromHistoryRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const isCurrentOverlayEntry = useCallback((): boolean => {
    if (entryIdRef.current === null || typeof window === 'undefined') {
      return false;
    }
    return getHistoryState()[historyKey] === entryIdRef.current;
  }, [historyKey]);

  const pushOverlayEntry = useCallback((): void => {
    if (typeof window === 'undefined' || entryIdRef.current !== null) {
      return;
    }
    entryIdRef.current = createTransientId(historyKey);
    pushedUrlRef.current = window.location.href;
    window.history.pushState(
      {
        ...getHistoryState(),
        [historyKey]: entryIdRef.current,
      },
      '',
      window.location.href,
    );
  }, [historyKey]);

  useEffect(() => {
    if (open && enabled) {
      pushOverlayEntry();
    }
  });

  useEffect(() => {
    if (!open || !enabled || typeof window === 'undefined') {
      entryIdRef.current = null;
      pushedUrlRef.current = null;
      return undefined;
    }

    pushOverlayEntry();

    const handlePopState = (): void => {
      if (entryIdRef.current === null || isCurrentOverlayEntry()) {
        return;
      }
      closingFromHistoryRef.current = true;
      entryIdRef.current = null;
      pushedUrlRef.current = null;
      onCloseRef.current();
      queueMicrotask(() => {
        closingFromHistoryRef.current = false;
      });
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      const shouldConsumeOverlayEntry = !closingFromHistoryRef.current
        && isCurrentOverlayEntry()
        && pushedUrlRef.current === window.location.href;
      entryIdRef.current = null;
      pushedUrlRef.current = null;
      if (shouldConsumeOverlayEntry) {
        window.history.back();
      }
    };
  }, [enabled, historyKey, isCurrentOverlayEntry, open, pushOverlayEntry]);

  // A new route would strand the overlay's same-URL history entry behind it.
  return useCallback((action: () => void): void => {
    if (!isCurrentOverlayEntry()) {
      action();
      return;
    }
    entryIdRef.current = null;
    pushedUrlRef.current = null;
    window.addEventListener('popstate', () => queueMicrotask(action), { once: true });
    window.history.back();
  }, [isCurrentOverlayEntry]);
}
