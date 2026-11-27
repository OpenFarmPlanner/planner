import { FIELD_WORLD_PX_PER_METER, SNAP_THRESHOLD } from './graphicalFieldsGeometry';
import type { Position } from './graphicalLayoutUtils';

export interface PlantSpacingNeighbor {
  key: string;
  point: Position;
}

export interface PlantDistanceGuide {
  neighbor: Position;
  stem: Position;
  meters: number;
  snapped: boolean;
}

interface PlantSnapOptions {
  neighbors: readonly PlantSpacingNeighbor[];
  spacingMeters: number | null | undefined;
  zoom: number;
  previousKey?: string | null;
  bypass?: boolean;
  accepts: (point: Position) => boolean;
}

export interface PlantSnapResult {
  point: Position;
  target: string | null;
  guide: PlantDistanceGuide | null;
}

interface Candidate {
  neighbor: PlantSpacingNeighbor;
  point: Position;
  differencePx: number;
  distance: number;
}

const RELEASE_THRESHOLD = SNAP_THRESHOLD * 1.5;

function closer(a: Candidate, b: Candidate | undefined): boolean {
  return !b || a.differencePx < b.differencePx
    || (a.differencePx === b.differencePx && a.neighbor.key < b.neighbor.key);
}

export function snapIndividualStem(raw: Position, {
  neighbors, spacingMeters, zoom, previousKey, bypass, accepts,
}: PlantSnapOptions): PlantSnapResult {
  const empty = { point: raw, target: null, guide: null };
  if (!spacingMeters || !Number.isFinite(spacingMeters) || spacingMeters <= 0 || zoom <= 0) return empty;
  const radius = spacingMeters * FIELD_WORLD_PX_PER_METER;
  let held: Candidate | undefined;
  let best: Candidate | undefined;
  let nearby: Candidate | undefined;
  for (const neighbor of neighbors) {
    const dx = raw.x - neighbor.point.x;
    const dy = raw.y - neighbor.point.y;
    const distance = Math.hypot(dx, dy);
    const differencePx = Math.abs(distance - radius) * zoom;
    if (!distance || differencePx > RELEASE_THRESHOLD) continue;
    const candidate: Candidate = {
      neighbor, point: { x: neighbor.point.x + dx / distance * radius, y: neighbor.point.y + dy / distance * radius },
      distance, differencePx,
    };
    if (closer(candidate, nearby)) nearby = candidate;
    if (bypass) continue;
    if (neighbor.key === previousKey) {
      if (accepts(candidate.point)) held = candidate;
    } else if (differencePx <= SNAP_THRESHOLD && closer(candidate, best) && accepts(candidate.point)) {
      best = candidate;
    }
  }
  const snapped = held ?? best;
  if (snapped) return {
    point: snapped.point, target: snapped.neighbor.key,
    guide: { neighbor: snapped.neighbor.point, stem: snapped.point, meters: spacingMeters, snapped: true },
  };
  return nearby ? {
    ...empty,
    guide: { neighbor: nearby.neighbor.point, stem: raw, meters: nearby.distance / FIELD_WORLD_PX_PER_METER, snapped: false },
  } : empty;
}
