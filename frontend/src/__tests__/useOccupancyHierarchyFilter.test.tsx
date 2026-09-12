import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OCCUPANCY_TREE_AUTO_EXPAND_ALL_THRESHOLD } from '../pages/ganttChartState';
import type { Location } from '../api/api';
import type { OccupancyHierarchyNode } from '../pages/ganttChartUtils';
import { useOccupancyHierarchyFilter } from '../pages/useOccupancyHierarchyFilter';

const { buildHierarchyMock } = vi.hoisted(() => ({ buildHierarchyMock: vi.fn() }));

// The builder has its own tests; mocking it here is what makes the node count
// controllable, which the auto-expand threshold turns on.
vi.mock('../pages/ganttChartUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pages/ganttChartUtils')>()),
  buildFieldOccupancyHierarchy: buildHierarchyMock,
}));

const EXPANDED_PREFIX = 'hierarchyExpanded.';

const node = (
  id: string,
  type: OccupancyHierarchyNode['type'],
  overrides: Partial<OccupancyHierarchyNode> = {},
): OccupancyHierarchyNode => ({
  id, type, level: 0, name: id, ...overrides,
} as OccupancyHierarchyNode);

/** One location holding two fields, each holding one bed. */
const SMALL_TREE: OccupancyHierarchyNode[] = [
  node('location-1', 'location'),
  node('field-1', 'field', { locationId: 1 }),
  node('bed-1', 'bed'),
  node('field-2', 'field', { locationId: 2 }),
  node('bed-2', 'bed'),
];

const bigTree = (): OccupancyHierarchyNode[] => Array.from(
  { length: OCCUPANCY_TREE_AUTO_EXPAND_ALL_THRESHOLD + 1 },
  (_unused, index) => node(
    `n-${index}`,
    index % 2 === 0 ? 'location' : 'field',
    { locationId: 1 },
  ),
);

// Stable references: the hierarchy is memoized on these, so fresh literals per
// render would invalidate the memo and make the "does not rebuild" test
// unable to fail.
const EMPTY_DATA = {
  locations: [], fields: [], beds: [], plantingPlans: [], crops: [],
} as const;

const setup = ({
  nodes = SMALL_TREE,
  activeProjectId = 1 as number | null,
}: { nodes?: OccupancyHierarchyNode[]; activeProjectId?: number | null } = {}) => {
  buildHierarchyMock.mockReturnValue(nodes);
  return renderHook(
    ({ locations }: { locations: Location[] }) => useOccupancyHierarchyFilter({
      ...EMPTY_DATA, locations, activeProjectId,
    }),
    { initialProps: { locations: EMPTY_DATA.locations as Location[] } },
  );
};

beforeEach(() => {
  window.sessionStorage.clear();
  buildHierarchyMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useOccupancyHierarchyFilter — filters', () => {
  it('starts unfiltered except for hiding empty beds', () => {
    const { result } = setup();
    expect(result.current.occupancyLocationFilter).toBe('all');
    expect(result.current.occupancyFieldFilter).toBe('all');
    expect(result.current.onlyOccupiedBeds).toBe(true);
  });

  it('counts the default occupied-beds filter as active', () => {
    // It is on by default but still narrows what the user sees, so the badge
    // has to say so.
    expect(setup().result.current.activeHierarchyFilterCount).toBe(1);
  });

  it('counts each filter that is narrowing the view', () => {
    const { result } = setup();

    act(() => result.current.setOccupancyLocationFilter(1));
    expect(result.current.activeHierarchyFilterCount).toBe(2);

    act(() => result.current.setOccupancyFieldFilter(1));
    expect(result.current.activeHierarchyFilterCount).toBe(3);

    act(() => result.current.setOnlyOccupiedBeds(false));
    expect(result.current.activeHierarchyFilterCount).toBe(2);
  });

  it('clears every filter on reset', () => {
    const { result } = setup();
    act(() => {
      result.current.setOccupancyLocationFilter(1);
      result.current.setOccupancyFieldFilter(1);
    });

    act(() => result.current.resetOccupancyHierarchyFilters());

    expect(result.current.occupancyLocationFilter).toBe('all');
    expect(result.current.occupancyFieldFilter).toBe('all');
    expect(result.current.activeHierarchyFilterCount).toBe(0);
  });

  it('resets the occupied-beds filter to off, not to the value it started at', () => {
    // Reset means "show me everything", so it turns the default off rather
    // than restoring it. Worth pinning because the two differ.
    const { result } = setup();
    expect(result.current.onlyOccupiedBeds).toBe(true);

    act(() => result.current.resetOccupancyHierarchyFilters());

    expect(result.current.onlyOccupiedBeds).toBe(false);
  });
});

describe('useOccupancyHierarchyFilter — field options', () => {
  it('offers no fields until a location is chosen', () => {
    // With every location shown, a flat field list would be ambiguous.
    //
    // Note that the `=== 'all'` early-out cannot change this result: no node's
    // `locationId` is the string 'all', so the filter below it finds nothing
    // either way. Removing the guard leaves this file green — it saves a scan
    // and states the intent, rather than producing the empty list.
    expect(setup().result.current.occupancyFieldOptions).toEqual([]);
  });

  it('offers only the chosen location’s fields', () => {
    const { result } = setup();

    act(() => result.current.setOccupancyLocationFilter(1));

    expect(result.current.occupancyFieldOptions.map((option) => option.id)).toEqual(['field-1']);
  });

  it('offers nothing for a location that has no fields', () => {
    const { result } = setup();

    act(() => result.current.setOccupancyLocationFilter(99));

    expect(result.current.occupancyFieldOptions).toEqual([]);
  });

  it('never offers a location or bed node as a field', () => {
    const { result } = setup({
      nodes: [node('location-1', 'location', { locationId: 1 }), node('bed-1', 'bed', { locationId: 1 })],
    });

    act(() => result.current.setOccupancyLocationFilter(1));

    expect(result.current.occupancyFieldOptions).toEqual([]);
  });
});

describe('useOccupancyHierarchyFilter — default expansion', () => {
  it('opens locations and fields for a small farm', () => {
    // Fully expanding is more useful than hiding everything behind a chevron
    // when there is little to hide.
    const { result } = setup();

    expect([...result.current.expandedHierarchyIds].sort())
      .toEqual(['field-1', 'field-2', 'location-1']);
  });

  it('opens only locations once the tree would get unwieldy', () => {
    const { result } = setup({ nodes: bigTree() });

    const expanded = [...result.current.expandedHierarchyIds];
    expect(expanded.length).toBeGreaterThan(0);
    expect(expanded.every((id) => String(id).startsWith('n-'))).toBe(true);
    // Every expanded id is a location; no field was opened.
    expect(expanded.every((id) => Number(String(id).slice(2)) % 2 === 0)).toBe(true);
  });

  it('expands at the threshold itself, not one node short of it', () => {
    const atThreshold = Array.from(
      { length: OCCUPANCY_TREE_AUTO_EXPAND_ALL_THRESHOLD },
      (_unused, index) => node(`n-${index}`, index === 0 ? 'location' : 'field', { locationId: 1 }),
    );

    const { result } = setup({ nodes: atThreshold });

    expect(result.current.expandedHierarchyIds.size).toBe(OCCUPANCY_TREE_AUTO_EXPAND_ALL_THRESHOLD);
  });

  it('leaves a tree the user has already arranged alone', () => {
    // Re-expanding on every visit would undo a collapse the user just made.
    window.sessionStorage.setItem(
      `${EXPANDED_PREFIX}occupancyTree.1`, JSON.stringify(['location-1']),
    );

    const { result } = setup();

    expect([...result.current.expandedHierarchyIds]).toEqual(['location-1']);
  });

  it('expands nothing while the tree is still empty', () => {
    // The hierarchy arrives after the data loads; expanding an empty tree
    // would burn the one-time default on nothing. The locations prop changes
    // with it, since that is what invalidates the memo in the real page.
    const { result, rerender } = setup({ nodes: [] });
    expect(result.current.expandedHierarchyIds.size).toBe(0);

    buildHierarchyMock.mockReturnValue(SMALL_TREE);
    rerender({ locations: [{ id: 1, name: 'Standort' } as Location] });

    expect(result.current.expandedHierarchyIds.size).toBe(3);
  });

  it('does not re-expand after the user collapses everything', () => {
    const { result, rerender } = setup();

    act(() => result.current.toggleHierarchyExpand('location-1'));
    act(() => result.current.toggleHierarchyExpand('field-1'));
    act(() => result.current.toggleHierarchyExpand('field-2'));
    rerender({ locations: [{ id: 1, name: 'Standort' } as Location] });

    expect(result.current.expandedHierarchyIds.size).toBe(0);
  });
});

describe('useOccupancyHierarchyFilter — storage key', () => {
  it('namespaces the tree per project', () => {
    // Two projects' trees must not share one collapse state.
    setup({ activeProjectId: 7 });

    expect(window.sessionStorage.getItem(`${EXPANDED_PREFIX}occupancyTree.7`)).not.toBeNull();
  });

  it('falls back to an unnamespaced key with no active project', () => {
    setup({ activeProjectId: null });

    expect(window.sessionStorage.getItem(`${EXPANDED_PREFIX}occupancyTree`)).not.toBeNull();
  });

  it('reads back the state stored for that project, not another', () => {
    window.sessionStorage.setItem(
      `${EXPANDED_PREFIX}occupancyTree.7`, JSON.stringify(['location-1']),
    );
    window.sessionStorage.setItem(
      `${EXPANDED_PREFIX}occupancyTree.8`, JSON.stringify(['field-1', 'field-2']),
    );

    expect([...setup({ activeProjectId: 7 }).result.current.expandedHierarchyIds])
      .toEqual(['location-1']);
  });
});

describe('useOccupancyHierarchyFilter — expansion controls', () => {
  it('toggles one row open and closed again', () => {
    const { result } = setup({ nodes: [] });

    act(() => result.current.toggleHierarchyExpand('location-1'));
    expect(result.current.expandedHierarchyIds.has('location-1')).toBe(true);

    act(() => result.current.toggleHierarchyExpand('location-1'));
    expect(result.current.expandedHierarchyIds.has('location-1')).toBe(false);
  });

  it('exposes the level toggle built from the same nodes', () => {
    const { result } = setup();
    expect(result.current.hierarchyLevelToggle).toMatchObject({
      expandOneLevel: expect.any(Function),
      collapseOneLevel: expect.any(Function),
    });
  });
});

describe('useOccupancyHierarchyFilter — hierarchy nodes', () => {
  it('returns what the builder produced', () => {
    expect(setup().result.current.occupancyHierarchyNodes).toEqual(SMALL_TREE);
  });

  it('does not rebuild the tree when only a filter changes', () => {
    // The tree is memoized on the data, so filtering must not cost a rebuild.
    const { result } = setup();
    const callsAfterMount = buildHierarchyMock.mock.calls.length;

    act(() => result.current.setOccupancyLocationFilter(1));

    expect(buildHierarchyMock.mock.calls.length).toBe(callsAfterMount);
  });
});
