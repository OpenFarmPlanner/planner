import { cropAPI } from '../api/api';
import {
  applyCropImportBatches, buildCropImportBatches, CROP_IMPORT_BATCH_BYTES,
  previewCropImportBatches, isImportBodyLimitError,
} from '../pages/cropImportBatches';
import type { ImportPreviewResult } from '../pages/cropsPageUtils';

vi.mock('../api/api', () => ({ cropAPI: { importPreview: vi.fn(), importApply: vi.fn() } }));
const previewAPI = vi.mocked(cropAPI.importPreview);
const applyAPI = vi.mocked(cropAPI.importApply);
const options = { confirm_updates: false, companion_note_language: 'fr' };
const progress = vi.fn();
type Row = Record<string, unknown>;
const rows = (count: number): Row[] => Array.from({ length: count }, (_, index) => ({ name: `Crop ${index}` }));
const previews = (items: Row[]): ImportPreviewResult[] => items.map((item, index) => ({
  index, status: 'create', import_data: item as ImportPreviewResult['import_data'],
  normalized_identity: { name: String(item.name).toLowerCase(), variety: item.variety ? String(item.variety) : null },
}));
function successfulApply() {
  applyAPI.mockImplementation(async ({ items, phase }) => ({ data: {
    created_count: phase === 'crops' ? items.length : 0, updated_count: 0, skipped_count: 0,
    errors: [], results: items.map((_, index) => ({ index,
      status: phase === 'crops' ? 'created' : 'companions_applied', crop_id: index + 1,
    })),
  } }) as Awaited<ReturnType<typeof cropAPI.importApply>>);
}

beforeEach(() => {
  vi.resetAllMocks();
  previewAPI.mockImplementation(async items => ({ data: { results: previews(items) } }) as Awaited<ReturnType<typeof cropAPI.importPreview>>);
  successfulApply();
});

it('bounds row count and exact UTF-8 bytes including all envelope options', () => {
  const body = (items: Row[]) => ({ items, ...options, phase: 'crops' });
  const items = rows(401).map((data, index) => ({ data, index }));
  expect(buildCropImportBatches(items, body).map(batch => batch.length)).toEqual([200, 200, 1]);
  const large = [0, 1, 2].map(index => ({ index, data: { name: 'é'.repeat(180000) } }));
  const batches = buildCropImportBatches(large, body);
  expect(batches.map(batch => batch.length)).toEqual([2, 1]);
  for (const batch of batches) expect(new TextEncoder().encode(JSON.stringify(body(batch.map(row => row.data)))).length)
    .toBeLessThanOrEqual(CROP_IMPORT_BATCH_BYTES);
  const overhead = new TextEncoder().encode(JSON.stringify(body([{ name: '' }]))).length;
  const exact = { index: 9, data: { name: 'x'.repeat(CROP_IMPORT_BATCH_BYTES - overhead) } };
  expect(buildCropImportBatches([exact], body)).toHaveLength(1);
  expect(() => buildCropImportBatches([{ ...exact, data: { name: exact.data.name + 'x' } }], body))
    .toThrow('too_large');
});

it('rejects oversized context before sending a preview', async () => {
  await expect(previewCropImportBatches([{ name: 'x'.repeat(CROP_IMPORT_BATCH_BYTES), good_companions: [] }], 'fr', progress))
    .rejects.toThrow('too_large');
  expect(previewAPI).not.toHaveBeenCalled();
});

it('deduplicates across batches using backend Unicode identities and preserves the invalid first occurrence', async () => {
  const payload = rows(201);
  payload[0] = { name: 'Straße' };
  payload[200] = { name: 'STRASSE' };
  previewAPI.mockImplementation(async items => ({ data: { results: previews(items).map(row => ({ ...row,
    normalized_identity: { name: ['Straße', 'STRASSE'].includes(String(row.import_data.name)) ? 'strasse' : String(row.import_data.name), variety: null },
    ...(row.import_data.name === 'Straße' ? { error: 'invalid first row' } : {}),
  })) } }) as Awaited<ReturnType<typeof cropAPI.importPreview>>);
  const result = await previewCropImportBatches(payload, 'fr', progress);
  expect(previewAPI).toHaveBeenCalledTimes(2);
  expect(result[200]).toMatchObject({ index: 200, status: 'duplicate', duplicate_of_index: 0 });
  expect(result[0].error).toBeTruthy();
  expect(progress).toHaveBeenLastCalledWith({ stage: 'preview', completed: 201, total: 201 });
});

it('passes the whole file name context to every companion preview batch', async () => {
  const payload = rows(201);
  payload[0].good_companions = [{ name: 'Crop 200', legacy: true }];
  await previewCropImportBatches(payload, 'fr', progress);
  for (const call of previewAPI.mock.calls) expect(call[2]).toEqual(payload.map(row => row.name));
});

it('rejects missing preview rows or backend identities', async () => {
  previewAPI.mockResolvedValue({ data: { results: [] } } as never);
  await expect(previewCropImportBatches(rows(1), 'fr', progress)).rejects.toThrow('invalid_response');
  previewAPI.mockResolvedValue({ data: { results: [{ index: 0, status: 'create', import_data: { name: 'X' } }] } } as never);
  await expect(previewCropImportBatches(rows(1), 'fr', progress)).rejects.toThrow('invalid_response');
});

it('writes general crops first, links companions in original order, and counts crop writes once', async () => {
  const payload = [{ name: 'A', variety: 'Variety', good_companions: [{ name: 'B' }] },
    { name: 'B', bad_companions: [{ name: 'A' }] }, { name: 'A' }];
  const result = await applyCropImportBatches(payload, previews(payload), options, progress);
  expect(applyAPI.mock.calls.map(([body]) => body.phase)).toEqual(['crops', 'companions', 'finalize']);
  expect(applyAPI.mock.calls[0][0]).toEqual({ items: [{ name: 'B' }, { name: 'A' }, { name: 'A', variety: 'Variety' }], ...options, phase: 'crops' });
  expect(applyAPI.mock.calls[1][0].items).toEqual([
    { crop_id: 3, good_companions: [{ name: 'B' }] }, { crop_id: 1, bad_companions: [{ name: 'A' }] },
  ]);
  expect(result.created_count).toBe(3);
  expect(result.outcomes[0]).toMatchObject({ status: 'created', companions: 'applied' });
});

it.each([new Error('offline'), { response: { status: 500 } }])('keeps confirmed rows and stops after an uncertain later batch', async error => {
  const payload = rows(401);
  const success = applyAPI.getMockImplementation()!;
  applyAPI.mockImplementationOnce(success).mockRejectedValueOnce(error);
  const result = await applyCropImportBatches(payload, previews(payload), options, progress);
  expect(applyAPI).toHaveBeenCalledTimes(2);
  expect(result.created_count).toBe(200);
  expect(result.outcomes[199].status).toBe('created');
  expect(result.outcomes[200].status).toBe('unknown');
  expect(result.outcomes[400].status).toBe('not_sent');
});

it('treats body rejection as unsaved, and missing receipts as an unknown outcome', async () => {
  const payload = rows(2);
  applyAPI.mockRejectedValueOnce({ response: { status: 413 } });
  const rejected = await applyCropImportBatches(payload, previews(payload), options, progress);
  expect(rejected.outcomes.every(row => row.status === 'not_sent')).toBe(true);
  expect(rejected.interrupted?.kind).toBe('too_large');
  applyAPI.mockResolvedValueOnce({ data: { created_count: 2, updated_count: 0, skipped_count: 0, errors: [] } } as never);
  const uncertain = await applyCropImportBatches(payload, previews(payload), options, progress);
  expect(uncertain.created_count).toBe(0);
  expect(uncertain.outcomes.every(row => row.status === 'unknown')).toBe(true);
});

it('stops on a project switch and retains the original binding and confirmed outcomes', async () => {
  const payload = rows(401);
  const success = applyAPI.getMockImplementation()!;
  applyAPI.mockImplementationOnce(success).mockRejectedValueOnce({
    response: { status: 409, data: { code: 'crop_import_project_changed' } },
  });
  const result = await applyCropImportBatches(payload, previews(payload), { ...options, expected_project_id: 42 }, progress);
  expect(result.created_count).toBe(200);
  expect(result.interrupted?.kind).toBe('project_changed');
  expect(result.outcomes[200].status).toBe('not_sent');
  expect(applyAPI).toHaveBeenCalledTimes(2);
  for (const [body] of applyAPI.mock.calls) expect(body.expected_project_id).toBe(42);
});

it('retains confirmed crop writes when the companion phase or final linking fails', async () => {
  const payload = [{ name: 'A', good_companions: [{ name: 'B' }] }];
  const success = applyAPI.getMockImplementation()!;
  applyAPI.mockImplementationOnce(success).mockRejectedValueOnce(new Error('offline'));
  const result = await applyCropImportBatches(payload, previews(payload), options, progress);
  expect(result.created_count).toBe(1);
  expect(result.outcomes[0]).toMatchObject({ status: 'created', companions: 'unknown' });
  expect(applyAPI).toHaveBeenCalledTimes(2);
  successfulApply();
  applyAPI.mockImplementationOnce(success).mockImplementationOnce(success).mockRejectedValueOnce(new Error('offline'));
  const finalized = await applyCropImportBatches(payload, previews(payload), options, progress);
  expect(finalized.created_count).toBe(1);
  expect(finalized.interrupted?.stage).toBe('finalize');
});

it('keeps update confirmation and never links companions for a skipped row', async () => {
  const payload = [{ name: 'A', good_companions: [{ name: 'B' }] }];
  applyAPI.mockResolvedValueOnce({ data: { created_count: 0, updated_count: 0, skipped_count: 1,
    errors: [], results: [{ index: 0, status: 'skipped', crop_id: 7 }],
  } } as never);
  const result = await applyCropImportBatches(payload, previews(payload), options, progress);
  expect(result.skipped_count).toBe(1);
  expect(applyAPI.mock.calls.map(([body]) => body.phase)).toEqual(['crops', 'finalize']);
  expect(applyAPI.mock.calls[0][0].confirm_updates).toBe(false);
});

it('recognizes server body-limit pages without rendering them', () => {
  expect(isImportBodyLimitError({ response: { status: 400, data: '<!doctype html>RequestDataTooBig' } })).toBe(true);
  expect(isImportBodyLimitError({ response: { status: 400, data: { detail: 'Invalid context' } } })).toBe(false);
});
