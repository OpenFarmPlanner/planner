import type { MetricRect } from './growingAreaGeometry';

export interface PlacementObstacle {
  rect: MetricRect;
  /** Additional clearance when an existing schematic position is inferred. */
  clearanceX?: number;
  clearanceY?: number;
}

const epsilon = 1e-7;

/** Place equal rectangles in regular rows, skipping occupied space without moving it. */
export function placeRegularBeds(
  bounds: Pick<MetricRect, 'width' | 'height'>,
  size: Pick<MetricRect, 'width' | 'height'>,
  count: number,
  gap: number,
  obstacles: readonly PlacementObstacle[],
  acrossParcel: boolean,
): { rectangles: MetricRect[]; insideCount: number } {
  const orient = (rect: MetricRect): MetricRect => acrossParcel
    ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width } : rect;
  const { width, height } = orient({ x: 0, y: 0, ...bounds });
  const bed = orient({ x: 0, y: 0, ...size });
  const blocked = obstacles.map(({ rect, clearanceX = 0, clearanceY = 0 }) => {
    const gapX = Math.max(gap, clearanceX);
    const gapY = Math.max(gap, clearanceY);
    return orient({ x: rect.x - gapX, y: rect.y - gapY,
      width: rect.width + 2 * gapX, height: rect.height + 2 * gapY });
  });
  const rectangles: MetricRect[] = [];

  let y = 0;
  while (rectangles.length < count && bed.width <= width + epsilon && y + bed.height <= height + epsilon) {
    const row = blocked.filter(rect => rect.y < y + bed.height - epsilon && rect.y + rect.height > y + epsilon);
    const previousCount = rectangles.length;
    let x = 0;
    while (rectangles.length < count && x + bed.width <= width + epsilon) {
      const collisionEnd = row.reduce((end, rect) => (
        rect.x < x + bed.width - epsilon && rect.x + rect.width > x + epsilon
          ? Math.max(end, rect.x + rect.width) : end
      ), x);
      if (collisionEnd > x) {
        x = collisionEnd;
      } else {
        rectangles.push(orient({ ...bed, x, y }));
        x += bed.width + gap;
      }
    }
    // If a row was fully blocked, skip directly to the nearest obstacle edge.
    y = rectangles.length > previousCount || row.length === 0
      ? y + bed.height + gap
      : Math.min(...row.map(rect => rect.y + rect.height));
  }

  const insideCount = rectangles.length;
  if (insideCount < count) {
    // Display any excess past the parcel edge, clear of existing beds and the last row.
    y = blocked.reduce((end, rect) => Math.max(end, rect.y + rect.height), Math.max(height + gap, y));
    let x = 0;
    while (rectangles.length < count) {
      rectangles.push(orient({ ...bed, x, y }));
      x += bed.width + gap;
      if (x + bed.width > width + epsilon) {
        x = 0;
        y += bed.height + gap;
      }
    }
  }
  return { rectangles, insideCount };
}
