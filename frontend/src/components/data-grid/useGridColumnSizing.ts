import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GridColDef, GridEventListener, GridValidRowModel } from '@mui/x-data-grid';
import { createColumnTextMeasurer, measureGridColumn, type GridSizingContents } from './gridContentWidths';

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

export function useGridColumnSizing<R extends GridValidRowModel = GridValidRowModel>(
  columns: GridColDef<R>[],
  table: string,
  userId: number | null | undefined,
  projectId: number | null | undefined,
  contents?: GridSizingContents<R>,
) {
  const key = `tableColumnWidths.${userId ?? 'guest'}.${projectId ?? 'none'}.${table}`;
  const [state, setState] = useState(() => ({ key, widths: readWidths(key) }));
  const current = useMemo(() => state.key === key ? state : { key, widths: readWidths(key) }, [state, key]);
  if (state !== current) setState(current);

  const [defaultRevision, setDefaultRevision] = useState(0);
  const defaultKey = contents ? `${key}.${contents.scope}.${defaultRevision}` : null;
  const [measured, setMeasured] = useState<{ key: string; widths: Widths } | null>(null);
  const hasMeasuredDefaults = measured !== null && measured.key === defaultKey;
  const contentDefaults = hasMeasuredDefaults ? measured.widths : undefined;

  useEffect(() => {
    if (!contents?.ready || defaultKey === null || hasMeasuredDefaults) return;
    let active = true;
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    void Promise.resolve(fonts?.ready).then(() => {
      if (!active) return;
      const measure = createColumnTextMeasurer();
      const widths = Object.fromEntries(columns.filter(column => column.resizable !== false).map(column => [
        column.field,
        measureGridColumn(column, contents.rows, contents.measurements?.[column.field], measure, true),
      ]));
      setMeasured({ key: defaultKey, widths });
    });
    return () => { active = false; };
  }, [columns, contents, defaultKey, hasMeasuredDefaults]);

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
    maxWidth: column.maxWidth ?? (defaultKey === null ? MAX_WIDTH : Infinity),
    width: contentDefaults?.[column.field] ?? column.width ?? DEFAULT_WIDTH,
    flex: defaultKey !== null && column.resizable !== false ? 0 : column.flex ?? 0,
  })), [columns, contentDefaults, defaultKey]);

  const sizedColumns = useMemo(() => definitions.map(column => {
    const width = Object.hasOwn(current.widths, column.field) ? current.widths[column.field] : undefined;
    return width === undefined || column.resizable === false ? column : {
      ...column,
      width: Math.max(column.minWidth, Math.min(column.maxWidth, width)),
      flex: 0,
    };
  }), [current.widths, definitions]);

  const setUserWidth = useCallback((field: string, width: number) => {
    const column = definitions.find(definition => definition.field === field);
    if (!column || column.resizable === false || !Number.isFinite(width)) return;
    update(previous => {
      const rounded = Math.round(Math.max(column.minWidth, Math.min(column.maxWidth, width)));
      const override = defaultKey === null && !column.flex && rounded === Math.round(column.width) ? undefined : rounded;
      if (previous[column.field] === override) return previous;
      const next = { ...previous };
      if (override === undefined) delete next[column.field];
      else next[column.field] = override;
      return next;
    });
  }, [defaultKey, definitions, update]);
  const onColumnWidthChange = useCallback<GridEventListener<'columnWidthChange'>>(
    ({ colDef, width }) => setUserWidth(colDef.field, width),
    [setUserWidth],
  );

  const autoFit = useCallback((field: string) => {
    if (!contents?.ready) return undefined;
    const column = columns.find(item => item.field === field);
    if (!column || column.resizable === false) return undefined;
    return measureGridColumn(column, contents.rows, contents.measurements?.[field], createColumnTextMeasurer(), false);
  }, [columns, contents]);
  const reset = useCallback(() => {
    update(() => ({}));
    if (defaultKey !== null) setDefaultRevision(previous => previous + 1);
  }, [defaultKey, update]);
  const enabled = definitions.some(column =>
    column.resizable !== false && Object.hasOwn(current.widths, column.field)
      && (defaultKey !== null || column.flex !== 0 || current.widths[column.field] !== column.width),
  );
  return {
    columns: sizedColumns,
    onColumnWidthChange,
    setUserWidth,
    widthReset: { enabled, reset },
    autoFit: contents ? autoFit : undefined,
    defaultsPending: defaultKey !== null && !hasMeasuredDefaults,
  };
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
