import type { Field, PlantingPlan, StemCoordinates } from '../api/types';
import { rotateRectBetweenSizes, type GraphicalRotation, type Position, type Rect } from './graphicalLayoutUtils';

export type PlacementDimensions = Pick<Field, 'width_m' | 'length_m'>;
export type PlacementParent = { kind: 'field' | 'bed'; id: number };

export function isIndividualPlacement(plan: Pick<PlantingPlan, 'placement_mode' | 'parcel'>): boolean {
  return plan.placement_mode === 'individual_bed' || plan.parcel != null;
}

export function planPlacementParent(plan: PlantingPlan): PlacementParent | null {
  if (plan.placement_mode === 'individual_bed' && plan.bed != null) return { kind: 'bed', id: plan.bed };
  return plan.parcel == null ? null : { kind: 'field', id: plan.parcel };
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
