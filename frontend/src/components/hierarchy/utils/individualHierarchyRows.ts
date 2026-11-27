import type { Bed, Field, IndividualPlantPlanSummary } from '../../../api/types';
import { planPlacementParent } from '../../../pages/individualPlantGeometry';
import { compareHierarchyNames, type HierarchySortConfig } from './hierarchyUtils';
import type { HierarchyRow } from './types';

export const INDIVIDUAL_PLANT_COUNT_FIELD = 'individualPlantCount';

export interface IndividualHierarchyRow extends HierarchyRow {
  type: 'individualPlan';
  id: string;
  parentId: string | number;
  fieldId?: number;
  locationId: number;
  name: string;
  plantingPlanId: number;
  individualPlantCount: number;
}

interface PlantRows {
  rows: readonly IndividualHierarchyRow[];
  children: ReadonlyMap<HierarchyRow['id'], readonly IndividualHierarchyRow[]>;
  counts: ReadonlyMap<HierarchyRow['id'], number>;
}

export const EMPTY_INDIVIDUAL_HIERARCHY: PlantRows = { rows: [], children: new Map(), counts: new Map() };

/** Project one row per plan, and count each plan once on its actual ancestor chain. */
export function indexIndividualHierarchy(
  plans: readonly IndividualPlantPlanSummary[], fields: readonly Field[], beds: readonly Bed[], showsLocations: boolean,
): PlantRows {
  if (plans.length === 0) return EMPTY_INDIVIDUAL_HIERARCHY;
  const fieldById = new Map(fields.map(field => [field.id, field]));
  const bedById = new Map(beds.map(bed => [bed.id, bed]));
  const rows: IndividualHierarchyRow[] = [];
  const children = new Map<HierarchyRow['id'], IndividualHierarchyRow[]>();
  const counts = new Map<HierarchyRow['id'], number>();
  const seen = new Set<number>();
  for (const plan of plans) {
    const parent = planPlacementParent(plan);
    if (!plan.id || !parent || seen.has(plan.id)) continue;
    const bed = parent.kind === 'bed' ? bedById.get(parent.id) : undefined;
    const field = parent.kind === 'location' ? undefined : fieldById.get(parent.kind === 'bed' ? bed?.field : parent.id);
    const locationId = parent.kind === 'location' ? parent.id : field?.location;
    if (locationId === undefined || (parent.kind === 'bed' && !bed)) continue;
    const locationRowId = `location-${locationId}`;
    const fieldRowId = field?.id === undefined ? null : `field-${field.id}`;
    const parentId = bed?.id ?? fieldRowId ?? locationRowId;
    const count = plan.plants_count;
    const crop = plan.crop_display_name || plan.crop_name || '';
    const row: IndividualHierarchyRow = {
      id: `individual-plan-${plan.id}`, type: 'individualPlan', parentId,
      level: (showsLocations ? 1 : 0) + (field ? 1 : 0) + (bed ? 1 : 0),
      locationId, fieldId: field?.id, plantingPlanId: plan.id,
      name: plan.crop_variety ? `${crop} (${plan.crop_variety})` : crop,
      individualPlantCount: count,
      individualPendingCount: plan.pending_plants_count ?? 0,
    };
    seen.add(plan.id);
    rows.push(row);
    const group = children.get(parentId) ?? [];
    group.push(row);
    children.set(parentId, group);
    for (const ancestor of [locationRowId, ...(fieldRowId ? [fieldRowId] : []), ...(bed?.id !== undefined ? [bed.id] : [])]) {
      counts.set(ancestor, (counts.get(ancestor) ?? 0) + count);
    }
  }
  return { rows, children, counts };
}

export function projectIndividualHierarchyRows(
  rows: HierarchyRow[], individual: PlantRows, expanded: ReadonlySet<HierarchyRow['id']>, sort?: HierarchySortConfig,
): HierarchyRow[] {
  if (!individual.rows.length) return rows;
  const direction = sort?.field === 'name' && sort.direction === 'desc' ? -1 : 1;
  const result: HierarchyRow[] = [];
  for (const row of rows) {
    const count = individual.counts.get(row.id);
    const children = individual.children.get(row.id);
    const isOpen = expanded.has(row.id);
    result.push(count === undefined ? row : {
      ...row, individualPlantCount: count,
      ...(children ? { hasChildren: true, expanded: isOpen } : {}),
    });
    if (children && isOpen) result.push(...[...children].sort((left, right) => (
      direction * compareHierarchyNames(left.name, right.name) || left.plantingPlanId - right.plantingPlanId
    )));
  }
  return result;
}
