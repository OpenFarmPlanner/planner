import { showGlobalSnackbar, type GlobalSnackbarSeverity } from '../../utils/globalSnackbar';
import { getActiveFormattingLocale } from '../../utils/numberLocalization';
import type { EditableDataGridClipboardColumn, EditableRow } from './types';

export type TableClipboardRow = readonly string[];

interface ClipboardSnackbarDetail {
  message: string;
  severity?: GlobalSnackbarSeverity;
}

interface CopyRowsToClipboardOptions {
  rows: readonly TableClipboardRow[];
  successMessage: string;
  errorMessage: string;
  errorLogMessage?: string;
}

const sanitizeTsvCell = (value: string): string => value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();

export function formatClipboardValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toLocaleDateString(getActiveFormattingLocale());
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatClipboardValue).filter(Boolean).join(', ');
  }
  return String(value);
}

/**
 * Maps a single row to its clipboard cell values, honoring per-column
 * `getValue` overrides and falling back to the shared value formatter.
 */
export function buildClipboardRowValues<T extends EditableRow>(
  columns: readonly EditableDataGridClipboardColumn<T>[],
  row: T,
): TableClipboardRow {
  return columns.map((column) => (
    column.getValue ? column.getValue(row) : formatClipboardValue(row[column.field])
  ));
}

/**
 * Builds the full clipboard table: a header row of column names followed by one
 * formatted values row per data row.
 */
export function buildClipboardTableRows<T extends EditableRow>(
  columns: readonly EditableDataGridClipboardColumn<T>[],
  rows: readonly T[],
): TableClipboardRow[] {
  return [
    columns.map((column) => column.headerName),
    ...rows.map((row) => buildClipboardRowValues(columns, row)),
  ];
}

export function buildTsv(rows: readonly TableClipboardRow[]): string {
  return rows
    .map((row) => row.map(sanitizeTsvCell).join('\t'))
    .join('\n');
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is not available.');
  }
  await navigator.clipboard.writeText(text);
}

export function copyTextToClipboardSilently(text: string): void {
  void copyTextToClipboard(text).catch(() => undefined);
}

function showClipboardSnackbar(detail: ClipboardSnackbarDetail): void {
  showGlobalSnackbar(detail);
}

export async function copyRowsToClipboard({
  rows,
  successMessage,
  errorMessage,
  errorLogMessage = 'Error copying table data',
}: CopyRowsToClipboardOptions): Promise<void> {
  try {
    await copyTextToClipboard(buildTsv(rows));
    showClipboardSnackbar({ message: successMessage, severity: 'success' });
  } catch (error) {
    console.error(errorLogMessage, error);
    showClipboardSnackbar({ message: errorMessage, severity: 'error' });
  }
}
