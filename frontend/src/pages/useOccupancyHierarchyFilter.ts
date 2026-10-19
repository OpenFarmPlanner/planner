import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bed, Crop, Field, Location, PlantingPlan } from '../api/api';
import { useExpandedState } from '../components/hierarchy/hooks/useExpandedState';
import { useHierarchyLevelToggle } from '../components/hierarchy/hooks/useHierarchyLevelToggle';
import { OCCUPANCY_TREE_AUTO_EXPAND_ALL_THRESHOLD } from './ganttChartState';
import { useTranslation } from '../i18n';
import { buildFieldOccupancyHierarchy, createGanttTaskLabels, type OccupancyHierarchyNode } from './ganttChartUtils';

interface UseOccupancyHierarchyFilterParams {
  locations: Location[];
  fields: Field[];
  beds: Bed[];
  plantingPlans: PlantingPlan[];
  crops: Crop[];
  activeProjectId: number | null;
}

/**
 * Occupancy (Standort/Parzelle/Beet) tree state for the Gantt calendar's
 * occupancy view: the location/field/"only occupied beds" filters, the
 * persisted expand/collapse state (with a one-time default expansion), the
 * level toggle, and the derived hierarchy nodes / field options / active
 * filter count. Search text stays in the page (it is shared with the seedling
 * view).
 */
export function useOccupancyHierarchyFilter({
  locations,
  fields,
  beds,
  plantingPlans,
  crops,
  activeProjectId,
}: UseOccupancyHierarchyFilterParams) {
  const { t } = useTranslation('ganttChart');
  const [occupancyLocationFilter, setOccupancyLocationFilter] = useState<number | 'all'>('all');
  const [occupancyFieldFilter, setOccupancyFieldFilter] = useState<number | 'all'>('all');
  const [onlyOccupiedBeds, setOnlyOccupiedBeds] = useState(true);

  const occupancyTreeStorageKey = activeProjectId
    ? `occupancyTree.${activeProjectId}`
    : 'occupancyTree';
  const {
    expandedRows: expandedHierarchyIds,
    hasPersistedState: hasPersistedHierarchyExpansion,
    toggleExpand: toggleHierarchyExpand,
    expandAll: expandAllHierarchy,
  } = useExpandedState(occupancyTreeStorageKey);
  const hasInitiallyExpandedHierarchyRef = useRef(false);

  const occupancyHierarchyNodes = useMemo<OccupancyHierarchyNode[]>(() => buildFieldOccupancyHierarchy({
    locations,
    fields,
    beds,
    plantingPlans,
    crops,
    labels: createGanttTaskLabels(t),
  }), [beds, crops, fields, locations, plantingPlans, t]);

  // Default expansion — once per project, until the user manually
  // expands/collapses something (which then persists via useExpandedState's
  // sessionStorage backing). For small farms (few locations/fields/beds
  // combined), fully expanding is more useful than hiding everything behind
  // a chevron. Once the tree grows past a size where that would get
  // unwieldy, fall back to locations-open/fields-collapsed so the view
  // stays scannable.
  useEffect(() => {
    if (
      !hasPersistedHierarchyExpansion
      && !hasInitiallyExpandedHierarchyRef.current
      && occupancyHierarchyNodes.length > 0
    ) {
      const canFullyExpand = occupancyHierarchyNodes.length <= OCCUPANCY_TREE_AUTO_EXPAND_ALL_THRESHOLD;
      const idsToExpand = occupancyHierarchyNodes
        .filter((node) => node.type === 'location' || (canFullyExpand && node.type === 'field'))
        .map((node) => node.id);
      expandAllHierarchy(idsToExpand);
      hasInitiallyExpandedHierarchyRef.current = true;
    }
  }, [expandAllHierarchy, hasPersistedHierarchyExpansion, occupancyHierarchyNodes]);

  const hierarchyLevelToggle = useHierarchyLevelToggle(
    occupancyHierarchyNodes,
    expandedHierarchyIds,
    expandAllHierarchy,
  );

  const occupancyFieldOptions = useMemo(
    () => (occupancyLocationFilter === 'all'
      ? []
      : occupancyHierarchyNodes.filter(
        (node) => node.type === 'field' && node.locationId === occupancyLocationFilter,
      )),
    [occupancyHierarchyNodes, occupancyLocationFilter],
  );
  const activeHierarchyFilterCount = [
    occupancyLocationFilter !== 'all',
    occupancyFieldFilter !== 'all',
    onlyOccupiedBeds,
  ].filter(Boolean).length;
  const resetOccupancyHierarchyFilters = useCallback(() => {
    setOccupancyLocationFilter('all');
    setOccupancyFieldFilter('all');
    setOnlyOccupiedBeds(false);
  }, []);

  return {
    occupancyHierarchyNodes,
    occupancyLocationFilter,
    setOccupancyLocationFilter,
    occupancyFieldFilter,
    setOccupancyFieldFilter,
    onlyOccupiedBeds,
    setOnlyOccupiedBeds,
    occupancyFieldOptions,
    activeHierarchyFilterCount,
    resetOccupancyHierarchyFilters,
    expandedHierarchyIds,
    toggleHierarchyExpand,
    hierarchyLevelToggle,
  };
}
