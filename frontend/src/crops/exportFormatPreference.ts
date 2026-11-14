/**
 * The crop export format is a per-viewer convenience: the dialog preselects
 * the format this browser used last. A first-time export defaults to the
 * open OpenDocument format.
 */
import type { SpreadsheetExportFormat } from './spreadsheetExport';

export type CropExportFormat = SpreadsheetExportFormat | 'json';

export const DEFAULT_EXPORT_FORMAT: CropExportFormat = 'ods';
const EXPORT_FORMAT_STORAGE_KEY = 'ofp.crops.exportFormat';
const EXPORT_FORMATS: readonly CropExportFormat[] = ['ods', 'xlsx', 'csv', 'json'];

const isExportFormat = (value: string | null): value is CropExportFormat => (
  value !== null && (EXPORT_FORMATS as readonly string[]).includes(value)
);

export function readStoredExportFormat(unavailableFallback = DEFAULT_EXPORT_FORMAT): CropExportFormat {
  try {
    const stored = window.localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY);
    return isExportFormat(stored) ? stored : DEFAULT_EXPORT_FORMAT;
  } catch {
    return unavailableFallback;
  }
}

export function storeExportFormat(format: CropExportFormat): boolean {
  try {
    window.localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, format);
    return true;
  } catch {
    // Let the caller retain the successful choice for this visit.
    return false;
  }
}
