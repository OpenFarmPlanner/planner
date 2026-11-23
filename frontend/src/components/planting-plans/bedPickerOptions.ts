import type { Bed, Field, Location } from '../../api/types';
import { normalizeSearchText } from '../../search/searchText';
import { toNumericValue } from '../../pages/plantingPlansUtils';

interface PickerPath {
  id: number;
  name: string;
  fieldName: string;
  locationId: number;
  locationName: string;
  searchText: string;
}

export interface BedPickerOption extends PickerPath {
  kind: 'bed';
  fieldId: number;
  areaSqm: number | null;
}

interface PickerLocation extends PickerPath {
  kind: 'location';
  fieldId: null;
}

interface PickerField extends PickerPath {
  kind: 'field';
  fieldId: number;
}

export type BedPickerResult = PickerLocation | PickerField | BedPickerOption;

export interface BedPickerScope {
  locationId: number | null;
  fieldId: number | null;
}

export const ALL_BEDS: BedPickerScope = { locationId: null, fieldId: null };
export const BED_PATH_SEPARATOR = ' › ';

export function buildBedPickerResults(
  beds: Bed[],
  fields: Field[],
  locations: Location[],
  locale: string,
): BedPickerResult[] {
  const locationsById = new Map<number, PickerLocation>();
  for (const { id, name } of locations) {
    if (id === undefined) continue;
    locationsById.set(id, {
      kind: 'location', id, name, locationId: id, locationName: name, fieldId: null, fieldName: '',
      searchText: normalizeSearchText(name),
    });
  }

  const fieldsById = new Map<number, PickerField>();
  for (const { id, name, location: locationId } of fields) {
    const location = locationsById.get(locationId);
    if (id === undefined || !location) continue;
    fieldsById.set(id, {
      ...location, kind: 'field', id, name, fieldId: id, fieldName: name,
      searchText: normalizeSearchText([location.name, name].join('\n')),
    });
  }

  const results: BedPickerResult[] = [...locationsById.values(), ...fieldsById.values()];
  for (const { id, name, field: fieldId, area_sqm } of beds) {
    const field = fieldsById.get(fieldId);
    if (id === undefined || !field) continue;
    results.push({
      ...field, kind: 'bed', id, name, areaSqm: toNumericValue(area_sqm),
      searchText: normalizeSearchText([field.locationName, field.name, name].join('\n')),
    });
  }

  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return results.sort((first, second) => (
    collator.compare(first.locationName, second.locationName)
    || first.locationId - second.locationId
    || Number(second.kind === 'location') - Number(first.kind === 'location')
    || collator.compare(first.fieldName, second.fieldName)
    || (first.fieldId ?? 0) - (second.fieldId ?? 0)
    || Number(second.kind === 'field') - Number(first.kind === 'field')
    || collator.compare(first.name, second.name)
    || first.id - second.id
  ));
}

export function isBedInScope(option: BedPickerScope, scope: BedPickerScope): boolean {
  return (scope.locationId === null || option.locationId === scope.locationId)
    && (scope.fieldId === null || option.fieldId === scope.fieldId);
}
