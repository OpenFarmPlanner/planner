import { publicCropAPI } from '../api/api';
import type { PublicCrop } from '../api/types';
import type { CropLinkCandidate } from '../crops/ExistingCropLinkDialog';

const PREVIEW_CONCURRENCY = 8;

export async function loadVarietyImportPreviews(
  entries: PublicCrop[],
  checkProject: () => void,
  onProgress: (completed: number) => void,
): Promise<Map<number, CropLinkCandidate[]>> {
  return loadImportEntryPreviews(
    entries,
    async entry => entry.project_import_status ? [] : (await publicCropAPI.importPreview(entry.id)).data.candidates,
    checkProject,
    onProgress,
  );
}

export async function loadImportEntryPreviews<T>(
  entries: PublicCrop[],
  load: (entry: PublicCrop) => Promise<T>,
  checkProject: () => void,
  onProgress: (completed: number) => void,
): Promise<Map<number, T>> {
  const previews = new Map<number, T>();
  for (let offset = 0; offset < entries.length; offset += PREVIEW_CONCURRENCY) {
    checkProject();
    const batch = entries.slice(offset, offset + PREVIEW_CONCURRENCY);
    // Drain the current batch before a failure permits retrying, so requests cannot accumulate.
    const results = await Promise.allSettled(batch.map(async entry => load(entry)));
    checkProject();
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === 'rejected') throw result.reason;
      previews.set(batch[index].id, result.value);
    }
    onProgress(Math.min(offset + batch.length, entries.length));
  }
  return previews;
}
