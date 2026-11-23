import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GridColDef, GridEventListener } from '@mui/x-data-grid';

type Widths = Record<string, number>;
type WidthReset = { enabled: boolean; reset: () => void };

declare module '@mui/x-data-grid' {
  interface ColumnsManagementPropsOverrides {
    widthReset?: WidthReset;
  }
}

const DEFAULT_WIDTH = 100;
const MIN_WIDTH = 72;
const MAX_WIDTH = 720;

function readWidths(key: string): Widths {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, width]) =>
      typeof width === 'number' && Number.isFinite(width) && width > 0,
    ));
  } catch {
    return {};
  }
}

export function useGridColumnSizing(
  columns: GridColDef[],
  table: string,
  userId: number | null | undefined,
  projectId: number | null | undefined,
) {
  const key = `tableColumnWidths.${userId ?? 'guest'}.${projectId ?? 'none'}.${table}`;
  const [state, setState] = useState(() => ({ key, widths: readWidths(key) }));
  const current = useMemo(() => state.key === key ? state : { key, widths: readWidths(key) }, [state, key]);
  if (state !== current) setState(current);

  // Native autosizing may publish several width changes in one event batch.
  const pending = useRef(current);
  useLayoutEffect(() => { pending.current = current; }, [current]);
  const update = useCallback((updateWidths: (previous: Widths) => Widths) => {
    const previous = pending.current.key === key ? pending.current.widths : current.widths;
    const widths = updateWidths(previous);
    if (widths === previous) return;
    const next = { key, widths };
    pending.current = next;
    setState(next);
    try {
      if (Object.keys(widths).length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(widths));
    } catch {
      // Keep the in-session preference if browser storage is unavailable.
    }
  }, [current.widths, key]);

  const definitions = useMemo(() => columns.map(column => ({
    ...column,
    minWidth: column.minWidth ?? MIN_WIDTH,
    maxWidth: column.maxWidth ?? MAX_WIDTH,
    width: column.width ?? DEFAULT_WIDTH,
    flex: column.flex ?? 0,
  })), [columns]);

  const sizedColumns = useMemo(() => definitions.map(column => {
    const width = Object.hasOwn(current.widths, column.field) ? current.widths[column.field] : undefined;
    return width === undefined || column.resizable === false ? column : {
      ...column,
      width: Math.max(column.minWidth, Math.min(column.maxWidth, width)),
      flex: 0,
    };
  }), [current.widths, definitions]);

  const onColumnWidthChange = useCallback<GridEventListener<'columnWidthChange'>>(({ colDef, width }) => {
    const column = definitions.find(({ field }) => field === colDef.field);
    if (!column || column.resizable === false || !Number.isFinite(width)) return;
    update(previous => {
      const override = !column.flex && Math.round(width) === Math.round(column.width) ? undefined : Math.round(width);
      if (previous[column.field] === override) return previous;
      const next = { ...previous };
      if (override === undefined) delete next[column.field];
      else next[column.field] = override;
      return next;
    });
  }, [definitions, update]);

  const reset = useCallback(() => update(() => ({})), [update]);
  const enabled = definitions.some(column =>
    column.resizable !== false && Object.hasOwn(current.widths, column.field)
      && (column.flex !== 0 || current.widths[column.field] !== column.width),
  );
  return { columns: sizedColumns, onColumnWidthChange, widthReset: { enabled, reset } };
}

export const columnAutosizeOptions = { includeHeaders: true, includeOutliers: false };

export const resizableGridHeaderSx = {
  // MUI measures scrollWidth while this class is active. Stretching the
  // custom label to the current width would make auto-fit unable to shrink.
  '&.MuiDataGrid-autosizing .MuiDataGrid-columnHeaderTitleContainerContent': {
    flex: '0 0 auto',
    width: 'max-content',
    maxWidth: 'none',
  },
  '&.MuiDataGrid-autosizing .MuiDataGrid-columnHeaderTitleContainerContent > span': {
    width: 'auto',
    maxWidth: 'none',
  },
  // Reserve the controls revealed on hover even during the native width
  // measurement, when MUI would otherwise collapse the menu to zero width.
  '&.MuiDataGrid-autosizing .MuiDataGrid-columnHeader .MuiDataGrid-menuIcon, &.MuiDataGrid-autosizing .MuiDataGrid-columnHeader .MuiDataGrid-iconButtonContainer': {
    width: 'auto !important',
  },
  '& .MuiDataGrid-columnSeparator--resizable': {
    maxWidth: 14,
    width: 14,
    touchAction: 'none',
  },
  '& .MuiDataGrid-columnSeparator--sideRight.MuiDataGrid-columnSeparator--resizable': { right: -6 },
  '& .MuiDataGrid-columnSeparator--sideLeft.MuiDataGrid-columnSeparator--resizable': { left: -6 },
  '@media (pointer: coarse)': {
    '& .MuiDataGrid-columnSeparator--resizable': { maxWidth: 22, width: 22 },
  },
} as const;
