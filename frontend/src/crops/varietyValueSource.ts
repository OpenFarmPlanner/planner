import type { Crop, CropInheritableField, CropTimingWindow, TimingWindowKind } from '../api/types';
import { TIMING_WINDOW_KINDS, toTimingWindowPayload, windowsOfKind } from './timingWindows';

export type CropValueSource = 'ownValue' | null;

export const isEmptyCropValue = (value: unknown): boolean => (
  value === null
  || value === undefined
  || value === ''
  || (Array.isArray(value) && value.length === 0)
);

export const areCropValuesEqual = (left: unknown, right: unknown): boolean => {
  if (isEmptyCropValue(left) && isEmptyCropValue(right)) {
    return true;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) < Number.EPSILON;
  }
  if (Array.isArray(left) || Array.isArray(right) || (typeof left === 'object' && left !== null) || (typeof right === 'object' && right !== null)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
};

/**
 * Determines whether `field` holds a variety-specific value that overrides the
 * parent species crop's value. Shared between the detail view and the edit
 * form so both use the same override/inherited concept.
 */
/**
 * Crop fields that a new variety can usefully start out with, copied from
 * its general crop, when the user opens "Add variety". Deliberately excludes
 * identity/free-text fields (name, variety, notes) and per-variety data that
 * should never default to the crop's own (color, supplier/seed packaging).
 * Mirrors `CROP_INHERITABLE_FIELDS` in backend/farm/services/crop_inheritance.py.
 *
 * Timing windows are inherited as well, but per kind and as a list, so they
 * are not a scalar field of this list: see
 * `VARIETY_INHERITABLE_TIMING_WINDOW_KINDS` below, which follows the same
 * prefill/strip principle separately.
 */
export const VARIETY_INHERITABLE_FIELDS: (keyof Crop)[] = [
  'botanical_name',
  'crop_family',
  'nutrient_demand',
  'rotation_break_years',
  'cultivation_type',
  'cultivation_types',
  'growth_duration_days',
  'harvest_duration_days',
  'propagation_duration_days',
  'germination_temperature_optimal_min_c',
  'germination_temperature_optimal_max_c',
  'germination_temperature_min_c',
  'germination_days_min',
  'germination_days_max',
  'germination_types',
  'germination_pretreatment',
  'harvest_method',
  'expected_yield',
  'distance_within_row_cm',
  'row_spacing_cm',
  'sowing_depth_cm',
  'sowing_calculation_safety_percent',
  'sowing_calculation_safety_percent_direct',
  'sowing_calculation_safety_percent_pre_cultivation',
  'thousand_kernel_weight_g',
  'seeding_requirement',
  'seeding_requirement_type',
  'seed_rate_direct_value',
  'seed_rate_direct_unit',
  'seed_rate_pre_cultivation_value',
  'seed_rate_pre_cultivation_unit',
  'tags',
];

/**
 * Builds the prefill values for a new variety's form: every inheritable
 * field the crop actually has a value for. Left out of the result entirely
 * (rather than copied as empty) when the crop itself has no value, so the
 * form doesn't overwrite the form's own empty defaults with more emptiness.
 */
export function buildVarietyInheritanceBaseline(cropCrop: Crop): Partial<Crop> {
  const baseline: Partial<Crop> = {};
  for (const field of VARIETY_INHERITABLE_FIELDS) {
    const value = cropCrop[field];
    if (!isEmptyCropValue(value)) {
      (baseline as Record<string, unknown>)[field] = value;
    }
  }
  return baseline;
}

/**
 * Given a saved variety draft and the crop baseline it was prefilled from,
 * returns a copy with any field that still matches the crop's value cleared
 * back out — so a variety the user didn't actually change from its prefilled
 * defaults keeps inheriting from the crop (including future crop edits)
 * instead of silently freezing a duplicate copy of today's crop values.
 */
export function stripValuesMatchingBaseline<TDraft extends Partial<Crop>>(
  draft: TDraft,
  baseline: Partial<Crop>,
  emptyValueFor: (field: keyof Crop) => unknown,
): TDraft {
  const stripped: Record<string, unknown> = { ...draft };
  for (const field of VARIETY_INHERITABLE_FIELDS) {
    if (!(field in baseline)) {
      continue;
    }
    if (areCropValuesEqual(stripped[field], baseline[field])) {
      stripped[field] = emptyValueFor(field);
    }
  }
  return stripped as TDraft;
}

/**
 * The values the backend resolved from a Sorte's general Kultur, keyed by form
 * field. The edit dialog merges these into the form so a field the Sorte does
 * not override shows the Kultur's value instead of an empty input; it is also
 * the baseline `stripValuesMatchingBaseline` clears again on save, so merely
 * displaying an inherited value never turns it into an override.
 *
 * Empty when there is nothing to inherit from — a general Kultur, or a
 * free-text Sorte without a linked crop species.
 */
export function buildInheritedValueBaseline(
  crop: Crop | null | undefined,
): Partial<Crop> {
  if (!crop?.general_crop) {
    return {};
  }
  const effectiveValues = crop.effective_values;
  if (!effectiveValues) {
    return {};
  }
  const baseline: Partial<Crop> = {};
  for (const field of crop.inherited_fields ?? []) {
    const value = effectiveValues[field];
    if (!isEmptyCropValue(value)) {
      (baseline as Record<string, unknown>)[field] = value;
    }
  }
  return baseline;
}

/**
 * The value a crop effectively plans with: its own, or — for a Sorte that
 * leaves the field unset — the one the backend resolved from its general
 * Kultur. Falls back to the raw field for crops with nothing to inherit
 * from (a general Kultur, a free-text Sorte, or a stale client-side object
 * that predates the inheritance payload).
 */
export function getEffectiveCropValue<TField extends CropInheritableField>(
  crop: Partial<Crop> | null | undefined,
  field: TField,
): Crop[TField] {
  const effectiveValues = crop?.effective_values;
  if (effectiveValues && Object.prototype.hasOwnProperty.call(effectiveValues, field)) {
    return effectiveValues[field] as Crop[TField];
  }
  return crop?.[field] as Crop[TField];
}

export function getVarietyOwnValueSource(
  crop: Partial<Crop> | null | undefined,
  speciesCrop: Partial<Crop> | null | undefined,
  field: keyof Crop,
): CropValueSource {
  if (!crop?.variety || !speciesCrop) {
    return null;
  }
  const ownValue = crop[field];
  if (isEmptyCropValue(ownValue)) {
    return null;
  }
  const cropValue = speciesCrop[field];
  return areCropValuesEqual(ownValue, cropValue) ? null : 'ownValue';
}

const SPACING_FIELDS = ['row_spacing_cm', 'distance_within_row_cm'] as const;

/**
 * The crop whose edit view fixes missing plant spacing for `crop`. A Sorte
 * that leaves spacing empty inherits it live from its general Kultur, so the
 * value belongs there; only a Sorte that stores an unusable spacing of its own
 * (which overrides the Kultur) has to be fixed on the Sorte itself.
 */
export function resolveSpacingEditCropId(
  crop: Pick<Crop, 'id' | 'general_crop' | typeof SPACING_FIELDS[number]>,
): number | undefined {
  if (!crop.general_crop) {
    return crop.id;
  }
  const hasInvalidOwnSpacing = SPACING_FIELDS.some((field) => {
    const value = crop[field];
    return !isEmptyCropValue(value) && !(typeof value === 'number' && value > 0);
  });
  return hasInvalidOwnSpacing ? crop.id : crop.general_crop;
}

/**
 * Timing-window kinds a Sorte inherits from its general Kultur, each on its
 * own: per kind, a Sorte without own windows uses the Kultur's, live. The
 * same prefill-and-strip principle as `VARIETY_INHERITABLE_FIELDS`, kept
 * separate because a kind holds a list of windows, not one value. Mirrors
 * `INHERITABLE_TIMING_WINDOW_KINDS` in backend/farm/services/crop_inheritance.py.
 */
export const VARIETY_INHERITABLE_TIMING_WINDOW_KINDS: readonly TimingWindowKind[] = TIMING_WINDOW_KINDS;

const sortByKind = (windows: CropTimingWindow[]): CropTimingWindow[] => TIMING_WINDOW_KINDS
  .flatMap((kind) => windowsOfKind(windows, kind));

/**
 * The windows a Sorte inherits from its Kultur (kinds it has none of itself),
 * as the backend resolved them. Empty for a Kultur or a free-text Sorte.
 */
export function buildInheritedTimingWindows(crop: Crop | null | undefined): CropTimingWindow[] {
  if (!crop?.general_crop) {
    return [];
  }
  return (crop.effective_timing_windows ?? [])
    .filter((window) => window.inherited && VARIETY_INHERITABLE_TIMING_WINDOW_KINDS.includes(window.kind))
    .map(toTimingWindowPayload);
}

/**
 * What the edit form shows: the crop's own windows plus, for a Sorte, the
 * inherited ones of every kind it has none of itself, so the form displays
 * what the Sorte effectively plans with (like `buildInheritedValueBaseline`).
 */
export function buildDisplayedTimingWindows(crop: Crop | null | undefined): CropTimingWindow[] {
  const own = (crop?.timing_windows ?? []).map(toTimingWindowPayload);
  return sortByKind([...own, ...buildInheritedTimingWindows(crop)]);
}

/** The Kultur's windows a new Sorte's form starts with ("Add variety"). */
export function buildVarietyTimingWindowBaseline(cropCrop: Crop): CropTimingWindow[] {
  return buildDisplayedTimingWindows(cropCrop)
    .filter((window) => VARIETY_INHERITABLE_TIMING_WINDOW_KINDS.includes(window.kind));
}

/**
 * Clears every kind whose windows still equal the baseline it was prefilled
 * from, so the Sorte keeps inheriting that kind instead of freezing a copy
 * (the window counterpart of `stripValuesMatchingBaseline`).
 */
export function stripTimingWindowsMatchingBaseline(
  windows: readonly CropTimingWindow[],
  baseline: readonly CropTimingWindow[],
): CropTimingWindow[] {
  const keptKinds = VARIETY_INHERITABLE_TIMING_WINDOW_KINDS.filter((kind) => {
    const baselineOfKind = windowsOfKind(baseline, kind);
    return baselineOfKind.length === 0
      || !areCropValuesEqual(windowsOfKind(windows, kind).map(toTimingWindowPayload), baselineOfKind);
  });
  return windows
    .filter((window) => keptKinds.includes(window.kind) || !VARIETY_INHERITABLE_TIMING_WINDOW_KINDS.includes(window.kind))
    .map(toTimingWindowPayload);
}

/**
 * `'ownValue'` when a Sorte's windows of `kind` differ from its Kultur's — the
 * window counterpart of `getVarietyOwnValueSource`, for the same highlight.
 */
export function getVarietyOwnTimingWindowSource(
  windows: readonly CropTimingWindow[] | undefined,
  isVariety: boolean,
  speciesCrop: Partial<Crop> | null | undefined,
  kind: TimingWindowKind,
): CropValueSource {
  if (!isVariety || !speciesCrop) {
    return null;
  }
  const ownOfKind = windowsOfKind(windows, kind).map(toTimingWindowPayload);
  if (ownOfKind.length === 0) {
    return null;
  }
  const cropOfKind = windowsOfKind(buildDisplayedTimingWindows(speciesCrop as Crop), kind);
  return areCropValuesEqual(ownOfKind, cropOfKind) ? null : 'ownValue';
}
