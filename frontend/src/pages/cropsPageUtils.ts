import { readWithLegacyKey, removeWithLegacyKey } from '../compat/legacyCropNames';
import type { CompanionImportPreview, CompanionImportSummary } from '../api/types';

export const SELECTED_CROP_STORAGE_KEY = 'selectedCropId';
/** Pre-"Crop" spelling, still present for users who last visited before the rename. */
export const LEGACY_SELECTED_CROP_STORAGE_KEY = 'selectedCultureId';

export const clearStoredCropId = (): void =>
  removeWithLegacyKey(localStorage, SELECTED_CROP_STORAGE_KEY, LEGACY_SELECTED_CROP_STORAGE_KEY);

export type ImportPreviewResult = {
  index: number;
  status: 'create' | 'update_candidate';
  matched_crop_id?: number;
  diff?: Array<{ field: string; current: unknown; new: unknown }>;
  import_data: Record<string, unknown>;
  error?: string;
  companions?: CompanionImportPreview;
  /** Window cells the import drops (one per cell); the rest of the row is imported. */
  timing_window_issues?: TimingWindowImportIssue[];
};

export type TimingWindowImportIssue = {
  /** The column key: `<kind>_windows`, or `harvest_duration_days` for a window there. */
  field: string;
  /** The part of the cell that was rejected, as written. */
  value: string;
  code: string;
};

export type ImportFailedEntry = {
  index: number;
  name?: string;
  variety?: string;
  error: string | Record<string, unknown>;
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
): string => {
  const segments: string[] = [];

  if (createdCount > 0) {
    segments.push(t('import.created', { count: createdCount }));
  }
  if (updatedCount > 0) {
    segments.push(t('import.updated', { count: updatedCount }));
  }
  if (skippedCount > 0) {
    segments.push(t('import.skipped', { count: skippedCount }));
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
  const column = issue.field.endsWith('_windows')
    ? t(`timingWindows.kinds.${issue.field.replace(/_windows$/, '')}`)
    // A window in the harvest-duration column ("Erntezeitraum").
    : t('form.harvestDurationDays');
  const message = t(`timingWindows.importErrors.${issue.code}`, { value: issue.value });
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
  const unresolved = Array.from(new Set(results.flatMap((result) => result.companions?.unresolved ?? [])));
  if (unresolved.length === 0) return null;
  return t('companions.import.unresolved', { count: unresolved.length, names: formatNames(unresolved) });
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
  errors: Array<{ index: number; error: unknown }>,
  importPayload: Record<string, unknown>[],
): ImportFailedEntry[] => errors.map((err) => {
  const originalData = importPayload[err.index];
  return {
    index: err.index,
    name: originalData?.name as string | undefined,
    variety: originalData?.variety as string | undefined,
    importData: originalData,
    error: typeof err.error === 'string' || typeof err.error === 'object' ? err.error as string | Record<string, unknown> : String(err.error),
  };
});
