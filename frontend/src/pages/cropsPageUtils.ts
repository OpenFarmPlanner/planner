import { readWithLegacyKey, removeWithLegacyKey } from '../compat/legacyCropNames';
import { CROP_COLUMNS } from '../crops/spreadsheetColumns';
import type { CompanionImportPreview, CompanionImportSummary, CropImportIdentity } from '../api/types';

export const SELECTED_CROP_STORAGE_KEY = 'selectedCropId';
/** Pre-"Crop" spelling, still present for users who last visited before the rename. */
export const LEGACY_SELECTED_CROP_STORAGE_KEY = 'selectedCultureId';

export const clearStoredCropId = (): void =>
  removeWithLegacyKey(localStorage, SELECTED_CROP_STORAGE_KEY, LEGACY_SELECTED_CROP_STORAGE_KEY);

export type ImportPreviewResult = {
  index: number;
  status: 'create' | 'update_candidate' | 'duplicate';
  duplicate_of_index?: number;
  row_number?: number;
  duplicate_of_row_number?: number;
  matched_crop_id?: number;
  diff?: Array<{ field: string; current: unknown; new: unknown }>;
  import_data: Record<string, unknown>;
  normalized_identity?: CropImportIdentity | null;
  error?: string;
  error_code?: string;
  companions?: CompanionImportPreview;
  /**
   * Cells the import drops (one per cell); the rest of the row is imported.
   * Despite the name, also range cells (germination, sowing depth).
   */
  timing_window_issues?: TimingWindowImportIssue[];
};

export type TimingWindowImportIssue = {
  /**
   * The column key: `<kind>_windows`, `harvest_duration_days` for a window
   * there, or a range column (germination, sowing depth).
   */
  field: string;
  /** The part of the cell that was rejected, as written. */
  value: string;
  code: string;
};

export type ImportFailedEntry = {
  index: number;
  row_number?: number;
  companionPhase?: boolean;
  name?: string;
  variety?: string;
  error: string | Record<string, unknown>;
  error_code?: string;
  importData?: Record<string, unknown>;
};

export type SnackbarState = {
  open: boolean;
  message: string;
  severity: 'success' | 'error' | 'info';
};

type Translator = (key: string, options?: Record<string, unknown>) => string;

export const parseCropId = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsedId = Number.parseInt(value, 10);
  return Number.isFinite(parsedId) ? parsedId : undefined;
};

export const getStoredCropId = (): number | undefined => parseCropId(
  readWithLegacyKey(localStorage, SELECTED_CROP_STORAGE_KEY, LEGACY_SELECTED_CROP_STORAGE_KEY),
);

export const buildImportSuccessMessage = (
  createdCount: number,
  updatedCount: number,
  skippedCount: number,
  t: Translator,
  duplicateCount = 0,
): string => {
  const segments: string[] = [];

  if (createdCount > 0) {
    segments.push(t('import.created', { count: createdCount }));
  }
  if (updatedCount > 0) {
    segments.push(t('import.updated', { count: updatedCount }));
  }
  if (skippedCount > duplicateCount) {
    segments.push(t('import.skipped', { count: skippedCount - duplicateCount }));
  }
  if (duplicateCount > 0) {
    segments.push(t('import.duplicatesSkipped', { count: duplicateCount }));
  }

  return segments.join(', ');
};

const formatNames = (names: string[]): string => names.join(', ');

// These messages name the value themselves; the others get it in the line.
const TIMING_WINDOW_MESSAGES_WITH_VALUE = new Set([
  'timing_window_not_recognized',
  'timing_window_open_end',
  'timing_window_ambiguous_slash',
]);

/**
 * One line per window cell the import drops: row, column and why, e.g.
 * "Zeile 4, Ernte: „Frühjahr“ ist keine Zeitangabe. …".
 */
export const buildTimingWindowPreviewWarnings = (
  results: ImportPreviewResult[],
  rowNumberOf: (index: number) => number,
  t: Translator,
): string[] => results.flatMap((result) => (result.timing_window_issues ?? []).map((issue) => {
  const headerKey = CROP_COLUMNS.find((col) => col.key === issue.field)?.headerKey;
  const column = headerKey ? t(headerKey) : issue.field;
  const message = issue.code.startsWith('timing_window_')
    ? t(`timingWindows.importErrors.${issue.code}`, { value: issue.value })
    : t(`import.cellErrors.${issue.code}`, { value: issue.value });
  const key = TIMING_WINDOW_MESSAGES_WITH_VALUE.has(issue.code)
    ? 'import.timingWindowIssue'
    : 'import.timingWindowIssueWithValue';
  return t(key, { row: rowNumberOf(result.index), column, value: issue.value, message });
}));

/** The preview's warning about neighbours that would be kept as free text. */
export const buildCompanionPreviewWarning = (
  results: ImportPreviewResult[],
  t: Translator,
): string | null => {
  const warnings = [...new Set(results.flatMap((result) => result.companions?.warnings ?? []))];
  const unresolved = Array.from(new Set(results.flatMap((result) => result.companions?.unresolved ?? [])))
    .filter((name) => !warnings.includes(name));
  const messages = [
    unresolved.length ? t('companions.import.unresolved', { count: unresolved.length, names: formatNames(unresolved) }) : '',
    warnings.length ? t('companions.import.legacyWarning', { names: formatNames(warnings) }) : '',
  ].filter(Boolean);
  return messages.join(' ') || null;
};

/** One sentence per outcome of the imported neighbours: created, kept as text, conflicts. */
export const buildCompanionImportMessages = (
  summary: CompanionImportSummary | undefined,
  t: Translator,
): string[] => {
  if (!summary) return [];
  const messages: string[] = [];
  if (summary.created > 0) messages.push(t('companions.import.created', { count: summary.created }));
  if (summary.unresolved.length > 0) {
    messages.push(t('companions.import.unresolved', {
      count: summary.unresolved.length,
      names: formatNames(summary.unresolved),
    }));
  }
  if (summary.conflicts.length > 0) {
    messages.push(t('companions.import.conflicts', { count: summary.conflicts.length }));
  }
  return messages;
};

export const mapImportErrors = (
  errors: Array<{ index: number; error: unknown; error_code?: string }>,
  importPayload: Record<string, unknown>[],
): ImportFailedEntry[] => errors.map((err) => {
  const originalData = importPayload[err.index];
  return {
    index: err.index,
    name: originalData?.name as string | undefined,
    variety: originalData?.variety as string | undefined,
    importData: originalData,
    error_code: err.error_code,
    error: typeof err.error === 'string' || typeof err.error === 'object' ? err.error as string | Record<string, unknown> : String(err.error),
  };
});

export const buildSpecificPropertyPreviewErrors = (
  results: ImportPreviewResult[], rowNumber: (index: number) => number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] => results.filter((result) => result.error_code === 'specific_properties_invalid')
  .map((result) => t('specificProperties.importRowInvalid', { row: rowNumber(result.index) }));

export const buildCompanionNotePreviewErrors = (
  results: ImportPreviewResult[], rowNumber: (index: number) => number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] => results.filter((result) => result.error_code === 'companion_notes_invalid')
  .map((result) => t('companions.import.invalidRow', { row: rowNumber(result.index) }));
