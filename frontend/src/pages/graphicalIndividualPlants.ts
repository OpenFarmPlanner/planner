import type { PlantingPlan, Season } from '../api/types';
import { cultivationPlan, projectBedCultivation, type BedCultivationEntry, type CropReference } from './graphicalCultivation';
import { planPlacementParent, stemToCanvas, type PlacementDimensions, type PlacementParent } from './individualPlantGeometry';
import type { GraphicalRotation, Rect } from './graphicalLayoutUtils';
import { graphicalObjectKey } from './useGraphicalObjectInteraction';
import type { ViewportState } from './graphicalViewport';

type SavedPlan = PlantingPlan & { id: number };

export interface IndividualPlanProjection {
  plan: SavedPlan;
  parent: PlacementParent;
  crop: BedCultivationEntry;
  cropProjected: boolean;
}

export function projectIndividualPlants(
  plans: readonly PlantingPlan[], reference: CropReference | undefined,
  season: Pick<Season, 'start_date' | 'end_date'> | undefined, focusedPlan: number | null,
  taskPlans?: ReadonlyMap<number, unknown>,
) {
  const byParent = new Map<string, IndividualPlanProjection[]>();
  for (const source of plans) {
    const parent = planPlacementParent(source);
    if (source.id === undefined || !parent) continue;
    const plan = { ...source, id: source.id };
    const cultivation = cultivationPlan(plan);
    const crop = reference && season ? projectBedCultivation([cultivation], reference, season)[0] : undefined;
    // Task targets and an active editing draft keep their marker even when the
    // crop window excludes the plan. They receive no crop phase or date label.
    if (reference && season && !crop && plan.id !== focusedPlan && !taskPlans?.has(plan.id)) continue;
    const item = { plan, parent, cropProjected: Boolean(crop),
      crop: crop ?? { plan: cultivation, phase: null, recordedHarvest: false } };
    const key = graphicalObjectKey(parent.kind, parent.id);
    const existing = byParent.get(key);
    if (existing) existing.push(item);
    else byParent.set(key, [item]);
  }
  return byParent;
}

export const individualPlantObjectKey = (stemId: string) => `plant:${stemId}`;

export interface GraphicalIndividualPlant extends IndividualPlanProjection {
  type: 'plant';
  key: string;
  stemId: string;
  index: number;
  count: number;
  id: number;
  name: string;
  phase: string | null;
  rect: Rect;
}

export function placeIndividualPlantObjects(
  projection: IndividualPlanProjection, dimensions: PlacementDimensions, surface: Rect, rotation: GraphicalRotation,
  name: string, phase: string | null,
): GraphicalIndividualPlant[] {
  const positions = projection.plan.individual_positions ?? [];
  return positions.flatMap((stem, index) => {
    const point = stemToCanvas(stem, dimensions, surface, rotation);
    if (!point) return [];
    return [{ ...projection, id: projection.plan.id, key: individualPlantObjectKey(stem.id), stemId: stem.id,
      type: 'plant', name, phase, index: index + 1, count: positions.length, rect: { ...point, width: 0, height: 0 } }];
  });
}

interface PlantLabel {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height;
const toScreen = (rect: Rect, { x, y, scale }: ViewportState): Rect => ({
  x: x + rect.x * scale, y: y + rect.y * scale, width: rect.width * scale, height: rect.height * scale,
});

export function getIndividualPlantLabels(
  plants: readonly GraphicalIndividualPlant[], beds: readonly Rect[], viewport: ViewportState,
  size: { width: number; height: number }, measure: (text: string) => number,
) {
  const labels = new Map<string, PlantLabel>();
  const inset = 8;
  const right = size.width - (size.width < 650 ? 58 : 116);
  const cellSize = 24;
  const markerRadius = 8;
  const markers = new Map<string, Rect[]>();
  const points = plants.map(plant => ({ plant, point: toScreen(plant.rect, viewport) }));
  for (const { point } of points) {
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const bounds = { x: point.x - markerRadius, y: point.y - markerRadius,
      width: 2 * markerRadius, height: 2 * markerRadius };
    const cell = markers.get(key);
    if (cell) cell.push(bounds);
    else markers.set(key, [bounds]);
  }
  const occupied = beds.map(rect => {
    const screen = toScreen(rect, viewport);
    return { ...screen, height: Math.min(screen.height, screen.width < 64 ? screen.height : 45) };
  });
  const coversMarker = (rect: Rect) => {
    const { x, y, width, height } = rect;
    const firstX = Math.floor((x - markerRadius) / cellSize);
    const lastX = Math.floor((x + width + markerRadius) / cellSize);
    const firstY = Math.floor((y - markerRadius) / cellSize);
    const lastY = Math.floor((y + height + markerRadius) / cellSize);
    for (let column = firstX; column <= lastX; column += 1) {
      for (let row = firstY; row <= lastY; row += 1) {
        if (markers.get(`${column}:${row}`)?.some(marker => overlaps(marker, rect))) return true;
      }
    }
    return false;
  };
  const measuredPlans = new Map<number, number>();
  for (const { plant, point } of points) {
    if (labels.size >= 36) break;
    if (point.x < inset || point.x >= right || point.y < inset || point.y >= size.height - inset) continue;
    const remembered = measuredPlans.get(plant.id);
    const width = remembered ?? Math.min(185, Math.ceil(Math.max(measure(plant.name), measure(plant.phase ?? ''))) + 10);
    measuredPlans.set(plant.id, width);
    const height = plant.phase ? 31 : 17;
    const top = point.y - height / 2;
    const choices = [point.x + 18, point.x - 18 - width];
    for (const x of choices) {
      const rect = { x, y: top, width, height };
      if (x < inset || x + width > right || top < inset || top + height > size.height - inset) continue;
      if (occupied.some(area => overlaps(area, rect)) || coversMarker(rect)) continue;
      labels.set(plant.stemId, { ...rect, x: x - point.x, y: top - point.y });
      occupied.push({ ...rect, x: rect.x - 2, y: rect.y - 2, width: width + 4, height: height + 4 });
      break;
    }
  }
  return labels;
}
