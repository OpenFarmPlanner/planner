import { cropAPI } from '../api/api';
import type { CropImportApplyResult, CropImportRowResult } from '../api/types';
import type { ImportPreviewResult } from './cropsPageUtils';

export const CROP_IMPORT_BATCH_ROWS = 200;
export const CROP_IMPORT_BATCH_BYTES = 1024 * 1024;
type ImportRow = Record<string, unknown>;
type Stage = 'preview' | 'crops' | 'companions' | 'finalize';
export type ImportProgress = { stage: Stage; completed: number; total: number };
type ProgressCallback = (progress: ImportProgress) => void;
type IndexedRow = { index: number; data: ImportRow };
export type ImportOutcome = {
  index: number;
  status: CropImportRowResult['status'] | 'not_sent' | 'unknown';
  crop_id?: number;
  companions?: 'applied' | 'error' | 'not_sent' | 'unknown';
};

export class CropImportBatchError extends Error {
  readonly kind: 'too_large' | 'invalid_response';
  readonly index: number;

  constructor(kind: 'too_large' | 'invalid_response', index = 0) {
    super(kind);
    this.kind = kind;
    this.index = index;
  }
}

const encoder = new TextEncoder();
const byteLength = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;
const companionFields = ['good_companions', 'bad_companions'] as const;
const hasCompanions = (row: ImportRow): boolean => companionFields.some(key => key in row);

/** Include the exact envelope in the byte limit, without repeatedly serializing a growing batch. */
export function buildCropImportBatches(
  rows: IndexedRow[], body: (items: ImportRow[]) => unknown,
): IndexedRow[][] {
  const overhead = byteLength(body([]));
  const batches: IndexedRow[][] = [];
  let batch: IndexedRow[] = [];
  let size = overhead;
  for (const row of rows) {
    const bytes = byteLength(row.data);
    if (overhead + bytes > CROP_IMPORT_BATCH_BYTES) throw new CropImportBatchError('too_large', row.index);
    if (batch.length && (batch.length >= CROP_IMPORT_BATCH_ROWS
      || size + bytes + 1 > CROP_IMPORT_BATCH_BYTES)) {
      batches.push(batch);
      batch = [];
      size = overhead;
    }
    size += bytes + (batch.length ? 1 : 0);
    batch.push(row);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function isImportBodyLimitError(error: unknown): boolean {
  if (error instanceof CropImportBatchError) return error.kind === 'too_large';
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  return response?.status === 413 || (response?.status === 400 && typeof response.data === 'string'
    && /RequestDataTooBig|request body|request.*too large|<!doctype html|<html/i.test(response.data));
}

export function isImportProjectChangedError(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  return response?.status === 409 && response.data?.code === 'crop_import_project_changed';
}

export async function previewCropImportBatches(
  payload: ImportRow[], language: string, progress: ProgressCallback,
  expectedProjectId?: number,
): Promise<ImportPreviewResult[]> {
  const names = payload.some(hasCompanions)
    ? [...new Set(payload.map(row => row.name).filter((name): name is string => typeof name === 'string'))]
    : undefined;
  const batches = buildCropImportBatches(payload.map((data, index) => ({ data, index })),
    items => names || expectedProjectId !== undefined ? {
      items, ...(names ? { known_crop_names: names } : {}),
      ...(expectedProjectId !== undefined ? { expected_project_id: expectedProjectId } : {}),
    } : items);
  const results: ImportPreviewResult[] = [];
  progress({ stage: 'preview', completed: 0, total: payload.length });
  for (const batch of batches) {
    const rows = batch.map(row => row.data);
    const response = expectedProjectId !== undefined ? await cropAPI.importPreview(rows, language, names, expectedProjectId)
      : names ? await cropAPI.importPreview(rows, language, names)
      : await cropAPI.importPreview(rows, language);
    const received = response.data.results;
    if (!Array.isArray(received) || received.length !== batch.length
      || new Set(received.map(row => row.index)).size !== batch.length) {
      throw new CropImportBatchError('invalid_response', batch[0].index);
    }
    for (const row of received) {
      const source = batch[row.index];
      const identity = row.normalized_identity;
      const validIdentity = identity !== null && identity !== undefined
        && typeof identity.name === 'string'
        && (identity.variety === null || typeof identity.variety === 'string');
      if (!Number.isInteger(row.index) || !source || !('normalized_identity' in row)
        || (identity !== null && !validIdentity)
        || (!row.error && (!validIdentity || !['create', 'update_candidate', 'duplicate'].includes(row.status)))) {
        throw new CropImportBatchError('invalid_response', batch[0].index);
      }
      results.push({
        ...row, index: source.index,
        duplicate_of_index: row.duplicate_of_index === undefined ? undefined
          : batch[row.duplicate_of_index]?.index,
      });
    }
    progress({ stage: 'preview', completed: results.length, total: payload.length });
  }
  const first = new Map<string, number>();
  return results.sort((a, b) => a.index - b.index).map(row => {
    const identity = row.normalized_identity;
    if (!identity) return row;
    const key = JSON.stringify([identity.name, identity.variety]);
    const previous = first.get(key);
    if (previous !== undefined) return {
      ...row, status: 'duplicate', duplicate_of_index: previous,
      error: undefined, error_code: undefined, diff: undefined, matched_crop_id: undefined,
    };
    first.set(key, row.index);
    return row;
  });
}

function validateReceipts(response: CropImportApplyResult, count: number, companions: boolean): void {
  const results = response.results;
  const allowed = companions ? ['companions_applied', 'error']
    : ['created', 'updated', 'skipped', 'duplicate', 'error'];
  if (!Array.isArray(results) || results.length !== count
    || new Set(results.map(row => row.index)).size !== count
    || results.some(row => !Number.isInteger(row.index) || row.index < 0 || row.index >= count
      || !allowed.includes(row.status)
      || (['created', 'updated', 'skipped', 'companions_applied'].includes(row.status)
        && (!Number.isInteger(row.crop_id) || (row.crop_id ?? 0) <= 0)))
    || !Array.isArray(response.errors)
    || response.errors.some(row => !Number.isInteger(row.index) || row.index < 0 || row.index >= count)) {
    throw new CropImportBatchError('invalid_response');
  }
  const statuses = (status: string): number => results.filter(row => row.status === status).length;
  const report = response.companions;
  if (report && (!Number.isInteger(report.created) || report.created < 0
    || !Array.isArray(report.unresolved) || report.unresolved.some(name => typeof name !== 'string')
    || !Array.isArray(report.conflicts) || report.conflicts.some(conflict =>
      typeof conflict.crop !== 'string' || typeof conflict.neighbour !== 'string'
      || !['good', 'bad'].includes(conflict.kept)))) throw new CropImportBatchError('invalid_response');
  if (statuses('error') !== response.errors.length
    || new Set(response.errors.map(row => row.index)).size !== response.errors.length
    || response.errors.some(error => results.find(row => row.index === error.index)?.status !== 'error')
    || (companions && (response.created_count !== 0 || response.updated_count !== 0
      || response.skipped_count !== 0 || (response.duplicate_count ?? 0) !== 0))
    || (!companions && (
    statuses('created') !== response.created_count || statuses('updated') !== response.updated_count
    || statuses('duplicate') !== (response.duplicate_count ?? 0)
    || statuses('skipped') + statuses('duplicate') !== response.skipped_count
  ))) throw new CropImportBatchError('invalid_response');
}

export type BatchedImportResult = CropImportApplyResult & {
  outcomes: ImportOutcome[];
  interrupted?: { stage: Stage; kind: 'too_large' | 'invalid_response' | 'request_failed' | 'project_changed' };
  attempted: boolean;
};

export async function applyCropImportBatches(
  payload: ImportRow[], preview: ImportPreviewResult[],
  options: { confirm_updates: boolean; companion_note_language: string; replace_companion_notes: boolean; expected_project_id?: number },
  progress: ProgressCallback,
): Promise<BatchedImportResult> {
  const outcomes: ImportOutcome[] = payload.map((_, index) => ({ index, status: 'not_sent' }));
  const result: BatchedImportResult = {
    created_count: 0, updated_count: 0, skipped_count: 0, duplicate_count: 0,
    errors: [], outcomes, attempted: false,
  };
  for (const row of preview) {
    if (row.status === 'duplicate') {
      outcomes[row.index].status = 'duplicate';
      result.duplicate_count! += 1;
      result.skipped_count += 1;
    } else if (row.error) {
      outcomes[row.index].status = 'error';
      result.errors.push({ index: row.index, error: row.error, error_code: row.error_code });
    }
  }
  const core = preview.filter(row => !row.error && row.status !== 'duplicate')
    .sort((a, b) => Number(a.normalized_identity?.variety !== null) - Number(b.normalized_identity?.variety !== null)
      || a.index - b.index)
    .map(row => ({ index: row.index, data: Object.fromEntries(
      Object.entries(payload[row.index]).filter(([key]) => !companionFields.includes(key as typeof companionFields[number])),
    ) }));

  const run = async (rows: IndexedRow[], stage: 'crops' | 'companions'): Promise<boolean> => {
    const body = (items: ImportRow[]) => ({ items, ...options, phase: stage });
    let batches: IndexedRow[][];
    try { batches = buildCropImportBatches(rows, body); }
    catch (error) {
      result.interrupted = { stage, kind: isImportBodyLimitError(error) ? 'too_large' : 'invalid_response' };
      return false;
    }
    let completed = 0;
    progress({ stage, completed, total: rows.length });
    for (const batch of batches) {
      try {
        result.attempted = true;
        const response = (await cropAPI.importApply(body(batch.map(row => row.data)))).data;
        validateReceipts(response, batch.length, stage === 'companions');
        for (const receipt of response.results!) {
          const index = batch[receipt.index].index;
          if (stage === 'crops') Object.assign(outcomes[index], { status: receipt.status, crop_id: receipt.crop_id });
          else outcomes[index].companions = receipt.status === 'error' ? 'error' : 'applied';
        }
        result.errors.push(...response.errors.map(row => ({ ...row, index: batch[row.index].index })));
        result.created_count += response.created_count;
        result.updated_count += response.updated_count;
        result.skipped_count += response.skipped_count;
        result.duplicate_count! += response.duplicate_count ?? 0;
        if (response.companions) {
          const previous = result.companions ?? { created: 0, unresolved: [], conflicts: [] };
          result.companions = {
            created: previous.created + response.companions.created,
            unresolved: [...new Set([...previous.unresolved, ...response.companions.unresolved])],
            conflicts: [...previous.conflicts, ...response.companions.conflicts],
          };
        }
        completed += batch.length;
        progress({ stage, completed, total: rows.length });
      } catch (error) {
        const tooLarge = isImportBodyLimitError(error);
        const status = (error as { response?: { status?: number } })?.response?.status;
        const projectChanged = isImportProjectChangedError(error);
        const rejected = tooLarge || projectChanged || [400, 401, 403, 404, 422, 429].includes(status ?? 0);
        for (const row of batch) {
          if (stage === 'crops') outcomes[row.index].status = rejected ? 'not_sent' : 'unknown';
          else outcomes[row.index].companions = rejected ? 'not_sent' : 'unknown';
        }
        result.interrupted = { stage, kind: projectChanged ? 'project_changed' : tooLarge ? 'too_large'
          : error instanceof CropImportBatchError ? 'invalid_response' : 'request_failed' };
        return false;
      }
    }
    return true;
  };

  const candidates = (): IndexedRow[] => outcomes.filter(row => ['created', 'updated'].includes(row.status)
    && hasCompanions(payload[row.index])).map(row => ({
    index: row.index, data: {
      crop_id: row.crop_id,
      ...Object.fromEntries(companionFields.filter(key => key in payload[row.index])
        .map(key => [key, payload[row.index][key]])),
    },
  }));
  if (!await run(core, 'crops')) {
    for (const row of candidates()) outcomes[row.index].companions = 'not_sent';
    return result;
  }
  const companions = candidates();
  for (const row of companions) outcomes[row.index].companions = 'not_sent';
  if (!await run(companions, 'companions')) return result;
  progress({ stage: 'finalize', completed: 0, total: 1 });
  try {
    result.attempted = true;
    const response = await cropAPI.importApply({ items: [], ...options, phase: 'finalize' });
    validateReceipts(response.data, 0, true);
    progress({ stage: 'finalize', completed: 1, total: 1 });
  } catch (error) {
    result.interrupted = { stage: 'finalize', kind: isImportProjectChangedError(error) ? 'project_changed' : isImportBodyLimitError(error) ? 'too_large'
      : error instanceof CropImportBatchError ? 'invalid_response' : 'request_failed' };
  }
  return result;
}
