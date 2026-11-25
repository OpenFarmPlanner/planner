import { describe, expect, it } from 'vitest';
import { buildOccupancyTaskGroups } from '../pages/occupancyTaskGroups';
import type { GanttTask, OccupancyHierarchyNode } from '../pages/ganttChartUtils';

const t = (key: string, options: { count: number }): string => `${key}:${options.count}`;

function task(id: string, cropName: string): GanttTask {
  return {
    id,
    name: cropName,
    startDate: new Date(2026, 3, 1),
    endDate: new Date(2026, 4, 1),
    cropName,
  };
}

/** Location "Hof" > Field "Acker" > beds "Beet 1" (occupied) and "Beet 2" (empty). */
function buildNodes(): OccupancyHierarchyNode[] {
  return [
    {
      id: 'location-1',
      parentId: null,
      type: 'location',
      name: 'Hof',
      locationId: 1,
      tasks: [],
      bedCount: 2,
      occupiedBedCount: 1,
      planCount: 1,
    },
    {
      id: 'field-1',
      parentId: 'location-1',
      type: 'field',
      name: 'Acker',
      locationId: 1,
      fieldId: 10,
      tasks: [],
      bedCount: 2,
      occupiedBedCount: 1,
      planCount: 1,
    },
    {
      id: 'bed-1',
      parentId: 'field-1',
      type: 'bed',
      name: 'Beet 1',
      locationId: 1,
      fieldId: 10,
      bedId: 100,
      tasks: [task('t1', 'Tomate')],
      bedCount: 1,
      occupiedBedCount: 1,
      planCount: 1,
    },
    {
      id: 'bed-2',
      parentId: 'field-1',
      type: 'bed',
      name: 'Beet 2',
      locationId: 1,
      fieldId: 10,
      bedId: 101,
      tasks: [],
      bedCount: 1,
      occupiedBedCount: 0,
      planCount: 0,
    },
  ];
}

const expandedIds = new Set<string | number>(['location-1', 'field-1']);

const baseOptions = {
  nodes: buildNodes(),
  onlyOccupiedBeds: false,
  searchText: '',
  locationFilter: 'all' as const,
  fieldFilter: 'all' as const,
  expandedIds,
  t,
};

describe('buildOccupancyTaskGroups', () => {
  it('flattens the expanded tree into location, field and bed rows', () => {
    const groups = buildOccupancyTaskGroups(baseOptions);

    expect(groups.map((group) => group.id)).toEqual(['location-1', 'field-1', 'bed-1', 'bed-2']);
    expect(groups[0].depth).toBe(0);
    expect(groups[2].depth).toBe(2);
  });

  it('marks non-bed rows expandable and gives them a compact row height', () => {
    const groups = buildOccupancyTaskGroups(baseOptions);

    expect(groups[0].isExpandable).toBe(true);
    expect(groups[0].isExpanded).toBe(true);
    expect(groups[0].rowHeightOverride).toBeGreaterThan(0);
    // Bed rows keep the default, task-count-based height.
    expect(groups[2].isExpandable).toBe(false);
    expect(groups[2].rowHeightOverride).toBeUndefined();
  });

  it('drops empty beds and keeps their ancestors when only occupied beds are shown', () => {
    const groups = buildOccupancyTaskGroups({ ...baseOptions, onlyOccupiedBeds: true });

    expect(groups.map((group) => group.id)).toEqual(['location-1', 'field-1', 'bed-1']);
  });

  it('filters beds by crop name search while keeping the ancestor rows', () => {
    const groups = buildOccupancyTaskGroups({ ...baseOptions, searchText: 'tomate' });

    expect(groups.map((group) => group.id)).toEqual(['location-1', 'field-1', 'bed-1']);
  });

  it('keeps individual plants searchable while empty beds are hidden', () => {
    const nodes: OccupancyHierarchyNode[] = [...buildNodes(), {
      id: 'individual-10', parentId: 'field-1', type: 'individual', name: 'Einzelpflanzen',
      locationId: 1, fieldId: 10, bedCount: 0, occupiedBedCount: 0, planCount: 1,
      tasks: [task('orchard', 'Apfel')],
    }];
    const groups = buildOccupancyTaskGroups({
      ...baseOptions, nodes, searchText: 'apfel', onlyOccupiedBeds: true, fieldFilter: 10,
    });
    expect(groups.map(group => group.id)).toEqual(['location-1', 'field-1', 'individual-10']);
    expect(groups[2].rowHeightOverride).toBeUndefined();
    expect(groups[2].bedId).toBeUndefined();
  });

  it('returns no rows when the search matches nothing', () => {
    expect(buildOccupancyTaskGroups({ ...baseOptions, searchText: 'kohlrabi' })).toEqual([]);
  });

  it('collapses child rows away when an ancestor is not expanded', () => {
    const groups = buildOccupancyTaskGroups({
      ...baseOptions,
      expandedIds: new Set<string | number>(['location-1']),
    });

    expect(groups.map((group) => group.id)).toEqual(['location-1', 'field-1']);
  });
});
