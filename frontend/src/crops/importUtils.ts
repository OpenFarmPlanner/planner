export interface ParsedCropImport {
  entries: Record<string, unknown>[];
  originalCount: number;
  rowNumbers: number[];
  skippedRowNumbers: number[];
}

type ImportEnvelope = {
  type?: unknown;
  crop?: unknown;
  crops?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toCentimeters = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  return value * 100;
};

export const normalizeImportCropEntry = (entry: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = { ...entry };

  if (typeof normalized.supplierName === 'string' && normalized.supplierName.trim().length > 0) {
    normalized.supplier_name = normalized.supplierName;
  }

  if (
    (typeof normalized.supplier_name !== 'string' || normalized.supplier_name.trim().length === 0) &&
    typeof normalized.seed_supplier === 'string' &&
    normalized.seed_supplier.trim().length > 0
  ) {
    normalized.supplier_name = normalized.seed_supplier;
  }

  if (normalized.distance_within_row_cm === undefined) {
    const cm = toCentimeters(normalized.distance_within_row_m);
    if (cm !== undefined) {
      normalized.distance_within_row_cm = cm;
    }
  }

  if (normalized.row_spacing_cm === undefined) {
    const cm = toCentimeters(normalized.row_spacing_m);
    if (cm !== undefined) {
      normalized.row_spacing_cm = cm;
    }
  }

  if (normalized.sowing_depth_cm === undefined) {
    const cm = toCentimeters(normalized.sowing_depth_m);
    if (cm !== undefined) {
      normalized.sowing_depth_cm = cm;
    }
  }

  if (normalized.sowing_depth_max_cm === undefined) {
    const cm = toCentimeters(normalized.sowing_depth_max_m);
    if (cm !== undefined) {
      normalized.sowing_depth_max_cm = cm;
    }
  }

  delete normalized.supplierName;
  delete normalized.distance_within_row_m;
  delete normalized.row_spacing_m;
  delete normalized.sowing_depth_m;
  delete normalized.sowing_depth_max_m;
  delete normalized.schemaVersion;
  delete normalized.exportedAt;
  delete normalized.type;

  return normalized;
};

const extractImportItems = (parsed: unknown): unknown[] => {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!isRecord(parsed)) {
    throw new Error('not_array');
  }

  const envelope = parsed as ImportEnvelope;

  if (envelope.type === 'crop' && isRecord(envelope.crop)) {
    return [envelope.crop];
  }

  if (envelope.type === 'crops' && Array.isArray(envelope.crops)) {
    return envelope.crops;
  }

  throw new Error('not_array');
};

export const parseCropImportJson = (jsonString: string): ParsedCropImport => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonString);
  } catch {
    const cleanedJson = jsonString.replace(/,\s*([}\]])/g, '$1');
    parsed = JSON.parse(cleanedJson);
  }

  const rawItems = extractImportItems(parsed);
  const entries: Record<string, unknown>[] = [];
  const rowNumbers: number[] = [];
  const skippedRowNumbers: number[] = [];
  rawItems.forEach((item, index) => {
    if (isRecord(item)) {
      entries.push(normalizeImportCropEntry(item));
      rowNumbers.push(index + 1);
    } else skippedRowNumbers.push(index + 1);
  });

  return {
    entries,
    originalCount: rawItems.length,
    rowNumbers,
    skippedRowNumbers,
  };
};
