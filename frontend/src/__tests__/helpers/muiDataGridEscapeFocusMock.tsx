import React from 'react';
import type { GridColDef } from '@mui/x-data-grid';

type MockRow = { id: string | number; [key: string]: unknown };

/**
 * A trimmed, column-agnostic mock of `@mui/x-data-grid`'s `<DataGrid>`,
 * for pages whose real column config (selects, dates, etc.) is too heavy
 * to render for real in jsdom. Renders one "Zelle {id}-{field}" button per
 * cell (driven entirely by whatever `columns` the host component passes,
 * not hardcoded field names) plus an "ESC {id}" button that fires Escape
 * on whichever field the row is currently editing — enough to exercise
 * DataGrid.tsx's real edit/cancel/focus-restoration logic end-to-end.
 */
export function createMuiDataGridEscapeFocusMock() {
  const mockStopRowEditMode = () => {};
  const useGridApiRef = () => React.useRef({
    setEditCellValue: async () => true,
    stopRowEditMode: mockStopRowEditMode,
  });
  const GridRowModes = { Edit: 'edit', View: 'view' };
  const GridRowEditStopReasons = {
    rowFocusOut: 'rowFocusOut',
    enterKeyDown: 'enterKeyDown',
    tabKeyDown: 'tabKeyDown',
    escapeKeyDown: 'escapeKeyDown',
  };
  const getMockFilterOperators = () => [{ value: 'contains', getApplyFilterFn: () => () => true }];

  const DataGrid = (props: {
    apiRef?: { current: Record<string, unknown> | null };
    rows: MockRow[];
    columns: GridColDef[];
    onCellClick?: (
      params: { id: string | number; field: string; isEditable: boolean },
      event: { preventDefault: () => void; stopPropagation: () => void; defaultMuiPrevented?: boolean },
    ) => void;
    onCellDoubleClick?: (
      params: { id: string | number; field: string; isEditable: boolean },
      event: React.MouseEvent,
    ) => void;
    onCellKeyDown?: (
      params: { id: string | number; field: string; isEditable?: boolean; row?: MockRow },
      event: { key: string; preventDefault: () => void; defaultMuiPrevented?: boolean },
    ) => void;
    onRowSelectionModelChange?: (model: { type: string; ids: Set<string | number> }) => void;
    rowModesModel?: Record<string | number, { mode: string; fieldToFocus?: string }>;
  }) => {
    const { apiRef, rows, columns, onCellClick, onCellDoubleClick, onCellKeyDown, onRowSelectionModelChange, rowModesModel } = props;
    const [, forceFocusRender] = React.useState(0);
    const [focusedCell, setFocusedCell] = React.useState('none');

    React.useEffect(() => {
      if (!apiRef?.current) {
        return;
      }

      const api = apiRef.current;
      api.state = api.state ?? { focus: { cell: null } };
      api.getVisibleColumns = () => columns;
      api.getAllRowIds = () => rows.map((row) => row.id);
      api.getRowWithUpdatedValues = (id: string | number) =>
        rows.find((row) => String(row.id) === String(id)) ?? null;
      api.getRowIndexRelativeToVisibleRows = (id: string | number) =>
        rows.findIndex((row) => String(row.id) === String(id));
      api.getColumnIndexRelativeToVisibleColumns = (field: string) =>
        columns.findIndex((column) => column.field === field);
      api.isCellEditable = (params: { field: string }) =>
        columns.find((column) => column.field === params.field)?.editable !== false;
      api.getCellParams = (id: string | number, field: string) => {
        const row = rows.find((currentRow) => String(currentRow.id) === String(id));
        return { id, field, row };
      };
      api.scrollToIndexes = () => {};
      api.setCellFocus = (id: string | number, field: string) => {
        (api.state as { focus: { cell: unknown } }).focus.cell = { id, field };
        setFocusedCell(`${id}-${field}`);
        forceFocusRender((version) => version + 1);
      };
    }, [apiRef, columns, rows]);

    return (
      <div>
        {rows.map((row) => {
          const editedField = rowModesModel?.[row.id]?.fieldToFocus ?? columns[0]?.field;
          return (
            <div key={row.id} role="row" data-testid={`row-${row.id}`}>
              <span data-testid={`mode-${row.id}`}>{rowModesModel?.[row.id]?.mode ?? GridRowModes.View}</span>
              {columns.map((col) => (
                <button
                  key={`${row.id}-${col.field}`}
                  type="button"
                  onClick={() => {
                    if (apiRef?.current) {
                      (apiRef.current.state as { focus: { cell: unknown } }).focus.cell = { id: row.id, field: col.field };
                      setFocusedCell(`${row.id}-${col.field}`);
                    }
                    onRowSelectionModelChange?.({ type: 'include', ids: new Set([row.id]) });
                    onCellClick?.(
                      { id: row.id, field: col.field, isEditable: col.editable !== false },
                      { preventDefault: () => {}, stopPropagation: () => {}, defaultMuiPrevented: false },
                    );
                  }}
                  onDoubleClick={(event) => {
                    onCellDoubleClick?.({ id: row.id, field: col.field, isEditable: col.editable !== false }, event);
                  }}
                >
                  Zelle {row.id}-{col.field}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onCellKeyDown?.(
                  { id: row.id, field: editedField ?? '', row },
                  { key: 'Escape', preventDefault: () => {} },
                )}
              >
                ESC {row.id}
              </button>
            </div>
          );
        })}
        <span data-testid="focused-cell">
          {focusedCell}
        </span>
      </div>
    );
  };

  return {
    DataGrid,
    GridRowModes,
    GridRowEditStopReasons,
    getGridBooleanOperators: getMockFilterOperators,
    getGridDateOperators: getMockFilterOperators,
    getGridNumericOperators: getMockFilterOperators,
    getGridSingleSelectOperators: getMockFilterOperators,
    getGridStringOperators: getMockFilterOperators,
    useGridApiRef,
  };
}
