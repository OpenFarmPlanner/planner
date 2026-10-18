import type { Crop, PublicCropSyncFieldChange } from '../api/types';
import {
  arePublicValuesEqual,
  isEmptyPublicValue,
} from '../crop-library/components/publicCropLibrary/formatters';
import type { PublicCropSyncChoices } from './publicCropSync';

/**
 * The Kultur form fields a library link compares and fills. Identity fields
 * (name, variety, species), provenance, colour and seed packages are not
 * values of the entry the user decides about.
 */
export const LIBRARY_LINK_FIELDS = [
  'notes',
  'crop_family',
  'nutrient_demand',
  'cultivation_types',
  'cultivation_type',
  'growth_duration_days',
  'harvest_duration_days',
  'propagation_duration_days',
  'harvest_method',
  'expected_yield',
  'distance_within_row_cm',
  'row_spacing_cm',
  'sowing_depth_cm',
  'seed_rate_value',
  'seed_rate_unit',
  'seed_rate_by_cultivation',
  'seed_rate_direct_value',
  'seed_rate_direct_unit',
  'seed_rate_pre_cultivation_value',
  'seed_rate_pre_cultivation_unit',
  'thousand_kernel_weight_g',
  'seeding_requirement',
  'seeding_requirement_type',
] as const satisfies readonly (keyof Crop)[];

export type LibraryLinkField = (typeof LIBRARY_LINK_FIELDS)[number];

/** Fields the Kultur form prefills, so their untouched default counts as empty. */
const FORM_DEFAULTS: Partial<Record<LibraryLinkField, unknown>> = {
  cultivation_type: 'pre_cultivation',
  cultivation_types: ['pre_cultivation'],
};

const isEmptyFormValue = (field: LibraryLinkField, value: unknown): boolean => (
  isEmptyPublicValue(value)
  || (field in FORM_DEFAULTS && arePublicValuesEqual(value, FORM_DEFAULTS[field]))
);

export interface LibraryLinkPlan {
  /** Library values for fields the user left empty. */
  fills: Partial<Crop>;
  /** Fields where the user's value and the library's differ. */
  conflicts: PublicCropSyncFieldChange[];
}

/**
 * What linking `libraryValues` into `formValues` does: empty fields take the
 * library value, a value the user entered that differs becomes a conflict for
 * the per-field sync choice. Nothing is overwritten here.
 */
export function planLibraryLink(formValues: Partial<Crop>, libraryValues: Partial<Crop>): LibraryLinkPlan {
  const fills: Partial<Crop> = {};
  const conflicts: PublicCropSyncFieldChange[] = [];
  LIBRARY_LINK_FIELDS.forEach((field) => {
    const libraryValue = libraryValues[field];
    const formValue = formValues[field];
    if (isEmptyPublicValue(libraryValue) || arePublicValuesEqual(formValue, libraryValue)) {
      return;
    }
    if (isEmptyFormValue(field, formValue)) {
      (fills as Record<string, unknown>)[field] = libraryValue;
      return;
    }
    conflicts.push({ field, local_value: formValue, public_value: libraryValue, pushable: true });
  });
  return { fills, conflicts };
}

/** The library values of the conflicts the user resolved in favour of the library. */
export function pickLibraryChoices(
  conflicts: readonly PublicCropSyncFieldChange[],
  choices: PublicCropSyncChoices,
): Partial<Crop> {
  return Object.fromEntries(conflicts
    .filter((change) => choices[change.field] !== 'mine')
    .map((change) => [change.field, change.public_value]));
}

/** The entry's non-empty values for the linked fields, e.g. for the general Kultur. */
export function pickLibraryLinkValues(libraryValues: Partial<Crop>): Partial<Crop> {
  return Object.fromEntries(LIBRARY_LINK_FIELDS
    .filter((field) => !isEmptyPublicValue(libraryValues[field]))
    .map((field) => [field, libraryValues[field]]));
}
