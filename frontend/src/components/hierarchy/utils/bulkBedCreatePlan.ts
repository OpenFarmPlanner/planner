import type { Bed, Field } from '../../../api/types';
import {
  MAX_BULK_BED_COUNT,
  buildBedNameSeries,
  nextFreeName,
  suggestBedCountAcrossWidth,
} from './bedNaming';

/** Which field side the new beds run along; the other side is filled across. */
export type BedOrientation = 'length' | 'width';

/** Raw dialog state: the count stays a string so a cleared field stays empty. */
export interface BulkBedFormValues {
  orientation: BedOrientation;
  lengthM: number | null;
  widthM: number | null;
  pathM: number | null;
  count: string;
  firstName: string;
}

export type BulkBedFieldError =
  | { key: 'wholeNumber'; min: number }
  | { key: 'positiveNumber' }
  | { key: 'nonNegativeNumber' }
  | { key: 'tooMany'; max: number };

export type BulkBedFormField = 'count' | 'lengthM' | 'widthM' | 'pathM';

export interface BulkBedPlan {
  /** Names to create; empty while the count or first name is incomplete or invalid. */
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

export interface BulkBedCountSuggestion {
  /** Beds that still fit; 0 or less means the field is full. */
  count: number;
  /** The field side the beds are laid out across, in m. */
  crossSideM: number;
  /** Saved beds of the field already taking up part of the cross side. */
  existingBedCount: number;
}

const positiveOrNull = (value: number | null | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

const persistedBeds = (fieldBeds: readonly Bed[]): Bed[] => (
  fieldBeds.filter((bed) => typeof bed.id === 'number' && bed.id > 0)
);

export const otherOrientation = (orientation: BedOrientation): BedOrientation => (
  orientation === 'length' ? 'width' : 'length'
);

/** The field side the beds run along (`orientation`), or null when unknown. */
export function getFieldSide(field: Field | null, orientation: BedOrientation): number | null {
  if (!field) return null;
  return positiveOrNull(orientation === 'length' ? field.length_m : field.width_m);
}

export function hasBothFieldSides(field: Field | null): boolean {
  return getFieldSide(field, 'length') !== null && getFieldSide(field, 'width') !== null;
}

/**
 * How many more beds fit across the field: the cross side minus the width of
 * every saved bed and one path per saved bed, then
 * `floor((free + path) / (bed width + path))`. Null without a cross side or a
 * valid bed width (no hint is shown then).
 */
export function suggestBulkBedCount(
  field: Field | null,
  fieldBeds: readonly Bed[],
  { orientation, widthM, pathM }: Pick<BulkBedFormValues, 'orientation' | 'widthM' | 'pathM'>,
): BulkBedCountSuggestion | null {
  const crossSideM = getFieldSide(field, otherOrientation(orientation));
  const bedWidth = positiveOrNull(widthM);
  const path = pathM ?? 0;
  if (crossSideM === null || bedWidth === null || !(path >= 0)) {
    return null;
  }
  const existing = persistedBeds(fieldBeds);
  const usedWidth = existing.reduce((sum, bed) => sum + (Number(bed.width_m) || 0), 0);
  const freeWidth = crossSideM - usedWidth - existing.length * path;
  return {
    count: suggestBedCountAcrossWidth(freeWidth, bedWidth, path),
    crossSideM,
    existingBedCount: existing.length,
  };
}

/**
 * Dialog defaults: beds run along the field length, as long as the field
 * side (else the last bed), as wide as the last bed, no path, the next free
 * name after the last bed (else `defaultFirstName`), and the suggested count
 * when one fits.
 */
export function getInitialBulkBedFormValues(
  field: Field | null,
  fieldBeds: readonly Bed[],
  defaultFirstName: string,
): BulkBedFormValues {
  const beds = persistedBeds(fieldBeds);
  const lastBed = beds[beds.length - 1];
  const values: BulkBedFormValues = {
    orientation: 'length',
    lengthM: getFieldSide(field, 'length') ?? positiveOrNull(lastBed?.length_m),
    widthM: positiveOrNull(lastBed?.width_m),
    pathM: null,
    count: '',
    firstName: lastBed ? nextFreeName(lastBed.name, beds.map((bed) => bed.name)) : defaultFirstName,
  };
  const suggestion = suggestBulkBedCount(field, beds, values);
  return suggestion && suggestion.count > 0 ? { ...values, count: String(suggestion.count) } : values;
}

/**
 * Switches the orientation. The length follows to the other field side
 * unless the user has typed their own length (`lengthEdited`).
 */
export function changeBulkBedOrientation(
  values: BulkBedFormValues,
  field: Field | null,
  orientation: BedOrientation,
  lengthEdited: boolean,
): BulkBedFormValues {
  const fieldSide = getFieldSide(field, orientation);
  return {
    ...values,
    orientation,
    lengthM: !lengthEdited && fieldSide !== null ? fieldSide : values.lengthM,
  };
}

const parseCount = (value: string): number | null | 'invalid' => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'invalid';
  }
  const parsed = Number(trimmed);
  return parsed >= 1 ? parsed : 'invalid';
};

const roundToTenth = (value: number): number => Math.round(value * 10) / 10;

export function evaluateBulkBedForm(values: BulkBedFormValues, existingNames: Iterable<string>): BulkBedPlan {
  const errors: BulkBedPlan['errors'] = {};

  let names: string[] = [];
  const count = parseCount(values.count);
  if (count === 'invalid') {
    errors.count = { key: 'wholeNumber', min: 1 };
  } else if (count !== null && count > MAX_BULK_BED_COUNT) {
    errors.count = { key: 'tooMany', max: MAX_BULK_BED_COUNT };
  } else if (count !== null) {
    names = buildBedNameSeries(values.firstName, count);
  }

  if (values.lengthM !== null && !(values.lengthM > 0)) {
    errors.lengthM = { key: 'positiveNumber' };
  }
  if (values.widthM !== null && !(values.widthM > 0)) {
    errors.widthM = { key: 'positiveNumber' };
  }
  if (values.pathM !== null && !(values.pathM >= 0)) {
    errors.pathM = { key: 'nonNegativeNumber' };
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
    isComplete: names.length > 0 && dimensionsValid && Object.keys(errors).length === 0,
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
  const existingArea = persistedBeds(fieldBeds).reduce((sum, bed) => sum + (Number(bed.area_sqm) || 0), 0);
  if (existingArea + newTotalAreaSqm <= fieldArea) {
    return null;
  }
  return { fieldArea, existingArea: roundToTenth(existingArea), newArea: newTotalAreaSqm };
}
