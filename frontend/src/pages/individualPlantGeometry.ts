import type { Field, IndividualPlacementParent, PlantingPlan, StemCoordinates } from '../api/types';
import { rotateRectBetweenSizes, type GraphicalRotation, type Position, type Rect } from './graphicalLayoutUtils';

export type PlacementDimensions = Pick<Field, 'width_m' | 'length_m'>;
export type PlacementParent = IndividualPlacementParent;

export function canRemoveIndividualStem(positioned: number, exactCount?: number | null) {
  return positioned > 1 || (exactCount ?? 0) > 0;
}

export const placementLabelKey = (kind: PlacementParent['kind']) => ({
  bed: 'fields:individualPlants.inBed', field: 'fields:individualPlants.onParcel', location: 'fields:individualPlants.atLocation',
} as const)[kind];

export function individualPlacementChoice(parent: PlacementParent): string {
  return `individual:${parent.kind}:${parent.id}`;
}

export function readIndividualPlacementChoice(value: string): PlacementParent | null {
  const match = /^individual:(bed|field|location):([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const id = Number(match[2]);
  return Number.isSafeInteger(id) ? { kind: match[1] as PlacementParent['kind'], id } : null;
}

export function isIndividualPlacement(plan: Pick<PlantingPlan, 'placement_mode' | 'parcel' | 'site'>): boolean {
  return plan.placement_mode === 'individual_bed' || plan.placement_mode === 'individual_site' || plan.parcel != null || plan.site != null;
}

export function planPlacementParent(plan: Pick<PlantingPlan, 'placement_mode' | 'bed' | 'parcel' | 'site'>): PlacementParent | null {
  if (plan.placement_mode === 'individual_bed' && plan.bed != null) return { kind: 'bed', id: plan.bed };
  if (plan.site != null) return { kind: 'location', id: plan.site };
  return plan.parcel == null ? null : { kind: 'field', id: plan.parcel };
}

export function placementParentFields(parent: PlacementParent): Pick<PlantingPlan, 'bed' | 'parcel' | 'site' | 'placement_mode'> {
  const mode = { bed: 'individual_bed', field: 'individual_parcel', location: 'individual_site' } as const;
  return { bed: parent.kind === 'bed' ? parent.id : null, parcel: parent.kind === 'field' ? parent.id : null,
    site: parent.kind === 'location' ? parent.id : null, placement_mode: mode[parent.kind] };
}

export function matchesPlacementParent(a: PlacementParent | null | undefined, b: PlacementParent) {
  return a?.kind === b.kind && a.id === b.id;
}

export function parcelMeters(field: PlacementDimensions) {
  const width = field.width_m ?? 0;
  const height = field.length_m ?? 0;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : null;
}

export function stemToCanvas(
  stem: StemCoordinates, field: PlacementDimensions, surface: Rect, rotation: GraphicalRotation,
): Position | null {
  const dimensions = parcelMeters(field);
  if (!dimensions) return null;
  const point = rotateRectBetweenSizes(
    { x: stem.x_m, y: stem.y_m, width: 0, height: 0 }, dimensions, surface, rotation,
  );
  return { x: point.x + surface.x, y: point.y + surface.y };
}

export function roundMeters(value: number): number {
  return Number(value.toFixed(2));
}

export function canvasToStem(
  point: Position, field: PlacementDimensions, surface: Rect, rotation: GraphicalRotation,
): StemCoordinates | null {
  const dimensions = parcelMeters(field);
  if (!dimensions || !surface.width || !surface.height) return null;
  const inverse = ((360 - rotation) % 360) as GraphicalRotation;
  const model = rotateRectBetweenSizes(
    { x: point.x - surface.x, y: point.y - surface.y, width: 0, height: 0 },
    surface, dimensions, inverse,
  );
  const limit = (value: number, max: number) => Math.min(Math.floor(max * 100) / 100, roundMeters(Math.max(0, value)));
  return { x_m: limit(model.x, dimensions.width), y_m: limit(model.y, dimensions.height) };
}

export function shortStemSpacing(stems: readonly StemCoordinates[], recommended: number | null) {
  if (!recommended) return { pairs: 0, closest: null };
  const threshold = recommended * recommended;
  let pairs = 0;
  let closestSquared = threshold;
  stems.forEach((stem, index) => {
    for (let previous = 0; previous < index; previous += 1) {
      const peer = stems[previous];
      const dx = stem.x_m - peer.x_m;
      const dy = stem.y_m - peer.y_m;
      const squared = dx * dx + dy * dy;
      if (squared < threshold) {
        pairs += 1;
        closestSquared = Math.min(closestSquared, squared);
      }
    }
  });
  return { pairs, closest: pairs > 0 ? Math.sqrt(closestSquared) : null };
}
