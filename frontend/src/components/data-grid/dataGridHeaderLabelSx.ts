/**
 * The bold label inside a custom `renderHeader`, matching what the DataGrid
 * renders for a plain `headerName` (the theme's `MuiDataGrid.columnHeaderTitle`
 * override). Kept in its own module, not `styles.ts`, so that
 * `calculatedColumns.tsx` and `dataGridUtils.tsx` — which `styles.ts` itself
 * imports class names from — can use it without a circular import.
 */
export const dataGridHeaderLabelSx = { fontWeight: 600 };
