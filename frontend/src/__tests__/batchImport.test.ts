import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cropAPI, publicCropAPI } from '../api/api';
import type { PublicCrop, PublicCropSyncFieldChange } from '../api/types';
import { buildBatchImportPlan, loadBatchImportPreview, type BatchImportChoice } from '../crop-library/batchImport';

vi.mock('../api/api', () => ({
  cropAPI: { publicSyncPreview: vi.fn() },
  publicCropAPI: { importPreview: vi.fn(), listAll: vi.fn() },
}));

const fresh = { id: 1, name: 'Tomato', crop_species: 1, version: 3 } as PublicCrop;
const matched = { id: 2, name: 'Chard', crop_species: 2, version: 4 } as PublicCrop;
const linked = {
  id: 3, name: 'Carrot', crop_species: 3, version: 5,
  project_import_status: { crop_id: 21, crop_name: 'Carrot', is_up_to_date: true, is_modified_from_source: false },
} as PublicCrop;
const ambiguous = { id: 4, name: 'Lettuce', crop_species: 4, version: 1 } as PublicCrop;
const unsafe = { id: 5, name: 'Kale', crop_species: 5, version: 1 } as PublicCrop;
const variety = { ...fresh, id: 6, variety: 'Roma' };
const linkedVariety = { ...variety, id: 7, crop_species: linked.crop_species };
const ambiguousVariety = { ...variety, id: 8, crop_species: ambiguous.crop_species };
const candidate = { id: 20, name: matched.name, variety: '', source_public_crop: null, species_match: true };
const defaultLink = (crop: PublicCrop) => ({ public_crop_id: crop.id, base_version: crop.version, link_to_library: true });
const syncResponse = (crop: PublicCrop, changes: PublicCropSyncFieldChange[]) => ({
  data: {
    public_crop_id: crop.id, public_version: crop.version, crop_updated_at: '2026-11-21T09:00:00+00:00',
    requires_moderation: false, changes,
  },
}) as Awaited<ReturnType<typeof cropAPI.publicSyncPreview>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(publicCropAPI.listAll).mockResolvedValue({
    results: [fresh, matched, linked, ambiguous, unsafe, variety, linkedVariety, ambiguousVariety],
  } as Awaited<ReturnType<typeof publicCropAPI.listAll>>);
  vi.mocked(publicCropAPI.importPreview).mockImplementation(async id => ({
    data: { candidates: id === matched.id || id === unsafe.id ? [candidate]
      : id === ambiguous.id ? [candidate, { ...candidate, id: 22 }] : [] },
  }) as Awaited<ReturnType<typeof publicCropAPI.importPreview>>);
  vi.mocked(cropAPI.publicSyncPreview).mockImplementation(async (_id, publicId) => publicId === unsafe.id
    ? syncResponse(unsafe, [{ field: 'name', local_value: 'Local name', public_value: 'Kale', pushable: false }])
    : syncResponse(matched, [
      { field: 'growth_duration_days', local_value: 95, public_value: 78, pushable: true, pinnable: true },
      { field: 'notes', local_value: 'Private', public_value: 'Shared', pushable: false, pinnable: true, pinned: true },
      { field: 'harvest_duration_days', local_value: null, public_value: 20, pushable: false },
    ]));
});

describe('public library batch defaults', () => {
  it('links fresh and unique safe matches, protects pinned fields, and excludes unresolved parents and their varieties', async () => {
    const progress = vi.fn();
    const preview = await loadBatchImportPreview([fresh, matched, linked, ambiguous, unsafe], true, vi.fn(), progress);
    const plan = buildBatchImportPlan(preview, new Map(), false);
    expect(plan.groups).toEqual([
      { parent_id: fresh.id, decisions: [defaultLink(fresh), defaultLink(variety)] },
      { parent_id: matched.id, decisions: [{
        ...defaultLink(matched), target_id: candidate.id, expected_updated_at: '2026-11-21T09:00:00+00:00',
        pull_fields: ['harvest_duration_days'], pin_fields: ['growth_duration_days', 'notes'],
      }] },
      { parent_id: linked.id, decisions: [defaultLink(linked), defaultLink(linkedVariety)] },
    ]);
    expect(plan).toMatchObject({ ready: 4, needsReview: 3, skipped: [linked.id] });
    expect(plan.rows[1][0]).toMatchObject({ status: 'ready', differences: 3 });
    expect(plan.rows[3][1]).toMatchObject({ status: 'needsReview', parentBlocked: true, decision: null });
    expect(plan.rows[4][0]).toMatchObject({ status: 'needsReview', differences: 1, decision: null });
    expect(cropAPI.publicSyncPreview).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(8);
  });

  it('honors individual copy and skip decisions when the batch default changes', async () => {
    const preview = await loadBatchImportPreview([fresh, matched, ambiguous], true, vi.fn(), vi.fn());
    const copy = { ...defaultLink(fresh), link_to_library: false };
    const choices = new Map<number, BatchImportChoice>([[fresh.id, copy], [ambiguous.id, null]]);
    const plan = buildBatchImportPlan(preview, choices, true);
    expect(plan.groups).toEqual([{ parent_id: fresh.id, decisions: [copy] }]);
    expect(plan.skipped).toEqual([variety.id, matched.id, ambiguous.id, ambiguousVariety.id]);
    expect(buildBatchImportPlan(preview, choices, false).groups[0].decisions).toEqual([copy, defaultLink(variety)]);
  });

  it('does not reapply a stale explicit decision or write a linked-only group', async () => {
    const preview = await loadBatchImportPreview([fresh, linked], false, vi.fn(), vi.fn());
    const choices = new Map<number, BatchImportChoice>([
      [fresh.id, { ...defaultLink(fresh), link_to_library: false, base_version: 1 }],
    ]);
    const plan = buildBatchImportPlan(preview, choices, false);
    expect(plan).toMatchObject({ groups: [], ready: 0, needsReview: 1, skipped: [linked.id] });
    choices.set(fresh.id, 'reviewAgain');
    expect(buildBatchImportPlan(preview, choices, false).groups).toEqual([]);
  });
});
