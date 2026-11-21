import { cropAPI, publicCropAPI } from '../api/api';
import type { PublicCrop, PublicCropBatchImportRequest, PublicCropImportDecision } from '../api/types';
import type { CropLinkCandidate } from '../crops/ExistingCropLinkDialog';
import { isCropSpeciesPending } from '../crops/cropSpeciesPending';
import { buildSafeImportSyncChoices, splitSyncChoices } from '../crops/publicCropSync';
import { loadImportEntryPreviews } from './importVarietyPreviews';

const MAX_GROUP_ENTRIES = 501;
const MAX_BATCH_ENTRIES = 2000;

export class BatchImportLimitError extends Error {}

export function isBatchImportParent(crop: PublicCrop | null | undefined): crop is PublicCrop {
  return Boolean(crop && !crop.variety?.trim() && !isCropSpeciesPending(crop));
}

export interface BatchImportEntry {
  crop: PublicCrop;
  candidates: CropLinkCandidate[];
  defaultDecision: PublicCropImportDecision | null;
  differences: number | null;
  targetSnapshot?: { id: number; updatedAt: string };
}

export interface BatchImportPreview {
  id: symbol;
  groups: BatchImportEntry[][];
  unavailable: PublicCrop[];
}

const automaticLink = (crop: PublicCrop): PublicCropImportDecision => ({
  public_crop_id: crop.id, base_version: crop.version, link_to_library: true,
});

async function previewEntry(crop: PublicCrop, checkProject: () => void): Promise<BatchImportEntry> {
  const entry: BatchImportEntry = { crop, candidates: [], defaultDecision: null, differences: null };
  if (crop.project_import_status) return entry;

  const { data: { candidates } } = await publicCropAPI.importPreview(crop.id);
  entry.candidates = candidates;
  if (candidates.length === 0) return { ...entry, defaultDecision: automaticLink(crop) };

  const [candidate] = candidates;
  if (candidates.length !== 1 || !candidate.species_match || !candidate.id || candidate.source_public_crop) return entry;

  checkProject();
  const { data: preview } = await cropAPI.publicSyncPreview(candidate.id, crop.id);
  const choices = buildSafeImportSyncChoices(preview.changes, 'link');
  entry.differences = preview.changes.length;
  if (!preview.crop_updated_at || preview.public_crop_id !== crop.id || preview.public_version !== crop.version) return entry;
  entry.targetSnapshot = { id: candidate.id, updatedAt: preview.crop_updated_at };
  if (preview.changes.some(change => !choices[change.field])) return entry;

  const { pullFields, pinFields } = splitSyncChoices(preview.changes, choices, { allowLocal: true });
  return {
    ...entry,
    defaultDecision: {
      ...automaticLink(crop), target_id: candidate.id, expected_updated_at: preview.crop_updated_at,
      pull_fields: pullFields, pin_fields: pinFields,
    },
  };
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
  const previews = await loadImportEntryPreviews(entries, crop => previewEntry(crop, checkProject), checkProject, onProgress);
  return { id: Symbol(), groups: groups.map(group => group.map(crop => previews.get(crop.id)!)), unavailable };
}

export type BatchImportChoice = {
  decision: PublicCropImportDecision;
  previewId: symbol;
  reviewAgain?: boolean;
} | null;

type RowStatus = 'ready' | 'needsReview' | 'skipped' | 'alreadyLinked' | 'linkedUpdate';
export interface BatchImportRow extends BatchImportEntry {
  status: RowStatus;
  decision: PublicCropImportDecision | null;
  reviewDecision: PublicCropImportDecision | null;
  parentBlocked: boolean;
}

function isCurrentReview(entry: BatchImportEntry, choice: NonNullable<BatchImportChoice>, previewId: symbol): boolean {
  const { decision } = choice;
  if (choice.reviewAgain) return false;
  if (choice.previewId === previewId) return true;
  if (decision.base_version !== entry.crop.version) return false;
  if (!decision.target_id) return decision.mode !== 'new' && entry.candidates.length === 0;
  return entry.targetSnapshot?.id === decision.target_id
    && entry.targetSnapshot.updatedAt === decision.expected_updated_at;
}

function planEntry(
  entry: BatchImportEntry, choice: BatchImportChoice | undefined, previewId: symbol, skipDefaults: boolean,
): BatchImportRow {
  const linked = entry.crop.project_import_status;
  const reviewDecision = choice?.decision ?? entry.defaultDecision;
  const decision = choice ? (isCurrentReview(entry, choice, previewId) ? choice.decision : null)
    : choice === null || skipDefaults ? null : entry.defaultDecision;
  let status: RowStatus;
  if (linked) status = linked.is_up_to_date ? 'alreadyLinked' : 'linkedUpdate';
  else if (choice === null || (skipDefaults && choice === undefined && entry.defaultDecision)) status = 'skipped';
  else status = decision ? 'ready' : 'needsReview';
  return { ...entry, status, decision: status === 'ready' ? decision : null, reviewDecision, parentBlocked: false };
}

export function buildBatchImportPlan(
  preview: BatchImportPreview, choices: ReadonlyMap<number, BatchImportChoice>, skipDefaults: boolean,
) {
  const groups: PublicCropBatchImportRequest['groups'] = [];
  const skipped = preview.unavailable.map(crop => crop.id);
  let ready = 0;
  let needsReview = 0;
  const rows = preview.groups.map(group => {
    const [parent, ...varieties] = group.map(entry => planEntry(entry, choices.get(entry.crop.id), preview.id, skipDefaults));
    const parentAvailable = Boolean(parent.decision || parent.crop.project_import_status);
    const children = varieties.map(row => {
      if (parentAvailable || row.status === 'alreadyLinked' || row.status === 'linkedUpdate' || row.status === 'skipped') {
        return row;
      }
      return {
        ...row, decision: null, parentBlocked: true,
        status: parent.status === 'needsReview' ? 'needsReview' as const : 'skipped' as const,
      };
    });
    const groupRows = [parent, ...children];
    for (const row of groupRows) {
      if (row.status === 'ready') ready += 1;
      else if (row.status === 'needsReview') needsReview += 1;
      else skipped.push(row.crop.id);
    }

    const decisions = children.flatMap(row => row.decision ? [row.decision] : []);
    if (parent.decision || (parentAvailable && decisions.length)) {
      // The request needs a parent decision even if the service will leave its existing link alone.
      groups.push({
        parent_id: parent.crop.id,
        decisions: [parent.decision ?? automaticLink(parent.crop), ...decisions],
      });
    }
    return groupRows;
  });
  return { groups, rows, skipped, ready, needsReview };
}
