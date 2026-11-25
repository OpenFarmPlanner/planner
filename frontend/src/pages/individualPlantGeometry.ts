import type { Field, StemCoordinates } from '../api/types';
import { rotateRectBetweenSizes, type GraphicalRotation, type Position, type Rect } from './graphicalLayoutUtils';

export function parcelMeters(field: Pick<Field, 'width_m' | 'length_m'>) {
  const width = field.width_m ?? 0;
  const height = field.length_m ?? 0;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : null;
}

export function stemToCanvas(
  stem: StemCoordinates, field: Field, surface: Rect, rotation: GraphicalRotation,
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
  point: Position, field: Field, surface: Rect, rotation: GraphicalRotation,
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
  const result = { pairs: 0, closest: null as number | null };
  if (!recommended) return result;
  stems.forEach((stem, index) => {
    for (let previous = 0; previous < index; previous += 1) {
      const peer = stems[previous];
      const distance = Math.hypot(stem.x_m - peer.x_m, stem.y_m - peer.y_m);
      if (distance < recommended) {
        result.pairs += 1;
        result.closest = Math.min(result.closest ?? distance, distance);
      }
    }
  });
  return result;
}
