import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

export function createGridRowSaveStatus() {
  const saving = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    isSaving: (id: string) => saving.has(id),
    setSaving: (id: string, pending: boolean) => {
      if (pending) saving.add(id);
      else saving.delete(id);
      listeners.get(id)?.forEach(notify => notify());
    },
    subscribe: (id: string, notify: () => void) => {
      const subscribed = listeners.get(id) ?? new Set();
      subscribed.add(notify);
      listeners.set(id, subscribed);
      return () => {
        subscribed.delete(notify);
        if (!subscribed.size) listeners.delete(id);
      };
    },
  };
}

export const GridRowSaveStatusContext = createContext<ReturnType<typeof createGridRowSaveStatus> | null>(null);
export const gridRowSaveStatusSx = {
  '& .MuiDataGrid-row[aria-busy="true"], & .MuiDataGrid-row[aria-busy="true"] :is(.MuiDataGrid-cell, input)': {
    cursor: 'progress',
  },
};
const unsubscribeEmpty = () => {};
const getServerSnapshot = () => false;

export function useGridRowSaving(id: string): boolean {
  const status = useContext(GridRowSaveStatusContext);
  const subscribe = useCallback(
    (notify: () => void) => status?.subscribe(id, notify) ?? unsubscribeEmpty, [id, status],
  );
  const getSnapshot = useCallback(() => status?.isSaving(id) ?? false, [id, status]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
