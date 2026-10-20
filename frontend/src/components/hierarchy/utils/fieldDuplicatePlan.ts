import type { Bed, Field } from '../../../api/types';
import { nextFreeName } from './bedNaming';

/** Mirrors the backend bed/field name limit. */
const MAX_NAME_LENGTH = 200;

export interface FieldDuplicateFormValues {
  name: string;
  copyBeds: boolean;
  replaceSearch: string;
  replaceWith: string;
}

export interface FieldDuplicatePlan {
  /** Trimmed new field name. */
  name: string;
  nameTaken: boolean;
  /** Names of the copied beds after the replacement, in table order; empty without beds. */
  bedNames: string[];
  /** True when a search text is set but no bed name contains it. */
  searchNotFound: boolean;
  /** Bed names the replacement would give to more than one bed (blocking). */
  duplicateBedNames: string[];
  /** Source bed names whose replacement would be empty or too long (blocking). */
  invalidBedNames: string[];
  canSubmit: boolean;
}

/** Same rule as the backend: first case-sensitive occurrence; an empty search keeps the name. */
export function replaceFirst(name: string, search: string, replacement: string): string {
  if (search === '') {
    return name;
  }
  const index = name.indexOf(search);
  return index === -1 ? name : `${name.slice(0, index)}${replacement}${name.slice(index + search.length)}`;
}

const fieldNamesInLocation = (fields: readonly Field[], locationId: number): string[] => (
  fields.filter((field) => field.location === locationId).map((field) => field.name)
);

/** Defaults: the source name counted up past every name in its location, beds copied, no replacement. */
export function getInitialFieldDuplicateValues(source: Field, fields: readonly Field[]): FieldDuplicateFormValues {
  return {
    name: nextFreeName(source.name, fieldNamesInLocation(fields, source.location)),
    copyBeds: true,
    replaceSearch: '',
    replaceWith: '',
  };
}

const findDuplicates = (names: readonly string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  names.forEach((name) => {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  });
  return [...duplicates];
};

export function evaluateFieldDuplicate(
  values: FieldDuplicateFormValues,
  source: Field,
  sourceBeds: readonly Bed[],
  fields: readonly Field[],
): FieldDuplicatePlan {
  const name = values.name.trim();
  const takenNames = new Set(fieldNamesInLocation(fields, source.location).map((fieldName) => fieldName.trim()));
  const nameTaken = name !== '' && takenNames.has(name);

  const beds = values.copyBeds ? sourceBeds : [];
  const bedNames = beds.map((bed) => replaceFirst(bed.name, values.replaceSearch, values.replaceWith).trim());
  const searchNotFound = values.replaceSearch !== ''
    && beds.length > 0
    && !beds.some((bed) => bed.name.includes(values.replaceSearch));
  const invalidBedNames = beds
    .filter((_, index) => bedNames[index] === '' || bedNames[index].length > MAX_NAME_LENGTH)
    .map((bed) => bed.name);
  const duplicateBedNames = findDuplicates(bedNames.filter((bedName) => bedName !== ''));

  return {
    name,
    nameTaken,
    bedNames,
    searchNotFound,
    duplicateBedNames,
    invalidBedNames,
    canSubmit: name !== '' && !nameTaken && duplicateBedNames.length === 0 && invalidBedNames.length === 0,
  };
}

/** First three names, then "…" when there are more. */
export function previewBedNames(names: readonly string[]): string[] {
  return names.length > 3 ? [...names.slice(0, 3), '…'] : [...names];
}
