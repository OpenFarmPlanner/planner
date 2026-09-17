import {
  getGridBooleanOperators,
  getGridDateOperators,
  getGridNumericOperators,
  getGridSingleSelectOperators,
  getGridStringOperators,
} from '@mui/x-data-grid';
import type { GridColDef, GridFilterOperator, GridRowId, GridSortModel } from '@mui/x-data-grid';
import { TruncatedTextWithTooltip } from '../TruncatedTextWithTooltip';
import { DateEditCell } from './DateEditCell';
import type { EditableDataGridClipboardColumn, EditableRow } from './types';

export const isUnsavedDraftRow = (row: EditableRow): boolean =>
  Boolean(row.isNew || row.__draft || Number(row.id) < 0);

const DRAFT_METADATA_FIELDS = new Set(['id', 'isNew', '__draft']);

const isEmptyDraftValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
};

export const isEmptyNewDraftRow = (row: EditableRow): boolean =>
  Object.entries(row).every(([field, value]) =>
    DRAFT_METADATA_FIELDS.has(field) || isEmptyDraftValue(value),
  );

export class SaveBlockedError extends Error {
  constructor() {
    super('Save blocked by validation');
    this.name = 'SaveBlockedError';
  }
}

export const isSaveBlockedError = (error: unknown): error is SaveBlockedError =>
  error instanceof SaveBlockedError;

const getDefaultFilterOperators = (column: GridColDef): GridFilterOperator[] => {
  switch (column.type) {
    case 'boolean':
      return getGridBooleanOperators();
    case 'date':
      return getGridDateOperators();
    case 'dateTime':
      return getGridDateOperators(true);
    case 'number':
      return getGridNumericOperators();
    case 'singleSelect':
      return getGridSingleSelectOperators();
    default:
      return getGridStringOperators();
  }
};

const keepDraftRowsVisibleForFilterOperators = (
  operators: readonly GridFilterOperator[],
): GridFilterOperator[] =>
  operators.map((operator) => ({
    ...operator,
    getApplyFilterFn: (filterItem, column) => {
      const applyFilter = operator.getApplyFilterFn(filterItem, column);
      if (!applyFilter) {
        return null;
      }

      return (value, row, filterColumn, apiRef) => {
        if (isUnsavedDraftRow(row as EditableRow)) {
          return true;
        }

        return applyFilter(value, row, filterColumn, apiRef);
      };
    },
  }));

const keepDraftRowsVisibleForColumnFilters = (column: GridColDef): GridColDef => {
  if (column.filterable === false) {
    return column;
  }

  return {
    ...column,
    filterOperators: keepDraftRowsVisibleForFilterOperators(
      column.filterOperators ?? getDefaultFilterOperators(column),
    ),
  };
};

const applyDefaultDateEditCell = (column: GridColDef): GridColDef => {
  if (column.type !== 'date' || column.renderEditCell) {
    return column;
  }

  return {
    ...column,
    renderEditCell: (params) => <DateEditCell {...params} />,
  };
};

const applyDefaultHeaderOverflowTooltip = (column: GridColDef): GridColDef => {
  if (column.renderHeader) {
    return column;
  }

  const headerName = column.headerName ?? column.field;
  return {
    ...column,
    renderHeader: () => <TruncatedTextWithTooltip text={headerName} sx={{ width: '100%' }} />,
  };
};

export const prepareDataGridColumn = (column: GridColDef): GridColDef =>
  keepDraftRowsVisibleForColumnFilters(applyDefaultHeaderOverflowTooltip(applyDefaultDateEditCell(column)));

const getSortableValue = (row: EditableRow, field: string): unknown => row[field];

const compareSortableValues = (leftValue: unknown, rightValue: unknown): number => {
  if (leftValue === rightValue) {
    return 0;
  }
  if (leftValue === null || leftValue === undefined || leftValue === '') {
    return 1;
  }
  if (rightValue === null || rightValue === undefined || rightValue === '') {
    return -1;
  }
  if (leftValue instanceof Date || rightValue instanceof Date) {
    const leftTime = leftValue instanceof Date ? leftValue.getTime() : new Date(String(leftValue)).getTime();
    const rightTime = rightValue instanceof Date ? rightValue.getTime() : new Date(String(rightValue)).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }
  }
  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue;
  }
  if (typeof leftValue === 'boolean' && typeof rightValue === 'boolean') {
    return Number(leftValue) - Number(rightValue);
  }
  return String(leftValue).localeCompare(String(rightValue), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
};

export const getSortedRowIds = <T extends EditableRow>(
  sourceRows: readonly T[],
  model: GridSortModel,
): GridRowId[] => {
  const [sortItem] = model;
  if (!sortItem?.field || !sortItem.sort) {
    return sourceRows.map((row) => row.id);
  }

  const direction = sortItem.sort === 'desc' ? -1 : 1;
  return sourceRows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const comparison = compareSortableValues(
        getSortableValue(left.row, sortItem.field),
        getSortableValue(right.row, sortItem.field),
      );
      return comparison === 0 ? left.index - right.index : comparison * direction;
    })
    .map(({ row }) => row.id);
};

export const orderRowsByStableIds = <T extends EditableRow>(
  sourceRows: readonly T[],
  orderedIds: readonly GridRowId[],
): T[] => {
  if (orderedIds.length === 0) {
    return [...sourceRows];
  }

  const rowsById = new Map(sourceRows.map((row) => [String(row.id), row]));
  const orderedRows = orderedIds
    .map((rowId) => rowsById.get(String(rowId)))
    .filter((row): row is T => row !== undefined);
  const orderedIdKeys = new Set(orderedIds.map(String));
  const missingRows = sourceRows.filter((row) => !orderedIdKeys.has(String(row.id)));
  return [...orderedRows, ...missingRows];
};

/**
 * Derives the default set of clipboard columns from the grid columns, dropping
 * the id and action columns and falling back to the field name when a column
 * has no header. Used when no explicit clipboard column config is provided.
 */
export const buildDefaultClipboardColumns = <T extends EditableRow>(
  columns: readonly GridColDef[],
): EditableDataGridClipboardColumn<T>[] =>
  columns
    .filter((column) => column.field !== 'id' && column.field !== 'actions' && column.type !== 'actions')
    .map((column) => ({
      field: column.field,
      headerName: column.headerName ?? column.field,
    }));
