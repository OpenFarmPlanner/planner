import type { Bed, Field } from '../../../api/types';
import {
  MAX_BULK_BED_COUNT,
  buildRowBedNames,
  buildSequentialBedNames,
  detectBedNaming,
} from './bedNaming';

export type BulkBedNamingMode = 'sequential' | 'rowBed';

/** Raw dialog state: whole numbers stay strings so a cleared field stays empty. */
export interface BulkBedFormValues {
  mode: BulkBedNamingMode;
  prefix: string;
  start: string;
  count: string;
  rows: string;
  bedsPerRow: string;
  firstRow: string;
  firstBed: string;
  lengthM: number | null;
  widthM: number | null;
}

export type BulkBedFieldError =
  | { key: 'wholeNumber'; min: number }
  | { key: 'positiveNumber' }
  | { key: 'tooMany'; max: number };

export type BulkBedFormField = 'start' | 'count' | 'rows' | 'bedsPerRow' | 'firstRow' | 'firstBed' | 'lengthM' | 'widthM';

export interface BulkBedPlan {
  /** Names to create; empty while the naming inputs are incomplete or invalid. */
  names: string[];
  errors: Partial<Record<BulkBedFormField, BulkBedFieldError>>;
  /** Generated names that already exist in the field (blocking). */
  takenNames: string[];
  /** Area per bed in m², rounded like the backend (0.1 m²), or null without valid dimensions. */
  areaPerBedSqm: number | null;
  totalAreaSqm: number | null;
  /** True when every required input is present and valid. */
  isComplete: boolean;
}

const parseWholeNumber = (value: string, min: number): number | null | 'invalid' => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'invalid';
  }
  const parsed = Number(trimmed);
  return parsed >= min ? parsed : 'invalid';
};

/** Dialog defaults: continue the field's naming scheme, else empty prefix and start 1. */
export function getInitialBulkBedFormValues(fieldBeds: readonly Bed[]): BulkBedFormValues {
  const persistedBeds = fieldBeds.filter((bed) => typeof bed.id === 'number' && bed.id > 0);
  const lastBed = persistedBeds[persistedBeds.length - 1];
  const detected = detectBedNaming(persistedBeds.map((bed) => bed.name));
  const values: BulkBedFormValues = {
    mode: 'sequential',
    prefix: '',
    start: '1',
    count: '',
    rows: '1',
    bedsPerRow: '',
    firstRow: '1',
    firstBed: '1',
    lengthM: lastBed?.length_m ?? null,
    widthM: lastBed?.width_m ?? null,
  };

  if (detected?.mode === 'sequential') {
    return { ...values, prefix: detected.prefix, start: String(detected.start) };
  }
  if (detected?.mode === 'rowBed') {
    return {
      ...values,
      mode: 'rowBed',
      prefix: detected.prefix,
      firstRow: String(detected.firstRow),
      firstBed: String(detected.firstBed),
      bedsPerRow: String(detected.bedsPerRow),
    };
  }
  return values;
}

const roundToTenth = (value: number): number => Math.round(value * 10) / 10;

export function evaluateBulkBedForm(values: BulkBedFormValues, existingNames: Iterable<string>): BulkBedPlan {
  const errors: BulkBedPlan['errors'] = {};
  const readWholeNumber = (field: BulkBedFormField, min: number): number | null => {
    const parsed = parseWholeNumber(values[field] as string, min);
    if (parsed === 'invalid') {
      errors[field] = { key: 'wholeNumber', min };
      return null;
    }
    return parsed;
  };

  let names: string[] = [];
  let namingComplete = false;
  if (values.mode === 'sequential') {
    const start = readWholeNumber('start', 0);
    const count = readWholeNumber('count', 1);
    if (count !== null && count > MAX_BULK_BED_COUNT) {
      errors.count = { key: 'tooMany', max: MAX_BULK_BED_COUNT };
    } else if (start !== null && count !== null) {
      names = buildSequentialBedNames({ prefix: values.prefix, start, count });
      namingComplete = true;
    }
  } else {
    const rows = readWholeNumber('rows', 1);
    const bedsPerRow = readWholeNumber('bedsPerRow', 1);
    const firstRow = readWholeNumber('firstRow', 0);
    const firstBed = readWholeNumber('firstBed', 0);
    if (rows !== null && bedsPerRow !== null && rows * bedsPerRow > MAX_BULK_BED_COUNT) {
      errors.bedsPerRow = { key: 'tooMany', max: MAX_BULK_BED_COUNT };
    } else if (rows !== null && bedsPerRow !== null && firstRow !== null && firstBed !== null) {
      names = buildRowBedNames({ prefix: values.prefix, rows, bedsPerRow, firstRow, firstBed });
      namingComplete = true;
    }
  }

  if (values.lengthM !== null && !(values.lengthM > 0)) {
    errors.lengthM = { key: 'positiveNumber' };
  }
  if (values.widthM !== null && !(values.widthM > 0)) {
    errors.widthM = { key: 'positiveNumber' };
  }
  const dimensionsValid = values.lengthM !== null && values.widthM !== null && !errors.lengthM && !errors.widthM;
  const areaPerBedSqm = dimensionsValid ? roundToTenth(values.lengthM! * values.widthM!) : null;

  const existing = new Set(Array.from(existingNames, (name) => name.trim()));
  const takenNames = names.filter((name) => existing.has(name));

  return {
    names,
    errors,
    takenNames,
    areaPerBedSqm,
    totalAreaSqm: areaPerBedSqm === null ? null : roundToTenth(areaPerBedSqm * names.length),
    isComplete: namingComplete && dimensionsValid && Object.keys(errors).length === 0,
  };
}

const fieldAreaSqm = (field: Field): number | null => {
  if (typeof field.area_sqm === 'number' && field.area_sqm > 0) {
    return field.area_sqm;
  }
  if (typeof field.length_m === 'number' && typeof field.width_m === 'number' && field.length_m > 0 && field.width_m > 0) {
    return field.length_m * field.width_m;
  }
  return null;
};

/**
 * The non-blocking area check: existing beds plus the new series larger than
 * the field. Null when the field has no area or nothing exceeds it.
 */
export function getBulkBedAreaOverflow(
  field: Field,
  fieldBeds: readonly Bed[],
  newTotalAreaSqm: number | null,
): { fieldArea: number; existingArea: number; newArea: number } | null {
  const fieldArea = fieldAreaSqm(field);
  if (fieldArea === null || newTotalAreaSqm === null) {
    return null;
  }
  const existingArea = fieldBeds
    .filter((bed) => typeof bed.id === 'number' && bed.id > 0)
    .reduce((sum, bed) => sum + (Number(bed.area_sqm) || 0), 0);
  if (existingArea + newTotalAreaSqm <= fieldArea) {
    return null;
  }
  return { fieldArea, existingArea: roundToTenth(existingArea), newArea: newTotalAreaSqm };
}
