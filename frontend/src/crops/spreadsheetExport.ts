import type { Crop } from '../api/types';
import { toPortableCrop, slugifyFilenamePart } from './exportUtils';
import { getLocalizedCropColumns } from './spreadsheetColumns';
import { formatIsoDate } from '../utils/isoDate';
import { buildSpreadsheetFile } from './spreadsheetFile';
import type { SpreadsheetFormat } from './spreadsheetTypes';

export type SpreadsheetExportFormat = SpreadsheetFormat;

const MIME_TYPES: Record<SpreadsheetExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv;charset=utf-8',
};

export const buildSheetData = (crops: Crop[], t: (key: string) => string): (string | number | null)[][] => {
  const cropColumns = getLocalizedCropColumns(t);
  const headers = cropColumns.map((col) => col.header);
  const rows = crops.map((crop) => {
    const portableCrop = toPortableCrop(crop);
    // The JSON format names the supplier `supplierName`; the sheet column is `supplier_name`.
    const portable: Record<string, unknown> = { ...portableCrop, supplier_name: portableCrop.supplierName };
    return cropColumns.map((col) => {
      const raw = portable[col.key];
      if (raw === undefined || raw === null) return null;
      if (Array.isArray(raw)) {
        return raw.length > 0 ? raw.map((item) => col.enumExport?.[item] ?? String(item)).join(', ') : null;
      }
      if (col.enumExport && typeof raw === 'string') return col.enumExport[raw] ?? raw;
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'boolean') return raw ? t('detail.boolean.yes') : t('detail.boolean.no');
      return String(raw);
    });
  });
  return [headers, ...rows];
};

const triggerDownload = (data: Uint8Array | string, filename: string, mimeType: string): void => {
  const blob = new Blob([data as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const downloadSpreadsheet = (
  rows: (string | number | null)[][],
  format: SpreadsheetExportFormat,
  filename: string,
): void => {
  triggerDownload(buildSpreadsheetFile(rows, format), filename, MIME_TYPES[format]);
};

export const exportCropsToSpreadsheet = (
  crops: Crop[],
  format: SpreadsheetExportFormat,
  filename: string,
  t: (key: string) => string,
): void => {
  downloadSpreadsheet(buildSheetData(crops, t), format, filename);
};

export const buildSpreadsheetFilename = (
  format: SpreadsheetExportFormat,
  scope: 'single' | 'all',
  crop?: Crop,
): string => {
  const ext = format;
  if (scope === 'single' && crop) {
    const supplier = slugifyFilenamePart(crop.supplier?.name ?? crop.seed_supplier ?? '');
    const variety = slugifyFilenamePart(crop.variety ?? '');
    return `kultur_${supplier}_${variety}_${formatIsoDate()}.${ext}`;
  }
  return `kulturen_export_${formatIsoDate()}.${ext}`;
};
