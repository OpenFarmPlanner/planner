import { describe, expect, it } from 'vitest';

import i18n from '../i18n/config';
import type { OccupancyHierarchyNode } from '../pages/ganttChartUtils';
import {
  buildOccupancyStructureSummaries,
  formatOccupancyStructureSummary,
} from '../pages/occupancyStructureSummary';

const location = (
  id: number,
  name: string,
): OccupancyHierarchyNode => ({
  id: `location-${id}`,
  parentId: null,
  type: 'location',
  name,
  locationId: id,
  tasks: [],
  // Deliberately wrong on purpose: the summary must be derived from the node
  // list it is given, never from these pre-computed full-tree totals.
  bedCount: 99,
  occupiedBedCount: 99,
  planCount: 99,
});

const field = (
  id: number,
  name: string,
  locationId: number,
): OccupancyHierarchyNode => ({
  id: `field-${id}`,
  parentId: `location-${locationId}`,
  type: 'field',
  name,
  locationId,
  fieldId: id,
  tasks: [],
  bedCount: 99,
  occupiedBedCount: 99,
  planCount: 99,
});

const bed = (
  id: number,
  name: string,
  locationId: number,
  fieldId: number,
  occupied: boolean,
): OccupancyHierarchyNode => ({
  id: `bed-${id}`,
  parentId: `field-${fieldId}`,
  type: 'bed',
  name,
  locationId,
  fieldId,
  bedId: id,
  tasks: [],
  bedCount: 1,
  occupiedBedCount: occupied ? 1 : 0,
  planCount: occupied ? 1 : 0,
});

/** Standort "Hof" with two Parzellen, six Beete, five of them occupied. */
const fullTree = (): OccupancyHierarchyNode[] => [
  location(1, 'Hof'),
  field(10, 'Nordfeld', 1),
  bed(100, 'Beet 1', 1, 10, true),
  bed(101, 'Beet 2', 1, 10, true),
  bed(102, 'Beet 3', 1, 10, false),
  field(11, 'Südfeld', 1),
  bed(110, 'Beet 4', 1, 11, true),
  bed(111, 'Beet 5', 1, 11, true),
  bed(112, 'Beet 6', 1, 11, true),
];

describe('buildOccupancyStructureSummaries', () => {
  it('counts Parzellen, Beete and occupied Beete per Standort and per Parzelle', () => {
    const summaries = buildOccupancyStructureSummaries(fullTree());

    expect(summaries.get('location-1')).toEqual({
      fieldCount: 2,
      bedCount: 6,
      occupiedBedCount: 5,
    });
    expect(summaries.get('field-10')).toEqual({ bedCount: 3, occupiedBedCount: 2 });
    expect(summaries.get('field-11')).toEqual({ bedCount: 3, occupiedBedCount: 3 });
  });

  it('emits no summary for Beet rows', () => {
    const summaries = buildOccupancyStructureSummaries(fullTree());

    expect(summaries.has('bed-100')).toBe(false);
  });

  it('derives the counts from the nodes it is given, not from the full-tree totals on them', () => {
    // What "Leere Beete ausblenden" leaves behind: the empty Beet 3 is gone, so the
    // Standort must report five beds, not the six the node still remembers.
    const pruned = fullTree().filter((node) => node.id !== 'bed-102');

    const summaries = buildOccupancyStructureSummaries(pruned);

    expect(summaries.get('location-1')).toEqual({
      fieldCount: 2,
      bedCount: 5,
      occupiedBedCount: 5,
    });
    expect(summaries.get('field-10')).toEqual({ bedCount: 2, occupiedBedCount: 2 });
  });

  it('reflects a search that leaves a single matching Beet in one branch', () => {
    const filtered = [
      location(1, 'Hof'),
      field(10, 'Nordfeld', 1),
      bed(100, 'Beet 1', 1, 10, true),
    ];

    const summaries = buildOccupancyStructureSummaries(filtered);

    expect(summaries.get('location-1')).toEqual({
      fieldCount: 1,
      bedCount: 1,
      occupiedBedCount: 1,
    });
  });

  it('reports zeros for a Standort without Parzellen', () => {
    const summaries = buildOccupancyStructureSummaries([location(2, 'Neuer Hof')]);

    expect(summaries.get('location-2')).toEqual({
      fieldCount: 0,
      bedCount: 0,
      occupiedBedCount: 0,
    });
  });

  it('reports zeros for a Parzelle without Beete and still counts it for its Standort', () => {
    const summaries = buildOccupancyStructureSummaries([
      location(1, 'Hof'),
      field(10, 'Leeres Feld', 1),
    ]);

    expect(summaries.get('field-10')).toEqual({ bedCount: 0, occupiedBedCount: 0 });
    expect(summaries.get('location-1')).toEqual({
      fieldCount: 1,
      bedCount: 0,
      occupiedBedCount: 0,
    });
  });

  it('reports a partially occupied structure without dropping the empty Beete', () => {
    const summaries = buildOccupancyStructureSummaries([
      location(1, 'Hof'),
      field(10, 'Nordfeld', 1),
      bed(100, 'Beet 1', 1, 10, true),
      bed(101, 'Beet 2', 1, 10, false),
      bed(102, 'Beet 3', 1, 10, false),
    ]);

    expect(summaries.get('field-10')).toEqual({ bedCount: 3, occupiedBedCount: 1 });
  });

  it('ignores orphaned nodes whose parent is not part of the given list', () => {
    const summaries = buildOccupancyStructureSummaries([
      location(1, 'Hof'),
      bed(100, 'Beet 1', 1, 99, true),
    ]);

    expect(summaries.get('location-1')).toEqual({
      fieldCount: 0,
      bedCount: 0,
      occupiedBedCount: 0,
    });
  });
});

describe('formatOccupancyStructureSummary', () => {
  const restoreGerman = async () => {
    await i18n.changeLanguage('de');
  };

  it('formats a Standort summary in German with correct plurals', async () => {
    await restoreGerman();
    const summaries = buildOccupancyStructureSummaries(fullTree());

    expect(formatOccupancyStructureSummary(summaries.get('location-1')!, i18n.t))
      .toBe('2 Parzellen · 6 Beete · 5 belegt');
  });

  it('formats a Parzelle summary in German without a Parzellen count', async () => {
    await restoreGerman();
    const summaries = buildOccupancyStructureSummaries(fullTree());

    expect(formatOccupancyStructureSummary(summaries.get('field-10')!, i18n.t))
      .toBe('3 Beete · 2 belegt');
  });

  it('uses German singular forms for single Parzellen, Beete and occupied Beete', async () => {
    await restoreGerman();
    const summaries = buildOccupancyStructureSummaries([
      location(1, 'Hof'),
      field(10, 'Nordfeld', 1),
      bed(100, 'Beet 1', 1, 10, true),
    ]);

    expect(formatOccupancyStructureSummary(summaries.get('location-1')!, i18n.t))
      .toBe('1 Parzelle · 1 Beet · 1 belegt');
  });

  it('formats zero counts with the plural forms', async () => {
    await restoreGerman();
    const summaries = buildOccupancyStructureSummaries([location(1, 'Hof')]);

    expect(formatOccupancyStructureSummary(summaries.get('location-1')!, i18n.t))
      .toBe('0 Parzellen · 0 Beete · 0 belegt');
  });

  it('formats the same summaries in English', async () => {
    await i18n.changeLanguage('en');
    try {
      const summaries = buildOccupancyStructureSummaries(fullTree());

      expect(formatOccupancyStructureSummary(summaries.get('location-1')!, i18n.t))
        .toBe('2 fields · 6 beds · 5 occupied');
      expect(formatOccupancyStructureSummary(summaries.get('field-10')!, i18n.t))
        .toBe('3 beds · 2 occupied');
    } finally {
      await restoreGerman();
    }
  });

  it('uses English singular forms for single counts', async () => {
    await i18n.changeLanguage('en');
    try {
      const summaries = buildOccupancyStructureSummaries([
        location(1, 'Hof'),
        field(10, 'Nordfeld', 1),
        bed(100, 'Beet 1', 1, 10, true),
      ]);

      expect(formatOccupancyStructureSummary(summaries.get('location-1')!, i18n.t))
        .toBe('1 field · 1 bed · 1 occupied');
    } finally {
      await restoreGerman();
    }
  });
});
