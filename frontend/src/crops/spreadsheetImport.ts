import i18n from 'i18next';

import { buildCompanionReasonLookup, parseCompanionCell } from './companions';
import { normalizeImportCropEntry } from './importUtils';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import {
  buildEnumImportMaps,
  buildHeaderToKeyMap,
  normalizeEnumValueForLookup,
  normalizeHeaderForLookup,
  CROP_COLUMNS,
  type SpreadsheetColumnDef,
} from './spreadsheetColumns';
import { parseSpreadsheetRows } from './spreadsheetFile';
import type { SpreadsheetFormat } from './spreadsheetTypes';

export type SpreadsheetParseResult = {
  entries: Record<string, unknown>[];
  /** The sheet row number (header = 1) of each entry, for messages about a cell. */
  rowNumbers: number[];
  skippedRows: number;
  warnings: string[];
};

const HARVEST_DURATION_KEY = 'harvest_duration_days';
/** Read by the backend import only (`HARVEST_DURATION_TEXT_KEY` in crop_import/spreadsheet.py). */
const HARVEST_DURATION_TEXT_KEY = 'harvest_duration_days_text';

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('File could not be read'));
    reader.readAsArrayBuffer(file);
  });

const parseRawValue = (
  value: unknown,
  type: SpreadsheetColumnDef['type'],
  enumImport?: Record<string, string>,
): unknown => {
  if (value === null || value === undefined || value === '') return undefined;

  if (type === 'timingWindows') {
    // Kept as written: the backend import parses it and reports what it cannot.
    const text = String(value).trim();
    return text || undefined;
  }

  if (type === 'list') {
    const items = String(value)
      .split(/[,;\n\r]/)
      .map((item) => parseRawValue(item, 'string', enumImport))
      .filter((item): item is string => typeof item === 'string');
    return items.length > 0 ? items : undefined;
  }

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
    const mapped = enumImport[normalizeEnumValueForLookup(s)];
    return mapped ?? s;
  }

  return s;
};

export const parseSpreadsheetFile = async (file: File): Promise<SpreadsheetParseResult> => {
  const buffer = await readFileAsArrayBuffer(file);
  const extension = file.name.split('.').pop()?.toLowerCase() as SpreadsheetFormat | undefined;
  if (extension !== 'xlsx' && extension !== 'ods' && extension !== 'csv') {
    return { entries: [], rowNumbers: [], skippedRows: 0, warnings: [i18n.t('crops:import.errors.unsupportedFormat')] };
  }
  const rows = parseSpreadsheetRows(buffer, extension);
  if (rows.length < 1) {
    return { entries: [], rowNumbers: [], skippedRows: 0, warnings: [i18n.t('crops:import.errors.noSpreadsheetTable')] };
  }

  const headerRow = rows[0] as (string | null)[];
  // The current language goes last so its labels win any cross-language clash.
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language;
  const translators = [
    ...SUPPORTED_LANGUAGES.map(({ code }) => code).filter((code) => code !== currentLanguage),
    currentLanguage,
  ].map((code) => i18n.getFixedT(code, 'crops'));
  const headerToKey = buildHeaderToKeyMap(...translators);
  const enumImportMaps = buildEnumImportMaps(...translators);
  const companionReasons = buildCompanionReasonLookup(...translators);
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
  const rowNumbers: number[] = [];

  for (const [dataIndex, rawRow] of dataRows.entries()) {
    const row = rawRow as (unknown | null)[];
    const entry: Record<string, unknown> = {};

    for (let i = 0; i < columnMap.length; i++) {
      const key = columnMap[i];
      if (!key) continue;
      const colDef = keyToColDef.get(key);
      if (!colDef) continue;
      const raw = i < row.length ? row[i] : null;
      if (colDef.type === 'companions') {
        const items = parseCompanionCell(raw, companionReasons);
        if (items.length > 0) entry[key] = items;
        continue;
      }
      const parsed = parseRawValue(raw, colDef.type, enumImportMaps.get(key));
      if (parsed !== undefined) {
        entry[key] = parsed;
      } else if (key === HARVEST_DURATION_KEY && typeof raw === 'string' && raw.trim()) {
        // Text in the harvest-duration column ("Juli bis September") is no number;
        // the backend import tells a harvest window from other text.
        entry[HARVEST_DURATION_TEXT_KEY] = raw.trim();
      }
    }

    if (!entry['name']) {
      skippedRows++;
      continue;
    }

    entries.push(normalizeImportCropEntry(entry));
    rowNumbers.push(dataIndex + 2);
  }

  return { entries, rowNumbers, skippedRows, warnings };
};
