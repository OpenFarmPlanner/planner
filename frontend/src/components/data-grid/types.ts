import type { MutableRefObject, ReactNode } from 'react';
import type { GridColDef, GridColumnVisibilityModel, GridRowId, GridSortModel } from '@mui/x-data-grid';

export interface EditableRow {
  id: number;
  isNew?: boolean;
  __draft?: boolean;
  [key: string]: unknown;
}

export interface DataGridAPI<T> {
  list: () => Promise<{ data: { results: Partial<T>[] } }>;
  create: (data: Partial<T>) => Promise<{ data: T }>;
  update: (id: number, data: Partial<T>) => Promise<{ data: T }>;
  delete: (id: number) => Promise<void>;
}

export interface EditableDataGridCommandApi {
  addRow: () => void;
  editSelectedRow: () => void;
  deleteSelectedRow: () => void;
  deleteRow: (rowId: GridRowId) => void;
  getSelectedRowId: () => GridRowId | null;
  setDraftValues: (rowId: GridRowId, values: Partial<EditableRow>) => Promise<void>;
  commitDraftValues: (rowId: GridRowId, values: Partial<EditableRow>) => Promise<void>;
  reload: () => Promise<void>;
  focusTable: () => void;
  openRowById: (rowId: GridRowId, options?: { startEdit?: boolean }) => void;
  /**
   * Writes values produced by a `dialogEditFields` cell's own popover/dialog.
   * A row that already has an inline edit session open just receives the
   * values into its draft; a row in view mode is saved right away, because a
   * dialog cell never opens an edit session of its own.
   */
  applyDialogEditValues: (rowId: GridRowId, values: Partial<EditableRow>) => Promise<void>;
}

export interface EditableDataGridRowActionHelpers<T extends EditableRow> {
  startEdit: (rowId: GridRowId, field?: string) => void;
  duplicate: (row: T) => void;
  delete: (rowId: GridRowId) => void;
}

export interface EditableDataGridRowAction<T extends EditableRow> {
  id: string;
  label: string;
  icon?: ReactNode;
  color?: 'default' | 'error' | 'primary';
  onClick: (row: T, helpers: EditableDataGridRowActionHelpers<T>) => void;
  disabled?: boolean;
}

export interface DeleteUndoOptions {
  message: string;
  snackbarTestId?: string;
}

export interface EditableDataGridClipboardColumn<T extends EditableRow> {
  field: string;
  headerName: string;
  getValue?: (row: T) => string;
}

export interface NotesFieldConfig {
  field: string;
  labelKey?: string;
  titleKey?: string;
  attachmentNoteIdField?: string;
  attachmentCountField?: string;
  compactIndicator?: boolean;
}

export interface EditableDataGridProps<T extends EditableRow> {
  columns: GridColDef[];
  api: DataGridAPI<T>;
  createNewRow: () => T;
  mapToRow: (item: T) => T;
  mapToApiData: (row: T) => Partial<T> | Promise<Partial<T>>;
  validateRow: (row: T) => string | null;
  loadErrorMessage: string;
  saveErrorMessage: string;
  deleteErrorMessage: string;
  deleteConfirmMessage: string;
  addButtonLabel: string;
  addButtonText?: string;
  showDeleteAction?: boolean;
  initialRow?: Partial<T>;
  tableKey?: string;
  defaultSortModel?: GridSortModel;
  persistSortInUrl?: boolean;
  notes?: {
    fields: NotesFieldConfig[];
  };
  /**
   * Fields whose value is only ever picked in a popover/dialog that the
   * column's own `renderCell` owns (e.g. the Standort → Parzelle → Beet
   * picker). Like notes cells these never open the inline row-edit mode: a
   * single left click — or Enter/Space on the focused cell — opens the real
   * editor, while Tab/arrow navigation still treats the cell as a stop.
   * Columns listed here must stay `editable: false` and write their result
   * back through `EditableDataGridCommandApi.applyDialogEditValues`.
   */
  dialogEditFields?: string[];
  commandApiRef?: MutableRefObject<EditableDataGridCommandApi | null>;
  onSelectedRowChange?: (row: T | null) => void;
  getRowValidationErrors?: (row: T) => Record<string, string>;
  showAddAction?: boolean;
  showFooterEditControls?: boolean;
  showRowEditActions?: boolean;
  getRowActions?: (row: T, helpers: EditableDataGridRowActionHelpers<T>) => EditableDataGridRowAction<T>[];
  inlineRowActionField?: string;
  getInlineRowActions?: (row: T, helpers: EditableDataGridRowActionHelpers<T>) => EditableDataGridRowAction<T>[];
  showInlineRowActionMenu?: boolean;
  duplicateRow?: (row: T) => T;
  deleteUndoOptions?: DeleteUndoOptions;
  clipboardColumns?: EditableDataGridClipboardColumn<T>[];
  onRowsStateChange?: (rows: T[]) => void;
  onLoadStateChange?: (state: { loading: boolean; dataFetched: boolean; error: string }) => void;
  onBeforeSaveRow?: (row: T) => boolean | Partial<T> | Promise<boolean | Partial<T>>;
  /**
   * Determines whether an unsaved new row can be discarded on blur without
   * running save validation.
   */
  isNewRowEmpty?: (row: T) => boolean;
  isSaveErrorHandled?: (error: unknown) => boolean;
  /**
   * Optional action (e.g. a link to fix the cause) shown inside the save
   * error alert for a rejected save of `row`.
   */
  getSaveErrorAction?: (error: unknown, row: T) => ReactNode;
  surfaceSizing?: 'contentFit' | 'fullWorkspace' | 'compact';
  paginationPageSizeOptions?: number[];
  initialPageSize?: number;
  scrollMode?: 'autoHeight' | 'continuous';
  /**
   * Column visibility model. Pass `columnVisibilityModel` from
   * `useColumnVisibility`.
   */
  columnVisibilityModel?: GridColumnVisibilityModel;
  /**
   * Called when the user changes column visibility via a column header's
   * own native "Manage columns" menu. Pass `setColumnVisibilityModel` from
   * `useColumnVisibility`.
   */
  onColumnVisibilityModelChange?: (model: GridColumnVisibilityModel) => void;
  /**
   * Controls MUI's built-in "manage columns" panel from outside the grid
   * (e.g. a toolbar "Columns" button), on top of the panel already being
   * reachable through each column header's own menu. The grid opens/closes
   * the panel via `apiRef.showPreferences`/`hidePreferences` as this
   * changes, and calls `onColumnsPanelOpenChange(false)` back when the panel
   * is dismissed some other way (Escape, click-away).
   */
  columnsPanelOpen?: boolean;
  onColumnsPanelOpenChange?: (open: boolean) => void;
  /**
   * A page-owned filter that replaces MUI's built-in filter model, so the
   * page's own search/filter state is the only filter state. See
   * `ExternalRowFilter`.
   */
  externalFilter?: ExternalRowFilter<T>;
}

/**
 * Hands filtering to the page. The grid then ignores MUI's (and any stored)
 * filter model, and the column menu's "Filter" entry calls
 * `onOpenFilterPanel` instead of opening MUI's filter panel.
 */
export interface ExternalRowFilter<T extends EditableRow> {
  /**
   * Rows for which this returns false are hidden. Unsaved new rows and rows
   * in edit mode always stay visible, so an edit never makes its own row
   * vanish. `undefined` while no filter is active.
   */
  isRowVisible?: (row: T) => boolean;
  onOpenFilterPanel: () => void;
  /** Rows whose notes cell is marked as a search hit. */
  highlightedNoteRowIds?: ReadonlySet<GridRowId>;
}
