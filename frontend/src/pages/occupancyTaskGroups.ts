import { collectVisibleIdsWithAncestors, flattenTreeRows } from '../components/hierarchy/utils/treeRows';
import { OCCUPANCY_COMPACT_ROW_HEIGHT } from './ganttChartState';
import type { GanttTaskGroup, OccupancyHierarchyNode } from './ganttChartUtils';
import {
  buildOccupancyStructureSummaries,
  formatOccupancyStructureSummary,
} from './occupancyStructureSummary';

/** Matches `formatOccupancyStructureSummary`'s translator shape. */
type OccupancyGroupTranslator = (key: string, options: { count: number }) => string;

export interface BuildOccupancyTaskGroupsOptions {
  nodes: OccupancyHierarchyNode[];
  /** Structural filter: drop empty beds and any now-childless ancestors. */
  onlyOccupiedBeds: boolean;
  searchText: string;
  locationFilter: number | 'all';
  fieldFilter: number | 'all';
  expandedIds: ReadonlySet<string | number>;
  t: OccupancyGroupTranslator;
}

/**
 * Builds the flat, expand-aware task-group rows the bed-occupancy calendar
 * renders, applying the structural "only occupied beds" pruning and the
 * location/field/search filters. Pure function of its options.
 */
export function buildOccupancyTaskGroups({
  nodes: occupancyHierarchyNodes,
  onlyOccupiedBeds,
  searchText: occupancySearchText,
  locationFilter: occupancyLocationFilter,
  fieldFilter: occupancyFieldFilter,
  expandedIds: expandedHierarchyIds,
  t,
}: BuildOccupancyTaskGroupsOptions): GanttTaskGroup[] {
  // The empty-bed filter removes empty beds (and any
  // now-childless field/location ancestors) from the tree entirely,
  // independent of expand/collapse state.
  const structurallyVisibleIds = onlyOccupiedBeds
    ? collectVisibleIdsWithAncestors(
      occupancyHierarchyNodes,
      new Set(
        occupancyHierarchyNodes
          .filter((node) => node.type === 'individual' || (node.type === 'bed' && node.occupiedBedCount > 0))
          .map((node) => node.id),
      ),
    )
    : null;
  const prunedNodes = structurallyVisibleIds
    ? occupancyHierarchyNodes.filter((node) => structurallyVisibleIds.has(node.id))
    : occupancyHierarchyNodes;

  const fieldNameById = new Map<number, string>(
    prunedNodes
      .filter((node): node is OccupancyHierarchyNode & { fieldId: number } => node.type === 'field' && node.fieldId !== undefined)
      .map((node) => [node.fieldId, node.name]),
  );
  const locationNameById = new Map<number, string>(
    prunedNodes.filter((node) => node.type === 'location').map((node) => [node.locationId, node.name]),
  );

  const normalizedSearch = occupancySearchText.trim().toLowerCase();
  const isActivelyFiltering = Boolean(normalizedSearch)
    || occupancyLocationFilter !== 'all'
    || occupancyFieldFilter !== 'all';

  let visibleIds: Set<string | number> | null = null;
  if (isActivelyFiltering) {
    const matchedPlanGroupIds = new Set(
      prunedNodes
        .filter((node) => {
          if (node.type !== 'bed' && node.type !== 'individual') {
            return false;
          }
          if (occupancyLocationFilter !== 'all' && node.locationId !== occupancyLocationFilter) {
            return false;
          }
          if (occupancyFieldFilter !== 'all' && node.fieldId !== occupancyFieldFilter) {
            return false;
          }
          if (!normalizedSearch) {
            return true;
          }
          const haystack = [
            node.name,
            node.fieldId !== undefined ? fieldNameById.get(node.fieldId) : undefined,
            locationNameById.get(node.locationId),
            ...node.tasks.map((task) => task.cropName),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(normalizedSearch);
        })
        .map((node) => node.id),
    );
    visibleIds = collectVisibleIdsWithAncestors(prunedNodes, matchedPlanGroupIds);
  }

  // Summaries come from the filtered node set (structural "nur belegte
  // Beete" pruning plus the location/field/search match), so the grey
  // summary can never claim more beds than the view actually lists.
  // Expansion state is intentionally not folded in — collapsing a row
  // hides it, it does not remove it from the structure.
  const summarizedNodes = visibleIds
    ? prunedNodes.filter((node) => visibleIds.has(node.id))
    : prunedNodes;
  const structureSummaries = buildOccupancyStructureSummaries(summarizedNodes);

  const flatRows = flattenTreeRows(prunedNodes, {
    expandedIds: expandedHierarchyIds,
    visibleIds,
  });

  return flatRows.map(({ node, depth, hasChildren }) => {
    const isExpandable = node.type !== 'bed' && hasChildren;
    const isExpanded = expandedHierarchyIds.has(node.id);

    const structureSummary = structureSummaries.get(node.id);
    const emptyRowLabel = structureSummary
      ? formatOccupancyStructureSummary(structureSummary, t)
      : undefined;

    const group: GanttTaskGroup = {
      id: node.id,
      name: node.name,
      tasks: node.tasks,
      depth,
      isExpandable,
      isExpanded,
      // Standort/Parzelle rows carry no bars — their structural summary is
      // rendered in the timeline area instead (see TaskRow's
      // `emptyRowLabel` handling), not as a second line in the left column.
      emptyRowLabel,
      // Rows with their own bars keep the task-count-based height.
      rowHeightOverride: node.type === 'bed' || node.type === 'individual' ? undefined : OCCUPANCY_COMPACT_ROW_HEIGHT,
      locationId: node.locationId,
      fieldId: node.fieldId,
      bedId: node.bedId,
      area: node.area,
    };
    return group;
  });
}
