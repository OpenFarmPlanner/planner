import type { Bed, Field, Location } from '../../api/types';
import { normalizeSearchText } from '../../search/searchText';
import { toNumericValue } from '../../pages/plantingPlansUtils';

export interface BedPickerOption {
  id: number;
  name: string;
  fieldId: number;
  fieldName: string;
  locationId: number;
  locationName: string;
  areaSqm: number | null;
  searchText: string;
}

export interface BedPickerScope {
  locationId: number | null;
  fieldId: number | null;
}

export const ALL_BEDS: BedPickerScope = { locationId: null, fieldId: null };
export const BED_PATH_SEPARATOR = ' › ';

export function buildBedPickerOptions(
  beds: Bed[],
  fields: Field[],
  locations: Location[],
  locale: string,
): BedPickerOption[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });

  return beds.flatMap((bed): BedPickerOption[] => {
    const field = fieldsById.get(bed.field);
    const location = field && locationsById.get(field.location);
    if (bed.id === undefined || field?.id === undefined || location?.id === undefined) {
      return [];
    }

    return [{
      id: bed.id,
      name: bed.name,
      fieldId: field.id,
      fieldName: field.name,
      locationId: location.id,
      locationName: location.name,
      areaSqm: toNumericValue(bed.area_sqm),
      searchText: normalizeSearchText([location.name, field.name, bed.name].join('\n')),
    }];
  }).sort((first, second) => (
    collator.compare(first.locationName, second.locationName)
    || first.locationId - second.locationId
    || collator.compare(first.fieldName, second.fieldName)
    || first.fieldId - second.fieldId
    || collator.compare(first.name, second.name)
    || first.id - second.id
  ));
}

export function isBedInScope(option: BedPickerOption, scope: BedPickerScope): boolean {
  return (scope.locationId === null || option.locationId === scope.locationId)
    && (scope.fieldId === null || option.fieldId === scope.fieldId);
}
