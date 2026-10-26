import type { TFunction } from 'i18next';
import { parseCropImportJson } from '../crops/importUtils';
import type { SeedRateUnit, SeedRateUnitConstraints } from '../api/types';
import { seedRateValueViolatesConstraint } from '../crops/seedRateConstraints';
import { CROP_COLUMNS } from '../crops/spreadsheetColumns';
import type { ImportFailedEntry, ImportPreviewResult } from './cropsPageUtils';
import { formatHistoryChangeValue, getCropFieldLabel } from './cropsHistoryUtils';

type Translator = (key: string, options?: Record<string, unknown>) => string;

export type ImportEntryPartition = {
  validEntries: Record<string, unknown>[];
  invalidEntries: string[];
};

export type ImportAnalysisResult =
  | {
      status: 'ready';
      originalCount: number;
      validEntries: Record<string, unknown>[];
      invalidEntries: string[];
    }
  | {
      status: 'error';
      errorKey: 'import.errors.notArray' | 'import.errors.noValidEntries' | 'import.errors.parse';
      originalCount: number;
      invalidEntries: string[];
    };

export const partitionImportEntries = (
  entries: unknown[],
  t: Translator,
): ImportEntryPartition => {
  const invalidEntries: string[] = [];
  const validEntries: Record<string, unknown>[] = [];

  entries.forEach((entry, index) => {
    const nameValue = (entry as { name?: unknown }).name;
    if (typeof nameValue === 'string' && nameValue.trim().length > 0) {
      validEntries.push(entry as Record<string, unknown>);
    } else {
      invalidEntries.push(`${t('import.invalidEntry')} ${index + 1}`);
    }
  });

  return { validEntries, invalidEntries };
};

export const analyzeCropImportJson = (
  jsonString: string,
  t: Translator,
): ImportAnalysisResult => {
  try {
    const { entries, originalCount } = parseCropImportJson(jsonString);

    if (originalCount === 0) {
      return {
        status: 'error',
        errorKey: 'import.errors.notArray',
        originalCount,
        invalidEntries: [],
      };
    }

    const { validEntries, invalidEntries } = partitionImportEntries(entries, t);

    if (validEntries.length === 0) {
      return {
        status: 'error',
        errorKey: 'import.errors.noValidEntries',
        originalCount,
        invalidEntries,
      };
    }

    return {
      status: 'ready',
      originalCount,
      validEntries,
      invalidEntries,
    };
  } catch {
    return {
      status: 'error',
      errorKey: 'import.errors.parse',
      originalCount: 0,
      invalidEntries: [],
    };
  }
};

export const readFileAsText = (file: File): Promise<string> => (
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('File could not be read'));
    reader.readAsText(file);
  })
);

type ImportDiffChange = NonNullable<ImportPreviewResult['diff']>[number];

const NUMERIC_IMPORT_FIELDS = new Set(
  CROP_COLUMNS.filter((column) => column.type === 'number').map((column) => column.key),
);

/** Decimal fields come back as strings ("1.30"); show them like the imported numbers. */
const toDisplayValue = (value: unknown, field: string): unknown => {
  if (NUMERIC_IMPORT_FIELDS.has(field) && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
};

export const formatImportValue = (value: unknown, field: string, t: TFunction<'crops'>): string =>
  formatHistoryChangeValue(toDisplayValue(value, field), field, t);

export const formatImportDiffChange = (change: ImportDiffChange, t: TFunction<'crops'>): string => (
  `${getCropFieldLabel(change.field, t)}: ${formatImportValue(change.current, change.field, t)}`
  + ` → ${formatImportValue(change.new, change.field, t)}`
);

const SEED_RATE_UNIT_FIELD_BY_VALUE_FIELD: Record<string, string> = {
  seed_rate_direct_value: 'seed_rate_direct_unit',
  seed_rate_pre_cultivation_value: 'seed_rate_pre_cultivation_unit',
};

/** The crop form's own message when its rule explains the rejection, else none. */
const knownRuleMessage = (
  field: string,
  importData: Record<string, unknown>,
  t: TFunction<'crops'>,
  seedRateConstraints?: Partial<SeedRateUnitConstraints> | null,
): string | null => {
  const unitField = SEED_RATE_UNIT_FIELD_BY_VALUE_FIELD[field];
  if (
    unitField
    && seedRateValueViolatesConstraint(importData[field], importData[unitField] as SeedRateUnit, seedRateConstraints)
  ) {
    return t('form.seedRateValueWholeNumberRequired');
  }
  return null;
};

/**
 * One localized line per rejected field. Backend validation messages are
 * technical English, so a line names the field and either the rule it broke
 * (when the crop form knows it) or the rejected value.
 */
export const formatImportFailure = (
  entry: ImportFailedEntry,
  t: TFunction<'crops'>,
  seedRateConstraints?: Partial<SeedRateUnitConstraints> | null,
): string => {
  const importData = entry.importData ?? {};
  const fieldErrors = typeof entry.error === 'object' && entry.error !== null ? Object.keys(entry.error) : [];
  const lines = fieldErrors
    .filter((field) => field in importData)
    .map((field) => {
      const label = getCropFieldLabel(field, t);
      const rule = knownRuleMessage(field, importData, t, seedRateConstraints);
      return rule
        ? `${label}: ${rule}`
        : t('import.invalidFieldValue', { field: label, value: formatImportValue(importData[field], field, t) });
    });
  return lines.length > 0 ? lines.join('; ') : t('import.errors.rowFailed');
};
