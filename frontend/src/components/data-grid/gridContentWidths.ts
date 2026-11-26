import type { GridApi, GridColDef, GridValidRowModel } from '@mui/x-data-grid';

export type ColumnText = { text: string; extra?: number; fontSize?: number; fontWeight?: number };

export interface ColumnMeasurement<R extends GridValidRowModel> {
  cell?: (row: R) => ColumnText;
  header?: ColumnText;
  headerExtra?: number;
  defaultMax?: number;
}

export interface GridSizingContents<R extends GridValidRowModel> {
  /** The full loaded dataset for this scope, before local sorting or filtering. */
  rows: readonly R[];
  ready: boolean;
  scope: string;
  measurements?: Readonly<Partial<Record<string, ColumnMeasurement<R>>>>;
}

const CELL_PADDING = 22;
const HEADER_PADDING = 22;
const SORT_CONTROL = 24;
const MENU_CONTROL = 24;
const AUTO_WIDTH_MAX = 250;

export function createColumnTextMeasurer() {
  const body = typeof document === 'undefined' ? null : getComputedStyle(document.body);
  const font = body?.fontFamily || 'Roboto, Arial, sans-serif';
  const context = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d')
    : typeof CanvasRenderingContext2D === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  const cache = new Map<string, number>();
  return ({ text, fontSize = 14, fontWeight = 400 }: ColumnText): number => {
    const specification = `${fontWeight} ${fontSize}px ${font}`;
    const key = `${specification}\0${text}`;
    const previous = cache.get(key);
    if (previous !== undefined) return previous;
    if (context) context.font = specification;
    const lines = text.split(/\r?\n/);
    const width = lines.reduce((max, line) => Math.max(max,
      context?.measureText(line).width ?? Array.from(line).length * fontSize * 0.58), 0);
    cache.set(key, width);
    return width;
  };
}

function displayValue<R extends GridValidRowModel>(column: GridColDef<R>, row: R): ColumnText {
  const raw = row[column.field];
  // The supported grid formatters are value/row based. A column that depends
  // on a mounted grid or displays other text supplies its own cell measurement.
  const detachedApi = { current: null } as unknown as { current: GridApi };
  let shown = raw;
  try {
    const value = column.valueGetter ? column.valueGetter(raw as never, row, column, detachedApi) : raw;
    shown = column.valueFormatter ? column.valueFormatter(value as never, row, column, detachedApi) : value;
  } catch {
    // Keep a scalar value measurable even when an optional formatter needs the live grid.
  }
  return { text: typeof shown === 'string' || typeof shown === 'number' ? String(shown) : '' };
}

export function measureGridColumn<R extends GridValidRowModel>(
  column: GridColDef<R>, rows: readonly R[], config: ColumnMeasurement<R> | undefined,
  measure: (part: ColumnText) => number, automatic: boolean,
): number {
  const header = config?.header ?? { text: column.headerName ?? column.field, fontWeight: 500 };
  const heading = Math.ceil(measure(header) + HEADER_PADDING + (header.extra ?? 0)
    + (column.sortable === false ? 0 : SORT_CONTROL) + (column.disableColumnMenu ? 0 : MENU_CONTROL)
    + (config?.headerExtra ?? 0));
  const min = column.minWidth ?? 72;
  const max = column.maxWidth ?? Infinity;
  const cap = Math.max(min, heading, config?.defaultMax ?? AUTO_WIDTH_MAX);
  let width = Math.max(min, heading);
  for (const row of rows) {
    const content = config?.cell ? config.cell(row) : displayValue(column, row);
    width = Math.max(width, Math.ceil(CELL_PADDING + (content.extra ?? 0) + measure(content)));
    if (automatic && width >= cap) return Math.min(max, cap);
  }
  return Math.min(max, width);
}
