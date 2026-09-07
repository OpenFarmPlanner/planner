import type { Bed, Field, Location } from '../../api/types';

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

export const filterFieldOptionsByLocation = (
  rowLocationId: number | null,
  fields: Field[],
  fieldIdsWithBeds: Set<number>,
): Field[] =>
  fields.filter((field) => {
    if (field.id === undefined || !fieldIdsWithBeds.has(field.id)) {
      return false;
    }
    return rowLocationId ? field.location === rowLocationId : true;
  });

export const filterBedOptionsBySelection = (
  rowLocationId: number | null,
  rowFieldId: number | null,
  fields: Field[],
  beds: Bed[],
  fieldIdsWithBeds: Set<number>,
): Bed[] =>
  beds.filter((bed) => {
    if (bed.id === undefined || !fieldIdsWithBeds.has(bed.field)) {
      return false;
    }
    if (rowFieldId) {
      return bed.field === rowFieldId;
    }
    if (rowLocationId) {
      const linkedField = fields.find((field) => field.id === bed.field);
      return linkedField?.location === rowLocationId;
    }
    return true;
  });

export type BedWithHierarchy = Bed & { id: number; fieldId: number; locationId: number };

export interface AreaHierarchyIndex {
  /** Beds whose field (and therefore location) could be resolved. */
  bedsWithLocation: BedWithHierarchy[];
  fieldsByLocationId: Map<number, Field[]>;
  bedsByFieldId: Map<number, BedWithHierarchy[]>;
  /** Locations that actually contain at least one bed. */
  selectableLocations: Location[];
}

const buildAreaHierarchyIndex = (
  locations: Location[],
  fields: Field[],
  beds: Bed[],
): AreaHierarchyIndex => {
  const fieldsById = new Map<number, Field>();
  fields.forEach((field) => {
    if (field.id !== undefined) {
      fieldsById.set(field.id, field);
    }
  });

  const bedsWithLocation: BedWithHierarchy[] = [];
  const bedsByFieldId = new Map<number, BedWithHierarchy[]>();
  beds.forEach((bed) => {
    const relatedField = bed.id === undefined ? undefined : fieldsById.get(bed.field);
    if (bed.id === undefined || !relatedField || relatedField.id === undefined) {
      return;
    }
    const bedWithHierarchy: BedWithHierarchy = {
      ...bed,
      id: bed.id,
      fieldId: relatedField.id,
      locationId: relatedField.location,
    };
    bedsWithLocation.push(bedWithHierarchy);
    const bedsOfField = bedsByFieldId.get(bedWithHierarchy.fieldId);
    if (bedsOfField) {
      bedsOfField.push(bedWithHierarchy);
    } else {
      bedsByFieldId.set(bedWithHierarchy.fieldId, [bedWithHierarchy]);
    }
  });

  const { fieldIdsWithBeds, locationIdsWithBeds } = collectHierarchyAvailability(fields, bedsWithLocation);

  const fieldsByLocationId = new Map<number, Field[]>();
  locations.forEach((location) => {
    if (location.id !== undefined) {
      fieldsByLocationId.set(
        location.id,
        filterFieldOptionsByLocation(location.id, fields, fieldIdsWithBeds),
      );
    }
  });

  return {
    bedsWithLocation,
    fieldsByLocationId,
    bedsByFieldId,
    selectableLocations: locations.filter(
      (location) => location.id !== undefined && locationIdsWithBeds.has(location.id),
    ),
  };
};

// Every growing-area cell in the planting-plan grid renders its own
// AreaAssignmentDialog, and each one used to derive this index from the same
// three arrays on mount. With a few thousand beds that meant rebuilding the
// whole hierarchy for every row scrolled into view. The arrays come straight
// from the page's state, so their identity is a sound cache key: one build is
// shared by every cell, and a changed array simply builds a new entry.
const areaHierarchyIndexCache = new WeakMap<
  Location[],
  WeakMap<Field[], WeakMap<Bed[], AreaHierarchyIndex>>
>();

export const getAreaHierarchyIndex = (
  locations: Location[],
  fields: Field[],
  beds: Bed[],
): AreaHierarchyIndex => {
  let byFields = areaHierarchyIndexCache.get(locations);
  if (!byFields) {
    byFields = new WeakMap<Field[], WeakMap<Bed[], AreaHierarchyIndex>>();
    areaHierarchyIndexCache.set(locations, byFields);
  }
  let byBeds = byFields.get(fields);
  if (!byBeds) {
    byBeds = new WeakMap<Bed[], AreaHierarchyIndex>();
    byFields.set(fields, byBeds);
  }
  const cached = byBeds.get(beds);
  if (cached) {
    return cached;
  }
  const index = buildAreaHierarchyIndex(locations, fields, beds);
  byBeds.set(beds, index);
  return index;
};
