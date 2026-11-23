import type { GridColDef, GridValidRowModel } from '@mui/x-data-grid';
import { GridHeaderHelp } from './GridHeaderHelp';

export const CALCULATED_COLUMN_CELL_CLASS = 'ofp-cell-calculated';
export const CALCULATED_COLUMN_HEADER_CLASS = 'ofp-header-calculated';

export type DataGridColumnState = 'calculated';

interface CalculatedColumnConfig {
  headerName: string;
  tooltip: string;
}

export function getCalculatedColumnProps<Row extends GridValidRowModel>({
  headerName,
  tooltip,
}: CalculatedColumnConfig): Pick<GridColDef<Row>, 'cellClassName' | 'description' | 'editable' | 'headerClassName' | 'renderHeader'> {
  return {
    editable: false,
    description: tooltip,
    headerClassName: CALCULATED_COLUMN_HEADER_CLASS,
    cellClassName: CALCULATED_COLUMN_CELL_CLASS,
    renderHeader: () => <GridHeaderHelp label={headerName} description={tooltip} />,
  };
}
