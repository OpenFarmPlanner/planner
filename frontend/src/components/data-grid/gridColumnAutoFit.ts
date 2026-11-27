import { createContext, useEffect, type RefObject } from 'react';
import type { GridApi } from '@mui/x-data-grid';

type AutoFitColumn = (field: string) => number | undefined;
export const GridColumnAutoFitContext = createContext<AutoFitColumn | undefined>(undefined);

export function useGridColumnAutoFit(apiRef: RefObject<GridApi | null>, autoFit: AutoFitColumn | undefined) {
  useEffect(() => {
    const api = apiRef.current;
    if (!autoFit || !api?.subscribeEvent) return;
    return api.subscribeEvent('columnSeparatorDoubleClick', ({ field }, event) => {
      event.defaultMuiPrevented = true;
      const width = autoFit(field);
      if (width !== undefined) api.setColumnWidth(field, width);
    }, { isFirst: true });
  }, [apiRef, autoFit]);
}
