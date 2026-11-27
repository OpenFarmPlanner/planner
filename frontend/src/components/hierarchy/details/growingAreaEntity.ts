import type { Bed, EffectiveSiteConditions, Field, Location, PlantingPlan, Task } from '../../../api/types';
import { planPlacementParent, type PlacementParent } from '../../../pages/individualPlantGeometry';
import {
  buildSiteConditionChain,
  resolveEffectiveConditions,
  type SiteConditionChainNode,
} from '../utils/siteConditions';
import type { HierarchyEntityType } from './hierarchyDetailRoutes';

export const DETAIL_ROUTE_SEGMENTS: Record<string, HierarchyEntityType> = {
  locations: 'location',
  fields: 'field',
  beds: 'bed',
};

export type GrowingAreaEntity = Location | Field | Bed;

export interface ResolvedGrowingAreaEntity {
  type: HierarchyEntityType;
  entity: GrowingAreaEntity;
  location?: Location;
  field?: Field;
  bed?: Bed;
  chain: SiteConditionChainNode[];
  effective: EffectiveSiteConditions;
  inherited: EffectiveSiteConditions;
  /** Direct children: a location's fields or a field's beds. */
  children: Array<Field | Bed>;
  /** Every bed the entity covers, for its planting plans. */
  bedIds: Set<number>;
  fieldIds: Set<number>;
}

/** Finds a location, field or bed with its parents and children in the loaded hierarchy. */
export function resolveGrowingAreaEntity(
  type: HierarchyEntityType,
  id: number,
  data: { locations: Location[]; fields: Field[]; beds: Bed[] },
): ResolvedGrowingAreaEntity | null {
  const { locations, fields, beds } = data;
  let location: Location | undefined;
  let field: Field | undefined;
  let bed: Bed | undefined;
  if (type === 'bed') {
    bed = beds.find((item) => item.id === id);
    if (!bed) return null;
    field = fields.find((item) => item.id === bed!.field);
    location = field ? locations.find((item) => item.id === field!.location) : undefined;
  } else if (type === 'field') {
    field = fields.find((item) => item.id === id);
    if (!field) return null;
    location = locations.find((item) => item.id === field!.location);
  } else {
    location = locations.find((item) => item.id === id);
    if (!location) return null;
  }

  const entity = (bed ?? field ?? location) as GrowingAreaEntity;
  const chain = buildSiteConditionChain(
    type === 'bed' ? { bed, field, location } : type === 'field' ? { field, location } : { location },
  );
  const children: Array<Field | Bed> = type === 'location'
    ? fields.filter((item) => item.location === id && typeof item.id === 'number' && item.id > 0)
    : type === 'field'
      ? beds.filter((item) => item.field === id && typeof item.id === 'number' && item.id > 0)
      : [];
  const fieldIds = type === 'location'
    ? new Set(children.flatMap(item => item.id === undefined ? [] : [item.id]))
    : new Set(field?.id === undefined ? [] : [field.id]);
  const bedIds = new Set(
    type === 'bed'
      ? [id]
      : beds.filter((item) => fieldIds.has(item.field)).map((item) => item.id!).filter((bedId) => bedId > 0),
  );

  return {
    type,
    entity,
    location,
    field,
    bed,
    chain,
    effective: resolveEffectiveConditions(chain),
    inherited: resolveEffectiveConditions(chain.slice(1)),
    children,
    bedIds,
    fieldIds,
  };
}

export function growingAreaPlanTarget(plan: PlantingPlan): PlacementParent | null {
  return planPlacementParent(plan) ?? (plan.bed == null ? null : { kind: 'bed', id: plan.bed });
}

export function planBelongsToGrowingArea(plan: PlantingPlan, area: ResolvedGrowingAreaEntity): boolean {
  const target = growingAreaPlanTarget(plan);
  if (!target) return false;
  if (target.kind === 'bed') return area.bedIds.has(target.id);
  if (target.kind === 'field') return area.type !== 'bed' && area.fieldIds.has(target.id);
  return area.type === 'location' && area.entity.id === target.id;
}

export function tasksForGrowingArea(
  tasks: readonly Task[], planIds: ReadonlySet<number>, area: ResolvedGrowingAreaEntity,
): Task[] {
  const related = new Map<number, Task>();
  for (const task of tasks) {
    const matches = task.planting_plan != null ? planIds.has(task.planting_plan)
      : area.type !== 'bed' && task.field != null && area.fieldIds.has(task.field);
    if (matches) related.set(task.id, task);
  }
  return [...related.values()];
}
