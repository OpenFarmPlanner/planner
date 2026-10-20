/**
 * Utility functions for building hierarchical data structures
 */

import type { Location, Field, Bed } from '../../../api/api';

import type { HierarchyRow } from './types';

export interface HierarchySortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

export interface HierarchyIndex {
  hasMultipleLocations: boolean;
  sortedLocations: Location[];
  sortedTopLevelFields: Field[];
  fieldsByLocation: Map<number, Field[]>;
  bedsByField: Map<number, Bed[]>;
}

export const hasPersistedEntityId = (id: number | undefined): id is number => (
  typeof id === 'number' && Number.isInteger(id) && id > 0
);

// Natural order: digit runs compare as numbers, so "E 2" sorts before
// "E 10" and "E 1 9" before "E 1 10".
const nameCollator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Natural, case-insensitive name order used for every hierarchy level. */
export const compareHierarchyNames = (left: string, right: string): number => nameCollator.compare(left, right);

const compareText = (left: string, right: string, direction: 'asc' | 'desc'): number => {
  const result = compareHierarchyNames(left, right);
  return direction === 'asc' ? result : -result;
};

/** Without an explicit sort, rows follow their names in natural order. */
export const DEFAULT_HIERARCHY_SORT_CONFIG: HierarchySortConfig = { field: 'name', direction: 'asc' };

const parseNumeric = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const compareNumeric = (left: unknown, right: unknown, direction: 'asc' | 'desc'): number => {
  const leftNumber = parseNumeric(left);
  const rightNumber = parseNumeric(right);

  if (leftNumber === null && rightNumber === null) return 0;
  if (leftNumber === null) return 1;
  if (rightNumber === null) return -1;

  const result = leftNumber - rightNumber;
  return direction === 'asc' ? result : -result;
};

const sortByConfig = <T extends Location | Field | Bed>(items: T[], sortConfig?: HierarchySortConfig): T[] => {
  if (!sortConfig) {
    return items;
  }

  const sorted = [...items];

  sorted.sort((left, right) => {
    if (sortConfig.field === 'area_sqm') {
      const leftArea = 'area_sqm' in left ? left.area_sqm : 0;
      const rightArea = 'area_sqm' in right ? right.area_sqm : 0;
      const numericResult = compareNumeric(leftArea, rightArea, sortConfig.direction);
      if (numericResult !== 0) {
        return numericResult;
      }
      return compareText(left.name ?? '', right.name ?? '', 'asc');
    }

    const textResult = compareText(left.name ?? '', right.name ?? '', sortConfig.direction);
    if (textResult !== 0) {
      return textResult;
    }

    const leftArea = 'area_sqm' in left ? left.area_sqm : 0;
    const rightArea = 'area_sqm' in right ? right.area_sqm : 0;
    return compareNumeric(leftArea, rightArea, 'asc');
  });

  return sorted;
};

export interface HierarchyOrderSnapshot {
  locationOrder: number[];
  fieldOrder: number[];
  bedOrder: number[];
}

/**
 * Captures the id order that `sortByConfig` would currently produce for each
 * entity type. Taking this snapshot only at explicit moments (initial load,
 * reload, an explicit sort change) — instead of resorting live on every data
 * change — is what lets `applyHierarchyOrderSnapshot` keep a row in place
 * after a create/rename instead of jumping to its freshly-sorted position.
 */
export function computeHierarchyOrderSnapshot(
  locations: Location[],
  fields: Field[],
  beds: Bed[],
  sortConfig?: HierarchySortConfig,
): HierarchyOrderSnapshot {
  const effectiveSortConfig = sortConfig ?? DEFAULT_HIERARCHY_SORT_CONFIG;
  return {
    locationOrder: sortByConfig(locations, effectiveSortConfig).map((location) => location.id!),
    fieldOrder: sortByConfig(fields, effectiveSortConfig).map((field) => field.id!),
    bedOrder: sortByConfig(beds, effectiveSortConfig).map((field) => field.id!),
  };
}

const orderByStableIds = <T extends { id?: number }>(
  entities: T[],
  orderedIds: readonly number[],
): T[] => {
  if (orderedIds.length === 0) {
    return entities;
  }

  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const orderedEntities: T[] = [];
  orderedIds.forEach((id) => {
    const entity = entitiesById.get(id);
    if (entity) {
      orderedEntities.push(entity);
    }
  });

  const orderedIdSet = new Set(orderedIds);
  const missingEntities = entities.filter(
    (entity) => entity.id === undefined || !orderedIdSet.has(entity.id),
  );
  // Missing (new/unsnapshotted) entities go first, not last: once grouped by
  // parent, that puts a newly created row as the first child of whichever
  // location/field it belongs to — right next to the "add" action that
  // created it — instead of at the bottom of a potentially long group.
  return [...missingEntities, ...orderedEntities];
};

/**
 * Reorders locations/fields/beds to match a previously captured order
 * snapshot. Entities absent from the snapshot (a just-created row, still
 * unsaved or saved after the last snapshot refresh) are placed first within
 * their entity list, which — once grouped by parent — puts them at the top
 * of their group (right next to the "add" action that created them) rather
 * than at whatever position a live re-sort would compute.
 */
export function applyHierarchyOrderSnapshot(
  locations: Location[],
  fields: Field[],
  beds: Bed[],
  orderSnapshot: HierarchyOrderSnapshot,
): { locations: Location[]; fields: Field[]; beds: Bed[] } {
  return {
    locations: orderByStableIds(locations, orderSnapshot.locationOrder),
    fields: orderByStableIds(fields, orderSnapshot.fieldOrder),
    beds: orderByStableIds(beds, orderSnapshot.bedOrder),
  };
}

/**
 * Places a duplicated field directly below its source in the order snapshot
 * (instead of at the top, where unsnapshotted rows go) and its beds in
 * natural name order.
 */
export function placeDuplicatedFieldInSnapshot(
  snapshot: HierarchyOrderSnapshot,
  sourceFieldId: number,
  createdField: Field,
  createdBeds: readonly Bed[],
): HierarchyOrderSnapshot {
  const createdFieldId = createdField.id;
  const sourceIndex = snapshot.fieldOrder.indexOf(sourceFieldId);
  if (createdFieldId === undefined || sourceIndex === -1) {
    return snapshot;
  }
  const fieldOrder = [...snapshot.fieldOrder];
  fieldOrder.splice(sourceIndex + 1, 0, createdFieldId);
  const bedIds = [...createdBeds]
    .sort((left, right) => compareHierarchyNames(left.name ?? '', right.name ?? ''))
    .flatMap((bed) => (bed.id === undefined ? [] : [bed.id]));
  return { ...snapshot, fieldOrder, bedOrder: [...snapshot.bedOrder, ...bedIds] };
}

/**
 * Build hierarchy rows from flat data
 */
export function buildHierarchyRows(
  locations: Location[],
  fields: Field[],
  beds: Bed[],
  expandedRows: Set<string | number>,
  sortConfig?: HierarchySortConfig
): HierarchyRow[] {
  const index = buildHierarchyIndex(locations, fields, beds, sortConfig);
  return buildHierarchyRowsFromIndex(index, expandedRows);
}

export function buildHierarchyIndex(
  locations: Location[],
  fields: Field[],
  beds: Bed[],
  sortConfig?: HierarchySortConfig,
): HierarchyIndex {
  const sortedLocations = sortByConfig(locations, sortConfig);
  const sortedTopLevelFields = sortByConfig(fields, sortConfig);
  const fieldsByLocationUnsorted = new Map<number, Field[]>();
  const bedsByFieldUnsorted = new Map<number, Bed[]>();

  fields.forEach((field) => {
    const bucket = fieldsByLocationUnsorted.get(field.location) ?? [];
    bucket.push(field);
    fieldsByLocationUnsorted.set(field.location, bucket);
  });

  beds.forEach((bed) => {
    const bucket = bedsByFieldUnsorted.get(bed.field) ?? [];
    bucket.push(bed);
    bedsByFieldUnsorted.set(bed.field, bucket);
  });

  const fieldsByLocation = new Map<number, Field[]>();
  fieldsByLocationUnsorted.forEach((locationFields, locationId) => {
    fieldsByLocation.set(locationId, sortByConfig(locationFields, sortConfig));
  });

  const bedsByField = new Map<number, Bed[]>();
  bedsByFieldUnsorted.forEach((fieldBeds, fieldId) => {
    bedsByField.set(fieldId, sortByConfig(fieldBeds, sortConfig));
  });

  return {
    hasMultipleLocations: sortedLocations.length > 1,
    sortedLocations,
    sortedTopLevelFields,
    fieldsByLocation,
    bedsByField,
  };
}

export function buildHierarchyRowsFromIndex(
  hierarchyIndex: HierarchyIndex,
  expandedRows: Set<string | number>,
): HierarchyRow[] {
  const hierarchyRows: HierarchyRow[] = [];
  const singleLocationId = !hierarchyIndex.hasMultipleLocations
    ? hierarchyIndex.sortedLocations[0]?.id
    : undefined;

  if (hierarchyIndex.hasMultipleLocations) {
    hierarchyIndex.sortedLocations.forEach((location) => {
      const locationKey = `location-${location.id}`;
      const isExpanded = expandedRows.has(locationKey);
      const locationFields =
        hierarchyIndex.fieldsByLocation.get(location.id!) ?? [];
      hierarchyRows.push({
        id: locationKey,
        type: 'location',
        level: 0,
        name: location.name,
        locationId: location.id,
        expanded: isExpanded,
        hasChildren: locationFields.length > 0,
        notes: location.notes,
      });

      if (!isExpanded) return;

      locationFields.forEach((field) => {
        const fieldKey = `field-${field.id}`;
        const isFieldExpanded = expandedRows.has(fieldKey);
        const fieldBeds = hierarchyIndex.bedsByField.get(field.id!) ?? [];
        hierarchyRows.push({
          id: fieldKey,
          type: 'field',
          level: 1,
          name: field.name,
          parentId: locationKey,
          locationId: location.id,
          fieldId: field.id,
          expanded: isFieldExpanded,
          hasChildren: fieldBeds.length > 0,
          area_sqm: field.area_sqm,
          length_m: field.length_m,
          width_m: field.width_m,
          notes: field.notes,
          isNew: field.id! < 0,
        });

        if (!isFieldExpanded) return;

        fieldBeds.forEach((bed) => {
          hierarchyRows.push({
            id: bed.id!,
            type: 'bed',
            level: 2,
            parentId: fieldKey,
            name: bed.name,
            field: bed.field,
            field_name: field.name,
            area_sqm: bed.area_sqm,
            length_m: bed.length_m,
            width_m: bed.width_m,
            notes: bed.notes,
            locationId: location.id,
            fieldId: field.id,
            bedId: bed.id,
            hasChildren: false,
            isNew: bed.id! < 0,
          });
        });
      });
    });

    return hierarchyRows;
  }

  hierarchyIndex.sortedTopLevelFields.forEach((field) => {
    const fieldKey = `field-${field.id}`;
    const isFieldExpanded = expandedRows.has(fieldKey);
    const fieldBeds = hierarchyIndex.bedsByField.get(field.id!) ?? [];
    hierarchyRows.push({
      id: fieldKey,
      type: 'field',
      level: 0,
      name: field.name,
      fieldId: field.id,
      ...(singleLocationId !== undefined ? { locationId: singleLocationId } : {}),
      expanded: isFieldExpanded,
      hasChildren: fieldBeds.length > 0,
      area_sqm: field.area_sqm,
      length_m: field.length_m,
      width_m: field.width_m,
      notes: field.notes,
      isNew: field.id! < 0,
    });

    if (!isFieldExpanded) return;

    fieldBeds.forEach((bed) => {
      hierarchyRows.push({
        id: bed.id!,
        type: 'bed',
        level: 1,
        parentId: fieldKey,
        name: bed.name,
        field: bed.field,
        field_name: field.name,
        area_sqm: bed.area_sqm,
        length_m: bed.length_m,
        width_m: bed.width_m,
        notes: bed.notes,
        fieldId: field.id,
        ...(singleLocationId !== undefined ? { locationId: singleLocationId } : {}),
        bedId: bed.id,
        hasChildren: false,
        isNew: bed.id! < 0,
      });
    });
  });

  return hierarchyRows;
}

/**
 * Creates a reusable projector that materializes hierarchy rows while reusing row objects
 * for unchanged nodes. This reduces object churn on frequent expand/collapse toggles.
 */
export function createHierarchyRowsProjector(hierarchyIndex: HierarchyIndex) {
  const locationRows = new Map<string, HierarchyRow>();
  const fieldRows = new Map<string, HierarchyRow>();
  const bedRows = new Map<number, HierarchyRow>();

  const getLocationRow = (
    location: Location,
    hasChildren: boolean,
    expanded: boolean,
  ): HierarchyRow => {
    const key = `${location.id}:${expanded ? '1' : '0'}`;
    const cached = locationRows.get(key);
    if (cached) {
      return cached;
    }

    const row: HierarchyRow = {
      id: `location-${location.id}`,
      type: 'location',
      level: 0,
      name: location.name,
      locationId: location.id,
      expanded,
      hasChildren,
      notes: location.notes,
    };
    locationRows.set(key, row);
    return row;
  };

  const getFieldRow = (
    field: Field,
    level: 0 | 1,
    parentId: string | undefined,
    locationId: number | undefined,
    hasChildren: boolean,
    expanded: boolean,
  ): HierarchyRow => {
    const key = `${field.id}:${level}:${parentId ?? ''}:${locationId ?? ''}:${expanded ? '1' : '0'}`;
    const cached = fieldRows.get(key);
    if (cached) {
      return cached;
    }

    const row: HierarchyRow = {
      id: `field-${field.id}`,
      type: 'field',
      level,
      name: field.name,
      fieldId: field.id,
      expanded,
      hasChildren,
      area_sqm: field.area_sqm,
      length_m: field.length_m,
      width_m: field.width_m,
      notes: field.notes,
      isNew: field.id! < 0,
      ...(parentId ? { parentId } : {}),
      ...(locationId !== undefined ? { locationId } : {}),
    };
    fieldRows.set(key, row);
    return row;
  };

  const getBedRow = (
    bed: Bed,
    level: 1 | 2,
    parentId: string,
    fieldId: number,
    fieldName: string,
    locationId: number | undefined,
  ): HierarchyRow => {
    const bedId = bed.id!;
    const cached = bedRows.get(bedId);
    if (cached) {
      return cached;
    }

    const row: HierarchyRow = {
      id: bedId,
      type: 'bed',
      level,
      parentId,
      name: bed.name,
      field: bed.field,
      field_name: fieldName,
      area_sqm: bed.area_sqm,
      length_m: bed.length_m,
      width_m: bed.width_m,
      notes: bed.notes,
      fieldId,
      bedId,
      hasChildren: false,
      isNew: bedId < 0,
      ...(locationId !== undefined ? { locationId } : {}),
    };
    bedRows.set(bedId, row);
    return row;
  };

  return (expandedRows: Set<string | number>): HierarchyRow[] => {
    const hierarchyRows: HierarchyRow[] = [];
    const singleLocationId = !hierarchyIndex.hasMultipleLocations
      ? hierarchyIndex.sortedLocations[0]?.id
      : undefined;

    if (hierarchyIndex.hasMultipleLocations) {
      hierarchyIndex.sortedLocations.forEach((location) => {
        const locationKey = `location-${location.id}`;
        const isExpanded = expandedRows.has(locationKey);
        const locationFields =
          hierarchyIndex.fieldsByLocation.get(location.id!) ?? [];

        hierarchyRows.push(
          getLocationRow(location, locationFields.length > 0, isExpanded),
        );

        if (!isExpanded) {
          return;
        }

        locationFields.forEach((field) => {
          const fieldKey = `field-${field.id}`;
          const isFieldExpanded = expandedRows.has(fieldKey);
          const fieldBeds = hierarchyIndex.bedsByField.get(field.id!) ?? [];

          hierarchyRows.push(
            getFieldRow(
              field,
              1,
              locationKey,
              location.id,
              fieldBeds.length > 0,
              isFieldExpanded,
            ),
          );

          if (!isFieldExpanded) {
            return;
          }

          fieldBeds.forEach((bed) => {
            hierarchyRows.push(
              getBedRow(
                bed,
                2,
                fieldKey,
                field.id!,
                field.name,
                location.id,
              ),
            );
          });
        });
      });

      return hierarchyRows;
    }

    hierarchyIndex.sortedTopLevelFields.forEach((field) => {
      const fieldKey = `field-${field.id}`;
      const isFieldExpanded = expandedRows.has(fieldKey);
      const fieldBeds = hierarchyIndex.bedsByField.get(field.id!) ?? [];

      hierarchyRows.push(
        getFieldRow(
          field,
          0,
          undefined,
          singleLocationId,
          fieldBeds.length > 0,
          isFieldExpanded,
        ),
      );

      if (!isFieldExpanded) {
        return;
      }

      fieldBeds.forEach((bed) => {
        hierarchyRows.push(
          getBedRow(bed, 1, fieldKey, field.id!, field.name, singleLocationId),
        );
      });
    });

    return hierarchyRows;
  };
}
