import { SPECIFIC_PROPERTY_PREFIX, specificPropertyDefinitions } from './specificProperties';
import type { Crop } from '../api/types';
import { toPortableCrop, slugifyFilenamePart } from './exportUtils';
import { formatCompanionCell, type CompanionItemsByKind } from './companions';
import { getLocalizedCropColumns } from './spreadsheetColumns';
import { formatTimingWindows, windowsOfKind } from './timingWindows';
import type { TimingWindowKind } from '../api/types';
import { formatIsoDate } from '../utils/isoDate';
import { buildSpreadsheetFile } from './spreadsheetFile';
import type { SpreadsheetFormat } from './spreadsheetTypes';

export type SpreadsheetExportFormat = SpreadsheetFormat;

const MIME_TYPES: Record<SpreadsheetExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv;charset=utf-8',
};

type SheetT = (key: string, options?: Record<string, unknown>) => string;

/** The canonical text of the crop's own windows of the column's kind (`<kind>_windows`). */
const formatWindowCell = (crop: Crop, columnKey: string, t: SheetT): string | null => {
  const kind = columnKey.replace(/_windows$/, '') as TimingWindowKind;
  const text = formatTimingWindows(windowsOfKind(crop.timing_windows, kind), t);
  return text || null;
};

export const buildSheetData = (
  crops: Crop[],
  t: SheetT,
  companionsByCrop?: ReadonlyMap<number, CompanionItemsByKind>,
  companionNoteLanguage = 'de',
): (string | number | null)[][] => {
  const relevantProperties = new Set(crops.flatMap((crop) => Object.keys(specificPropertyDefinitions(crop.specific_property_profile))));
  const cropColumns = getLocalizedCropColumns(t).filter((column) => !column.key.startsWith(SPECIFIC_PROPERTY_PREFIX)
    || relevantProperties.has(column.key.slice(SPECIFIC_PROPERTY_PREFIX.length)));
  const headers = cropColumns.map((col) => col.header);
  const rows = crops.map((crop) => {
    const portableCrop = toPortableCrop(crop, crop.id === undefined ? undefined : companionsByCrop?.get(crop.id));
    // The JSON format names the supplier `supplierName`; the sheet column is `supplier_name`.
    const portable: Record<string, unknown> = { ...portableCrop, supplier_name: portableCrop.supplierName };
    return cropColumns.map((col) => {
      if (col.type === 'timingWindows') return formatWindowCell(crop, col.key, t);
      if (col.type === 'range' && col.rangeFields) {
        const [lowerField, upperField] = col.rangeFields;
        const lower = portable[lowerField] as number | null | undefined;
        const upper = portable[upperField] as number | null | undefined;
        // Keep incomplete ranges in their individual columns.
        if (lower == null || upper == null) return null;
        return col.key === 'sowing_depth' && lower === upper ? lower : `${lower}–${upper}`;
      }
      if (['cold', 'frost', 'light', 'dark'].some((kind) => col.key === `germination_${kind}`)) {
        const kind = col.key.replace('germination_', '') as NonNullable<Crop['germination_types']>[number];
        return crop.germination_types?.includes(kind) ? t('detail.boolean.yes') : null;
      }
      const propertyKey = col.key.startsWith(SPECIFIC_PROPERTY_PREFIX) ? col.key.slice(SPECIFIC_PROPERTY_PREFIX.length) : null;
      if (propertyKey && !specificPropertyDefinitions(crop.specific_property_profile)[propertyKey]) return null;
      const raw = propertyKey ? crop.specific_properties?.[propertyKey] : portable[col.key];
      if (raw === undefined || raw === null) return null;
      if (col.type === 'companions') return formatCompanionCell(raw as CompanionItemsByKind['good'], companionNoteLanguage);
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
  t: SheetT,
  companionsByCrop?: ReadonlyMap<number, CompanionItemsByKind>,
  companionNoteLanguage = 'de',
): void => {
  downloadSpreadsheet(buildSheetData(crops, t, companionsByCrop, companionNoteLanguage), format, filename);
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
