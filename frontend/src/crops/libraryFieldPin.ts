import type { SxProps, Theme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import type { Crop } from '../api/types';
import {
  formatPublicCropValue,
  getPublicCropComparisonFieldLabel,
  isEmptyPublicValue,
} from '../crop-library/components/publicCropLibrary/formatters';

/**
 * Locally pinned library fields in the crop form. A pinned field keeps the
 * crop's value on purpose ("Nur lokal"): it drops out of every library diff and
 * is never pulled or pushed (`Crop.library_pinned_fields`, backend
 * `farm/services/public_crops.py`). The form pins by *form field*; one form
 * control can stand for several compared model fields (the cultivation picker
 * sets `cultivation_types` and `cultivation_type` together).
 */
export const LIBRARY_PIN_FORM_FIELDS = {
  nutrient_demand: ['nutrient_demand'],
  cultivation_types: ['cultivation_types', 'cultivation_type'],
  growth_duration_days: ['growth_duration_days'],
  harvest_duration_days: ['harvest_duration_days'],
  propagation_duration_days: ['propagation_duration_days'],
  harvest_method: ['harvest_method'],
  expected_yield: ['expected_yield'],
  distance_within_row_cm: ['distance_within_row_m'],
  row_spacing_cm: ['row_spacing_m'],
  sowing_depth_cm: ['sowing_depth_m'],
  thousand_kernel_weight_g: ['thousand_kernel_weight_g'],
  notes: ['notes'],
} as const satisfies Partial<Record<keyof Crop, readonly string[]>>;

export type LibraryPinFormField = keyof typeof LIBRARY_PIN_FORM_FIELDS;

/** The compared model fields behind one form field. */
export function getLibraryPinModelFields(field: LibraryPinFormField): readonly string[] {
  return LIBRARY_PIN_FORM_FIELDS[field];
}

export function isLibraryPinGroupPinned(pinned: readonly string[], field: LibraryPinFormField): boolean {
  return getLibraryPinModelFields(field).some((modelField) => pinned.includes(modelField));
}

export function setLibraryPinGroup(
  pinned: readonly string[],
  field: LibraryPinFormField,
  pin: boolean,
): string[] {
  const modelFields = getLibraryPinModelFields(field);
  const others = pinned.filter((modelField) => !modelFields.includes(modelField));
  return pin ? [...others, ...modelFields].sort() : others;
}

/** Whether the form currently holds a value for `field` — only a value can be pinned. */
export function hasLibraryPinFormValue(formData: Partial<Crop>, field: LibraryPinFormField): boolean {
  if (field === 'cultivation_types') {
    return Boolean(formData.cultivation_types?.length || formData.cultivation_type);
  }
  return !isEmptyPublicValue(formData[field]);
}

/**
 * The pins to save. Clearing a pinned field releases its pin (the backend
 * does the same), so a pin on a field the form left empty is dropped.
 */
export function libraryPinnedFieldsForSave(formData: Partial<Crop>): string[] {
  let pinned = [...(formData.library_pinned_fields ?? [])];
  (Object.keys(LIBRARY_PIN_FORM_FIELDS) as LibraryPinFormField[]).forEach((field) => {
    if (isLibraryPinGroupPinned(pinned, field) && !hasLibraryPinFormValue(formData, field)) {
      pinned = setLibraryPinGroup(pinned, field, false);
    }
  });
  return pinned.sort();
}

const LIBRARY_PIN_ERROR_CODES = new Set([
  'library_pin_requires_link',
  'library_pin_field_not_allowed',
  'library_pin_field_empty',
  'library_unpin_field_not_pinned',
  'library_pin_field_not_local_change',
]);

/** The localized message for a rejected pin (stable backend codes), or null for any other error code. */
export function describeLibraryPinError(code: string | undefined, t: TFunction): string | null {
  return code && LIBRARY_PIN_ERROR_CODES.has(code) ? t(`library.pin.errors.${code}`) : null;
}

/**
 * The light "local" tint behind a pinned value or a chosen "Nur lokal" option.
 * Falls back to primary under a theme without the app palette (isolated tests).
 */
export function libraryLocalTint(theme: Theme, opacity: number = theme.palette.action.selectedOpacity): string {
  return alpha(theme.palette.libraryLocal?.main ?? theme.palette.primary.main, opacity);
}

/** A pinned field: a border in the "local" colour, so it stands out from synced ones. */
export const libraryPinnedFieldSx: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    backgroundColor: (theme: Theme) => libraryLocalTint(theme, theme.palette.action.hoverOpacity),
  },
  '& .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: 'libraryLocal.main',
    borderWidth: 2,
  },
  '& .MuiFormHelperText-root': { color: 'libraryLocal.main' },
};

/** Moves a Select's arrow left of the pin adornment, so the two never overlap. */
export const libraryPinSelectSx: SxProps<Theme> = {
  '& .MuiSelect-icon': { right: (theme: Theme) => theme.spacing(6) },
};

/** A pinned library value in model units, in the form's units (distances in cm). */
export function formatLibraryPinnedValue(modelField: string, value: unknown, t: TFunction): string {
  if (modelField.endsWith('_m') && typeof value === 'number') {
    const centimeters = Math.round(value * 10000) / 100;
    return `${centimeters} ${t('detail.units.centimeters')}`;
  }
  if (modelField === 'notes' && typeof value === 'string' && value.length > 80) {
    return `${value.slice(0, 80)}…`;
  }
  return formatPublicCropValue(modelField, value, t);
}

/**
 * Whether `field` is pinned on `crop` and carries a value — the only case in
 * which the form and the read view show the pin.
 */
export function isLibraryFieldPinned(crop: Partial<Crop>, field: LibraryPinFormField): boolean {
  return isLibraryPinGroupPinned(crop.library_pinned_fields ?? [], field) && hasLibraryPinFormValue(crop, field);
}

/**
 * The linked entry's current value for a pinned form field, formatted, from the
 * serializer's `library_pinned_values`; undefined when it is not known.
 */
export function getLibraryPinnedValueLabel(
  pinnedLibraryValues: Readonly<Record<string, unknown>>,
  field: LibraryPinFormField,
  t: TFunction,
): string | undefined {
  const primaryModelField = getLibraryPinModelFields(field)[0];
  return primaryModelField in pinnedLibraryValues
    ? formatLibraryPinnedValue(primaryModelField, pinnedLibraryValues[primaryModelField], t)
    : undefined;
}

/** The pin's tooltip ("Lokal fixiert. Bibliothek: …"), shared by the form and the read view. */
export function getLibraryPinTooltip(libraryValue: string | undefined, t: TFunction): string {
  return libraryValue !== undefined
    ? t('library.pin.tooltip', { value: libraryValue })
    : t('library.pin.tooltipPending');
}

/** The crop's pinned fields as labels, deduplicated by form control, in a stable order. */
export function getPinnedFieldLabels(crop: Pick<Crop, 'library_pinned_fields'> | null | undefined, t: TFunction): string[] {
  const pinned = crop?.library_pinned_fields ?? [];
  // `cultivation_type` is the single-value echo of `cultivation_types`.
  const shown = pinned.filter((field) => !(field === 'cultivation_type' && pinned.includes('cultivation_types')));
  return shown.map((field) => getPublicCropComparisonFieldLabel(field, t));
}
