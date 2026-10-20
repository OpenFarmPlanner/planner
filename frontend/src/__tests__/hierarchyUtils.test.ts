/**
 * Tests for hierarchy utility functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyHierarchyOrderSnapshot,
  buildHierarchyIndex,
  buildHierarchyRows,
  buildHierarchyRowsFromIndex,
  computeHierarchyOrderSnapshot,
  createHierarchyRowsProjector,
  placeDuplicatedFieldInSnapshot,
} from '../components/hierarchy/utils/hierarchyUtils';
import type { Location, Field, Bed } from '../api/api';

describe('buildHierarchyRows', () => {
  let mockLocations: Location[];
  let mockFields: Field[];
  let mockBeds: Bed[];
  let expandedRows: Set<string | number>;

  beforeEach(() => {
    mockLocations = [
      { id: 1, name: 'Location 1' } as Location,
      { id: 2, name: 'Location 2' } as Location,
    ];

    mockFields = [
      {
        id: 1,
        name: 'Field 1',
        location: 1,
        area_sqm: 100,
        notes: 'Notes for field 1',
      } as Field,
      {
        id: 2,
        name: 'Field 2',
        location: 1,
        area_sqm: 200,
        notes: 'Notes for field 2',
      } as Field,
      {
        id: 3,
        name: 'Field 3',
        location: 2,
        area_sqm: 150,
        notes: 'Notes for field 3',
      } as Field,
    ];

    mockBeds = [
      {
        id: 1,
        name: 'Bed 1',
        field: 1,
        area_sqm: 50,
        notes: 'Bed notes 1',
      } as Bed,
      {
        id: 2,
        name: 'Bed 2',
        field: 1,
        area_sqm: 50,
        notes: 'Bed notes 2',
      } as Bed,
      {
        id: 3,
        name: 'Bed 3',
        field: 2,
        area_sqm: 200,
        notes: 'Bed notes 3',
      } as Bed,
    ];

    expandedRows = new Set();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty array when all inputs are empty', () => {
    const result = buildHierarchyRows([], [], [], new Set());
    expect(result).toEqual([]);
  });

  it('should build single-location hierarchy with fields as top level', () => {
    const singleLocation = [mockLocations[0]];
    expandedRows.add(`field-${mockFields[0].id}`);
    expandedRows.add(`field-${mockFields[1].id}`);

    const result = buildHierarchyRows(singleLocation, mockFields.slice(0, 2), mockBeds, expandedRows);

    // Should have fields at level 0
    const topLevelFields = result.filter((r) => r.level === 0 && r.type === 'field');
    expect(topLevelFields).toHaveLength(2);
    expect(topLevelFields[0].name).toBe('Field 1');
    expect(topLevelFields[1].name).toBe('Field 2');
  });

  it('should build multi-location hierarchy with locations as top level', () => {
    expandedRows.add('location-1');

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    // Should have locations at level 0
    const topLevelLocations = result.filter((r) => r.level === 0 && r.type === 'location');
    expect(topLevelLocations).toHaveLength(2);
    expect(topLevelLocations[0].name).toBe('Location 1');
    expect(topLevelLocations[1].name).toBe('Location 2');
  });

  it('should include expanded fields under expanded locations', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const fieldsUnderLocation1 = result.filter((r) => r.parentId === 'location-1' && r.type === 'field');
    expect(fieldsUnderLocation1).toHaveLength(2); // Field 1 and Field 2
  });

  it('should hide fields under collapsed locations', () => {
    // Don't expand any locations
    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    // Should only have location rows, no fields
    const fieldRows = result.filter((r) => r.type === 'field');
    expect(fieldRows).toHaveLength(0);
  });

  it('should include beds under expanded fields', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const bedsUnderField1 = result.filter((r) => r.parentId === 'field-1' && r.type === 'bed');
    expect(bedsUnderField1).toHaveLength(2); // Bed 1 and Bed 2
  });

  it('should hide beds under collapsed fields', () => {
    expandedRows.add('location-1');
    // Don't expand field-1

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const bedsUnderField1 = result.filter((r) => r.parentId === 'field-1');
    expect(bedsUnderField1).toHaveLength(0);
  });

  it('should correctly set level property', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const locations = result.filter((r) => r.type === 'location');
    const fields = result.filter((r) => r.type === 'field');
    const beds = result.filter((r) => r.type === 'bed');

    expect(locations.every((l) => l.level === 0)).toBe(true);
    expect(fields.every((f) => f.level === 1)).toBe(true);
    expect(beds.every((b) => b.level === 2)).toBe(true);
  });

  it('should correctly set type property', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const types = new Set(result.map((r) => r.type));
    expect(types).toEqual(new Set(['location', 'field', 'bed']));
  });

  it('should correctly set parentId relationships', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const field1 = result.find((r) => r.id === 'field-1');
    expect(field1?.parentId).toBe('location-1');

    const bed1 = result.find((r) => r.type === 'bed' && r.name === 'Bed 1');
    expect(bed1?.parentId).toBe('field-1');
  });

  it('should mark beds with negative IDs as new', () => {
    const newBeds = [
      { id: -1, name: 'New Bed', field: 1, area_sqm: 50 } as Bed,
      { id: 1, name: 'Existing Bed', field: 1, area_sqm: 50 } as Bed,
    ];

    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, [mockFields[0]], newBeds, expandedRows);

    const newBed = result.find((r) => r.type === 'bed' && r.id === -1);
    const existingBed = result.find((r) => r.type === 'bed' && r.id === 1);

    expect(newBed?.isNew).toBe(true);
    expect(existingBed?.isNew).toBe(false);
  });

  it('should mark fields with negative IDs as new', () => {
    const newFields = [
      { id: -1, name: 'New Field', location: 1, area_sqm: 100 } as Field,
      { id: 1, name: 'Existing Field', location: 1, area_sqm: 100 } as Field,
    ];

    expandedRows.add('location-1');

    const result = buildHierarchyRows(mockLocations, newFields, [], expandedRows);

    const newField = result.find((r) => r.type === 'field' && r.id === 'field--1');
    const existingField = result.find((r) => r.type === 'field' && r.id === 'field-1');

    expect(newField?.isNew).toBe(true);
    expect(existingField?.isNew).toBe(false);
  });

  // Regression test: createHierarchyRowsProjector is the row-builder actually used at
  // runtime (FieldsBedsHierarchy.tsx), and its getFieldRow helper was missing the isNew
  // flag entirely (unlike the equivalent getBedRow). This left a new, empty field row
  // stuck in the grid after pressing Escape, since discardRowEdit's cleanup only runs
  // for rows where isNew is true.
  it('marks a new field as isNew when projected via createHierarchyRowsProjector', () => {
    const newFields = [
      { id: -1, name: 'New Field', location: 1, area_sqm: 100 } as Field,
      { id: 1, name: 'Existing Field', location: 1, area_sqm: 100 } as Field,
    ];

    const hierarchyIndex = buildHierarchyIndex(mockLocations, newFields, [], { field: 'name', direction: 'asc' });
    const projectRows = createHierarchyRowsProjector(hierarchyIndex);
    const result = projectRows(new Set(['location-1']));

    const newField = result.find((r) => r.type === 'field' && r.fieldId === -1);
    const existingField = result.find((r) => r.type === 'field' && r.fieldId === 1);

    expect(newField?.isNew).toBe(true);
    expect(existingField?.isNew).toBe(false);
  });

  it('should filter fields by location correctly', () => {
    expandedRows.add('location-1');
    expandedRows.add('location-2');

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const location1Fields = result.filter((r) => r.parentId === 'location-1' && r.type === 'field');
    const location2Fields = result.filter((r) => r.parentId === 'location-2' && r.type === 'field');

    expect(location1Fields).toHaveLength(2); // Field 1, Field 2
    expect(location2Fields).toHaveLength(1); // Field 3
  });

  it('should filter beds by field correctly', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);
    expandedRows.add(`field-2`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const bedsUnderField1 = result.filter((r) => r.parentId === 'field-1' && r.type === 'bed');
    const bedsUnderField2 = result.filter((r) => r.parentId === 'field-2' && r.type === 'bed');

    expect(bedsUnderField1).toHaveLength(2); // Bed 1, Bed 2
    expect(bedsUnderField2).toHaveLength(1); // Bed 3
  });

  it('should preserve area_sqm property', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const field = result.find((r) => r.id === 'field-1');
    const bed = result.find((r) => r.type === 'bed' && r.name === 'Bed 1');

    expect(field?.area_sqm).toBe(100);
    expect(bed?.area_sqm).toBe(50);
  });

  it('should preserve notes property', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const field = result.find((r) => r.id === 'field-1');
    const bed = result.find((r) => r.type === 'bed' && r.name === 'Bed 1');

    expect(field?.notes).toBe('Notes for field 1');
    expect(bed?.notes).toBe('Bed notes 1');
  });

  it('should handle fields with no beds', () => {
    const fieldWithNoBeds = [mockFields[0]];

    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, fieldWithNoBeds, [], expandedRows);

    const bedRows = result.filter((r) => r.type === 'bed');
    expect(bedRows).toHaveLength(0);

    const fieldRows = result.filter((r) => r.type === 'field');
    expect(fieldRows).toHaveLength(1);
  });

  it('should handle locations with no fields', () => {
    const locationWithNoFields = [mockLocations[1]]; // Location 2
    const fieldsForLocation2 = mockFields.filter((f) => f.location === 2);

    expandedRows.add(`field-3`);

    const result = buildHierarchyRows(locationWithNoFields, fieldsForLocation2, mockBeds, expandedRows);

    // With only 1 location, fields are shown at top level (not locations)
    const fieldRows = result.filter((r) => r.type === 'field');
    expect(fieldRows).toHaveLength(1); // Field 3 at top level

    const locationRows = result.filter((r) => r.type === 'location');
    expect(locationRows).toHaveLength(0); // No location rows when single location
  });

  it('should set expanded state based on expandedRows Set', () => {
    expandedRows.add('location-1');
    // Don't add location-2

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const location1 = result.find((r) => r.id === 'location-1');
    const location2 = result.find((r) => r.id === 'location-2');

    expect(location1?.expanded).toBe(true);
    expect(location2?.expanded).toBe(false);
  });

  it('should set locationId on all hierarchy rows', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    result.forEach((row) => {
      expect(row.locationId).toBeDefined();
    });
  });

  it('should set fieldId on field and bed rows', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const fieldRows = result.filter((r) => r.type === 'field' || r.type === 'bed');
    fieldRows.forEach((row) => {
      expect(row.fieldId).toBeDefined();
    });
  });

  it('should set bedId on bed rows', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const bedRows = result.filter((r) => r.type === 'bed');
    bedRows.forEach((row) => {
      expect(row.bedId).toBeDefined();
    });
  });


  it('sorts only within each hierarchy level when sorting by name descending', () => {
    expandedRows.add('location-1');
    expandedRows.add('location-2');
    expandedRows.add('field-1');

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows, {
      field: 'name',
      direction: 'desc',
    });

    const topLevelLocations = result.filter((row) => row.type === 'location');
    expect(topLevelLocations.map((row) => row.name)).toEqual(['Location 2', 'Location 1']);

    const location1Fields = result.filter((row) => row.parentId === 'location-1' && row.type === 'field');
    expect(location1Fields.map((row) => row.name)).toEqual(['Field 2', 'Field 1']);

    const field1Beds = result.filter((row) => row.parentId === 'field-1' && row.type === 'bed');
    expect(field1Beds.map((row) => row.name)).toEqual(['Bed 2', 'Bed 1']);
  });

  it('sorts each level by area while preserving the hierarchy', () => {
    expandedRows.add('location-1');
    expandedRows.add('location-2');

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows, {
      field: 'area_sqm',
      direction: 'desc',
    });

    const topLevelLocations = result.filter((row) => row.type === 'location');
    expect(topLevelLocations).toHaveLength(2);

    const fieldsUnderLocation1 = result.filter((row) => row.parentId === 'location-1' && row.type === 'field');
    expect(fieldsUnderLocation1.map((row) => row.name)).toEqual(['Field 2', 'Field 1']);

    const fieldsUnderLocation2 = result.filter((row) => row.parentId === 'location-2' && row.type === 'field');
    expect(fieldsUnderLocation2.map((row) => row.name)).toEqual(['Field 3']);
  });

  it('should set field_name on bed rows', () => {
    expandedRows.add('location-1');
    expandedRows.add(`field-1`);

    const result = buildHierarchyRows(mockLocations, mockFields, mockBeds, expandedRows);

    const bed1 = result.find((r) => r.type === 'bed' && r.name === 'Bed 1');
    expect(bed1?.field_name).toBe('Field 1');
  });

  it('returns the same rows when materializing from a precomputed hierarchy index', () => {
    expandedRows.add('location-1');
    expandedRows.add('location-2');
    expandedRows.add('field-1');

    const directRows = buildHierarchyRows(
      mockLocations,
      mockFields,
      mockBeds,
      expandedRows,
      { field: 'name', direction: 'asc' },
    );
    const hierarchyIndex = buildHierarchyIndex(
      mockLocations,
      mockFields,
      mockBeds,
      { field: 'name', direction: 'asc' },
    );
    const indexedRows = buildHierarchyRowsFromIndex(hierarchyIndex, expandedRows);

    expect(indexedRows).toEqual(directRows);
  });

  it('materializing rows from a reused index is faster than rebuilding from raw arrays', () => {
    const largeLocations = Array.from({ length: 20 }, (_, locationOffset) => ({
      id: locationOffset + 1,
      name: `Location ${locationOffset + 1}`,
    })) as Location[];
    const largeFields = largeLocations.flatMap((location) =>
      Array.from({ length: 20 }, (_, fieldOffset) => ({
        id: location.id! * 1000 + fieldOffset,
        name: `Field ${location.id}-${fieldOffset}`,
        location: location.id!,
        area_sqm: 100 + fieldOffset,
      })),
    ) as Field[];
    const largeBeds = largeFields.flatMap((field) =>
      Array.from({ length: 20 }, (_, bedOffset) => ({
        id: field.id! * 1000 + bedOffset,
        name: `Bed ${field.id}-${bedOffset}`,
        field: field.id!,
        area_sqm: 10 + bedOffset,
      })),
    ) as Bed[];

    const expanded = new Set<string | number>(
      largeLocations.map((location) => `location-${location.id}`),
    );
    largeFields.forEach((field) => {
      expanded.add(`field-${field.id}`);
    });

    const sortConfig = { field: 'name', direction: 'asc' } as const;

    const rebuildStart = performance.now();
    for (let index = 0; index < 10; index += 1) {
      buildHierarchyRows(
        largeLocations,
        largeFields,
        largeBeds,
        expanded,
        sortConfig,
      );
    }
    const rebuildDuration = performance.now() - rebuildStart;

    const hierarchyIndex = buildHierarchyIndex(
      largeLocations,
      largeFields,
      largeBeds,
      sortConfig,
    );
    const reuseStart = performance.now();
    for (let index = 0; index < 10; index += 1) {
      buildHierarchyRowsFromIndex(hierarchyIndex, expanded);
    }
    const reuseDuration = performance.now() - reuseStart;

    expect(reuseDuration).toBeLessThan(rebuildDuration);
  });

  it('reuses row object references for unchanged visible rows across expand toggles', () => {
    const hierarchyIndex = buildHierarchyIndex(
      mockLocations,
      mockFields,
      mockBeds,
      { field: 'name', direction: 'asc' },
    );
    const projectRows = createHierarchyRowsProjector(hierarchyIndex);

    const initiallyExpanded = new Set<string | number>(['location-1']);
    const initialRows = projectRows(initiallyExpanded);

    const withExpandedField = new Set<string | number>(['location-1', 'field-1']);
    const rowsAfterExpand = projectRows(withExpandedField);

    const locationInitial = initialRows.find((row) => row.id === 'location-1');
    const locationAfterExpand = rowsAfterExpand.find((row) => row.id === 'location-1');
    const unchangedFieldInitial = initialRows.find((row) => row.id === 'field-2');
    const unchangedFieldAfterExpand = rowsAfterExpand.find((row) => row.id === 'field-2');
    const toggledFieldInitial = initialRows.find((row) => row.id === 'field-1');
    const toggledFieldAfterExpand = rowsAfterExpand.find((row) => row.id === 'field-1');

    expect(locationInitial).toBeDefined();
    expect(locationAfterExpand).toBeDefined();
    expect(unchangedFieldInitial).toBeDefined();
    expect(unchangedFieldAfterExpand).toBeDefined();
    expect(toggledFieldInitial).toBeDefined();
    expect(toggledFieldAfterExpand).toBeDefined();

    expect(locationInitial).toBe(locationAfterExpand);
    expect(unchangedFieldInitial).toBe(unchangedFieldAfterExpand);
    expect(toggledFieldInitial).not.toBe(toggledFieldAfterExpand);
  });

  it('projects rows with lower row-object churn during repeated expand/collapse toggles', () => {
    const largeLocations = Array.from({ length: 15 }, (_, locationOffset) => ({
      id: locationOffset + 1,
      name: `Location ${locationOffset + 1}`,
    })) as Location[];
    const largeFields = largeLocations.flatMap((location) =>
      Array.from({ length: 20 }, (_, fieldOffset) => ({
        id: location.id! * 1000 + fieldOffset,
        name: `Field ${location.id}-${fieldOffset}`,
        location: location.id!,
        area_sqm: 100 + fieldOffset,
      })),
    ) as Field[];
    const largeBeds = largeFields.flatMap((field) =>
      Array.from({ length: 12 }, (_, bedOffset) => ({
        id: field.id! * 1000 + bedOffset,
        name: `Bed ${field.id}-${bedOffset}`,
        field: field.id!,
        area_sqm: 10 + bedOffset,
      })),
    ) as Bed[];

    const hierarchyIndex = buildHierarchyIndex(
      largeLocations,
      largeFields,
      largeBeds,
      { field: 'name', direction: 'asc' },
    );
    const projector = createHierarchyRowsProjector(hierarchyIndex);

    const expanded = new Set<string | number>(
      largeLocations.map((location) => `location-${location.id}`),
    );

    const toggledFieldIds = largeFields.slice(0, 30).map((field) => `field-${field.id}`);

    const directReferences = new Set<object>();
    for (let iteration = 0; iteration < 40; iteration += 1) {
      toggledFieldIds.forEach((fieldId, index) => {
        if ((iteration + index) % 2 === 0) {
          expanded.add(fieldId);
        } else {
          expanded.delete(fieldId);
        }
      });
      buildHierarchyRowsFromIndex(hierarchyIndex, expanded).forEach((row) => {
        directReferences.add(row);
      });
    }

    const projectedReferences = new Set<object>();
    for (let iteration = 0; iteration < 40; iteration += 1) {
      toggledFieldIds.forEach((fieldId, index) => {
        if ((iteration + index) % 2 === 0) {
          expanded.add(fieldId);
        } else {
          expanded.delete(fieldId);
        }
      });
      projector(expanded).forEach((row) => {
        projectedReferences.add(row);
      });
    }

    expect(projectedReferences.size).toBeLessThan(directReferences.size);
  });
});

// Regression coverage for the "renaming/creating a row inside a sorted
// hierarchy table shouldn't immediately jump it to its freshly-sorted
// position" fix: the snapshot is only taken at explicit moments (initial
// load, reload, an explicit sort change), and applying it to changed data in
// between must leave renamed rows in place and put new rows at the end of
// their group instead of resorting live.
describe('hierarchy stable order snapshot', () => {
  it('keeps a renamed field in its snapshotted position instead of resorting live', () => {
    const fields = [
      { id: 1, name: 'Acker', location: 1, area_sqm: 100 } as Field,
      { id: 2, name: 'Feld', location: 1, area_sqm: 100 } as Field,
      { id: 3, name: 'Wiese', location: 1, area_sqm: 100 } as Field,
    ];
    const snapshot = computeHierarchyOrderSnapshot([], fields, [], { field: 'name', direction: 'asc' });
    expect(snapshot.fieldOrder).toEqual([1, 2, 3]);

    // Renaming "Acker" to "Zoo" would sort it last alphabetically, but the
    // snapshot wasn't refreshed, so it must stay first.
    const renamedFields = [
      { id: 1, name: 'Zoo', location: 1, area_sqm: 100 } as Field,
      { id: 2, name: 'Feld', location: 1, area_sqm: 100 } as Field,
      { id: 3, name: 'Wiese', location: 1, area_sqm: 100 } as Field,
    ];
    const ordered = applyHierarchyOrderSnapshot([], renamedFields, [], snapshot);
    expect(ordered.fields.map((field) => field.id)).toEqual([1, 2, 3]);
  });

  it('inserts a newly created bed as the first child of its group instead of at its sorted position', () => {
    const beds = [
      { id: 21, name: 'Beet B', field: 10 } as Bed,
      { id: 22, name: 'Beet D', field: 10 } as Bed,
    ];
    const snapshot = computeHierarchyOrderSnapshot([], [], beds, { field: 'name', direction: 'asc' });
    expect(snapshot.bedOrder).toEqual([21, 22]);

    // A new "Zeta"-style bed is prepended to the raw array (as
    // useBedOperations.addBed does) and would sort last alphabetically —
    // it must still render right next to the "add bed" action that created
    // it (first in the group), not buried below existing beds, since it's
    // absent from the snapshot.
    const bedsWithNewDraft = [
      { id: -1700000000000, name: 'Zeta', field: 10 } as Bed,
      ...beds,
    ];
    const ordered = applyHierarchyOrderSnapshot([], [], bedsWithNewDraft, snapshot);
    expect(ordered.beds.map((bed) => bed.id)).toEqual([-1700000000000, 21, 22]);
  });

  it('drops an id that no longer exists after a snapshot without erroring', () => {
    const snapshot = computeHierarchyOrderSnapshot(
      [],
      [],
      [{ id: 21, name: 'Beet A', field: 10 } as Bed, { id: 22, name: 'Beet B', field: 10 } as Bed],
      { field: 'name', direction: 'asc' },
    );

    const remainingBeds = [{ id: 22, name: 'Beet B', field: 10 } as Bed];
    const ordered = applyHierarchyOrderSnapshot([], [], remainingBeds, snapshot);
    expect(ordered.beds.map((bed) => bed.id)).toEqual([22]);
  });

  it('re-sorts to the current values when a fresh snapshot is taken (explicit sort / reload)', () => {
    const fields = [
      { id: 1, name: 'Zoo', location: 1, area_sqm: 100 } as Field,
      { id: 2, name: 'Feld', location: 1, area_sqm: 100 } as Field,
    ];
    const freshSnapshot = computeHierarchyOrderSnapshot([], fields, [], { field: 'name', direction: 'asc' });
    const ordered = applyHierarchyOrderSnapshot([], fields, [], freshSnapshot);
    expect(ordered.fields.map((field) => field.name)).toEqual(['Feld', 'Zoo']);
  });

  it('preserves per-parent grouping order when reordering fields across multiple locations', () => {
    const fields = [
      { id: 1, name: 'Nord', location: 1, area_sqm: 100 } as Field,
      { id: 2, name: 'Sued', location: 2, area_sqm: 100 } as Field,
      { id: 3, name: 'Ost', location: 1, area_sqm: 100 } as Field,
    ];
    const snapshot = computeHierarchyOrderSnapshot([], fields, [], { field: 'name', direction: 'asc' });
    // Global alpha order: Nord(1), Ost(3), Sued(2)
    expect(snapshot.fieldOrder).toEqual([1, 3, 2]);

    const ordered = applyHierarchyOrderSnapshot([], fields, [], snapshot);
    const location1Fields = ordered.fields.filter((field) => field.location === 1).map((f) => f.id);
    expect(location1Fields).toEqual([1, 3]);
  });
});

describe('natural name order', () => {
  const beds = ['E 10', 'E 2', 'E 1 10', 'E 1 9', 'e 3'].map((name, index) => ({ id: index + 1, name, field: 10 } as Bed));
  const names = (ids: number[]): string[] => ids.map((id) => beds.find((bed) => bed.id === id)!.name);

  it('is the default order without an explicit sort', () => {
    const snapshot = computeHierarchyOrderSnapshot([], [], beds);
    expect(names(snapshot.bedOrder)).toEqual(['E 1 9', 'E 1 10', 'E 2', 'e 3', 'E 10']);
  });

  it('applies to the name column sort in both directions', () => {
    const descending = computeHierarchyOrderSnapshot([], [], beds, { field: 'name', direction: 'desc' });
    expect(names(descending.bedOrder)).toEqual(['E 10', 'e 3', 'E 2', 'E 1 10', 'E 1 9']);

    const fields = [{ id: 1, name: 'Feld 10', location: 1 }, { id: 2, name: 'Feld 9', location: 1 }] as Field[];
    const index = buildHierarchyIndex([], fields, [], { field: 'name', direction: 'asc' });
    expect(index.fieldsByLocation.get(1)!.map((field) => field.name)).toEqual(['Feld 9', 'Feld 10']);
  });
});

describe('placeDuplicatedFieldInSnapshot', () => {
  it('puts the copy right below its source and its beds in natural order', () => {
    const snapshot = { locationOrder: [1], fieldOrder: [3, 1, 2], bedOrder: [10] };
    const created = { id: 7, name: 'Nord 2', location: 1 } as Field;
    const createdBeds = [{ id: 31, name: 'B 10', field: 7 }, { id: 30, name: 'B 2', field: 7 }] as Bed[];

    expect(placeDuplicatedFieldInSnapshot(snapshot, 1, created, createdBeds)).toEqual({
      locationOrder: [1], fieldOrder: [3, 1, 7, 2], bedOrder: [10, 30, 31],
    });
  });

  it('leaves the snapshot alone when the source is not in it', () => {
    const snapshot = { locationOrder: [], fieldOrder: [], bedOrder: [] };
    expect(placeDuplicatedFieldInSnapshot(snapshot, 1, { id: 7, name: 'x', location: 1 } as Field, [])).toBe(snapshot);
  });
});
