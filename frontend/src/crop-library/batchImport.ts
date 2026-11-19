import { publicCropAPI } from '../api/api';
import type { PublicCrop, PublicCropBatchImportRequest, PublicCropImportDecision } from '../api/types';
import type { CropLinkCandidate } from '../crops/ExistingCropLinkDialog';
import { isCropSpeciesPending } from '../crops/cropSpeciesPending';
import { loadVarietyImportPreviews } from './importVarietyPreviews';

const MAX_GROUP_ENTRIES = 501;
const MAX_BATCH_ENTRIES = 2000;

export class BatchImportLimitError extends Error {}

export function isBatchImportParent(crop: PublicCrop | null | undefined): crop is PublicCrop {
  return Boolean(crop && !crop.variety?.trim() && !isCropSpeciesPending(crop));
}

export interface BatchImportPreview {
  groups: PublicCrop[][];
  unavailable: PublicCrop[];
  candidates: Map<number, CropLinkCandidate[]>;
}

export async function loadBatchImportPreview(
  parents: PublicCrop[], includeVarieties: boolean, checkProject: () => void, onProgress: (count: number) => void,
): Promise<BatchImportPreview> {
  checkProject();
  const { results } = await publicCropAPI.listAll();
  checkProject();
  const byId = new Map(results.map(crop => [crop.id, crop]));
  const varieties = new Map<number, PublicCrop[]>();
  if (includeVarieties) {
    for (const crop of byId.values()) {
      if (!crop.variety?.trim() || !crop.crop_species || isCropSpeciesPending(crop)) continue;
      const group = varieties.get(crop.crop_species) ?? [];
      group.push(crop);
      varieties.set(crop.crop_species, group);
    }
  }
  const groups: PublicCrop[][] = [];
  const unavailable: PublicCrop[] = [];
  for (const selected of parents) {
    const parent = byId.get(selected.id);
    if (!isBatchImportParent(parent)) {
      unavailable.push(selected);
      continue;
    }
    groups.push([parent, ...(parent.crop_species ? varieties.get(parent.crop_species) ?? [] : [])]);
  }
  const entries = groups.flat();
  if (groups.some(group => group.length > MAX_GROUP_ENTRIES) || entries.length > MAX_BATCH_ENTRIES) {
    throw new BatchImportLimitError();
  }
  const candidates = await loadVarietyImportPreviews(entries, checkProject, onProgress);
  return { groups, unavailable, candidates };
}

export function buildBatchImportGroups(
  preview: BatchImportPreview, choices: Map<number, PublicCropImportDecision | null>,
): { groups: PublicCropBatchImportRequest['groups']; skipped: number[] } {
  const groups: PublicCropBatchImportRequest['groups'] = [];
  const skipped = preview.unavailable.map(crop => crop.id);
  for (const group of preview.groups) {
    const [parent] = group;
    if (choices.get(parent.id) === null) {
      skipped.push(...group.map(entry => entry.id));
      continue;
    }
    const decisions = group.flatMap(entry => {
      const choice = choices.get(entry.id);
      if (choice === null) {
        skipped.push(entry.id);
        return [];
      }
      return [choice ?? { public_crop_id: entry.id, base_version: entry.version, link_to_library: true }];
    });
    groups.push({ parent_id: parent.id, decisions });
  }
  return { groups, skipped };
}
