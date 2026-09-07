import i18n from 'i18next';

import { normalizeImportCropEntry } from './importUtils';
import { buildHeaderToKeyMap, normalizeHeaderForLookup, CROP_COLUMNS } from './spreadsheetColumns';
import { parseSpreadsheetRows } from './spreadsheetFile';
import type { SpreadsheetFormat } from './spreadsheetTypes';

export type SpreadsheetParseResult = {
  entries: Record<string, unknown>[];
  skippedRows: number;
  warnings: string[];
};

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('File could not be read'));
    reader.readAsArrayBuffer(file);
  });

const parseRawValue = (
  value: unknown,
  type: 'string' | 'number' | 'boolean',
  enumImport?: Record<string, string>,
): unknown => {
  if (value === null || value === undefined || value === '') return undefined;

  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }

  if (type === 'boolean') {
    const s = String(value).trim().toLowerCase();
    if (s === 'ja' || s === 'yes' || s === '1' || s === 'true') return true;
    if (s === 'nein' || s === 'no' || s === '0' || s === 'false') return false;
    return undefined;
  }

  const s = String(value).trim();
  if (!s) return undefined;

  if (enumImport) {
    const mapped = enumImport[normalizeHeaderForLookup(s)];
    return mapped ?? s;
  }

  return s;
};

export const parseSpreadsheetFile = async (file: File): Promise<SpreadsheetParseResult> => {
  const buffer = await readFileAsArrayBuffer(file);
  const extension = file.name.split('.').pop()?.toLowerCase() as SpreadsheetFormat | undefined;
  if (extension !== 'xlsx' && extension !== 'ods' && extension !== 'csv') {
    return { entries: [], skippedRows: 0, warnings: [i18n.t('crops:import.errors.unsupportedFormat')] };
  }
  const rows = parseSpreadsheetRows(buffer, extension);
  if (rows.length < 1) {
    return { entries: [], skippedRows: 0, warnings: [i18n.t('crops:import.errors.noSpreadsheetTable')] };
  }

  const headerRow = rows[0] as (string | null)[];
  const t = i18n.getFixedT(i18n.resolvedLanguage ?? i18n.language, 'crops');
  const headerToKey = buildHeaderToKeyMap(t);
  const columnMap: (string | null)[] = headerRow.map((h) => {
    if (!h) return null;
    return headerToKey.get(normalizeHeaderForLookup(String(h))) ?? null;
  });

  const keyToColDef = new Map(CROP_COLUMNS.map((col) => [col.key, col]));

  const warnings: string[] = [];
  const unrecognized = headerRow.filter((h, i) => h && !columnMap[i]);
  if (unrecognized.length > 0) {
    warnings.push(i18n.t('crops:import.unrecognizedColumns', { columns: unrecognized.filter(Boolean).join(', ') }));
  }

  const dataRows = rows.slice(1);
  let skippedRows = 0;
  const entries: Record<string, unknown>[] = [];

  for (const rawRow of dataRows) {
    const row = rawRow as (unknown | null)[];
    const entry: Record<string, unknown> = {};

    for (let i = 0; i < columnMap.length; i++) {
      const key = columnMap[i];
      if (!key) continue;
      const colDef = keyToColDef.get(key);
      if (!colDef) continue;
      const raw = i < row.length ? row[i] : null;
      const parsed = parseRawValue(raw, colDef.type, colDef.enumImport);
      if (parsed !== undefined) {
        entry[key] = parsed;
      }
    }

    if (!entry['name']) {
      skippedRows++;
      continue;
    }

    entries.push(normalizeImportCropEntry(entry));
  }

  return { entries, skippedRows, warnings };
};
