import type { Bed, Field } from '../../api/types';

export interface HierarchyAvailability {
  fieldIdsWithBeds: Set<number>;
  locationIdsWithBeds: Set<number>;
}

export const collectHierarchyAvailability = (
  fields: Field[],
  beds: Bed[],
): HierarchyAvailability => {
  const fieldIdsWithBeds = new Set<number>();
  beds.forEach((bed) => {
    if (typeof bed.field === 'number') {
      fieldIdsWithBeds.add(bed.field);
    }
  });

  const locationIdsWithBeds = new Set<number>();
  fields.forEach((field) => {
    if (field.id !== undefined && fieldIdsWithBeds.has(field.id)) {
      locationIdsWithBeds.add(field.location);
    }
  });

  return { fieldIdsWithBeds, locationIdsWithBeds };
};
