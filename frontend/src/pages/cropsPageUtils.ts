import { readWithLegacyKey, removeWithLegacyKey } from '../compat/legacyCropNames';

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
