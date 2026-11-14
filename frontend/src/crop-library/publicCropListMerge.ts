import type { Crop, PublicCrop, PublicCropDiscussionTopic } from '../api/types';

/** Reflect a completed import immediately while its authoritative list reloads. */
export function withProjectImportStatus(entry: PublicCrop, crop: Crop): PublicCrop {
  return {
    ...entry,
    version: Math.max(entry.version, crop.source_public_version ?? 0),
    project_import_status: crop.source_public_crop === entry.id ? {
      crop_id: crop.id as number,
      crop_name: crop.crop_display_name || crop.name,
      is_modified_from_source: Boolean(crop.is_modified_from_source),
      is_up_to_date: !crop.is_modified_from_source && !crop.public_update_available,
    } : null,
  };
}

/**
 * Keeps locally saved crops from being rolled back by a list response that
 * predates the save.
 *
 * The page already discards list requests that were in flight when a save
 * landed, but a request started *after* the save — the search box refreshes on
 * a debounce — still carries pre-save data and would otherwise write the old
 * values straight back over the saved ones.
 *
 * An entry is dropped from `saved` as soon as the server returns that crop
 * at the saved version or newer, so an override never outlives the request it
 * was protecting against and later server-side edits still win.
 */
export function applySavedCrops(
  results: PublicCrop[],
  saved: Map<number, PublicCrop>,
): PublicCrop[] {
  if (saved.size === 0) {
    return results;
  }

  return results.map((crop) => {
    const savedCrop = saved.get(crop.id);
    if (!savedCrop) {
      return crop;
    }
    if (crop.version >= savedCrop.version) {
      saved.delete(crop.id);
      return crop;
    }
    return savedCrop;
  });
}

/**
 * Keeps a just-created discussion topic in the list even when the reload that
 * follows the create does not contain it yet.
 *
 * Creating a topic selects it by navigating to `?discussionId=<id>`, and a
 * guard effect deselects any discussion id that is missing from `topics` (so a
 * stale link to a deleted discussion cannot leave the page pointing at
 * nothing). If the reload response lags behind the create — ordering,
 * pagination, or a replica that has not caught up — that guard throws the user
 * straight back out of the discussion they just created. The detail pane reads
 * its title from the list entry too, so the same gap renders an endless
 * spinner instead of the new discussion.
 *
 * The created topic is prepended rather than appended: the list is ordered by
 * newest activity first, which a brand-new topic always is.
 */
export function withCreatedTopic(
  topics: PublicCropDiscussionTopic[],
  createdTopic: PublicCropDiscussionTopic,
): PublicCropDiscussionTopic[] {
  if (topics.some((topic) => topic.id === createdTopic.id)) {
    return topics;
  }
  return [createdTopic, ...topics];
}
