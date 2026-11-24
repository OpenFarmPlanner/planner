/** Axis-aligned geometry in metres. Width runs along x and length along y. */
export interface MetricRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AreaFootprint {
  id: number;
  rect: MetricRect | null;
}

export type GeometryIssue =
  | { kind: 'outside'; id: number }
  | { kind: 'overlap'; ids: [number, number] }
  | { kind: 'shortGap'; ids: [number, number]; gapM: number; recommendedM: number }
  | { kind: 'noPathSpace' };

export interface MetricCoverage {
  grossArea: number | null;
  /** Union of footprints within the parent, or null when dimensions are incomplete. */
  footprintArea: number | null;
  remainingArea: number | null;
}

const METRIC_EPSILON = 1e-7;
const right = (rect: MetricRect): number => rect.x + rect.width;
const bottom = (rect: MetricRect): number => rect.y + rect.height;

export function intersectFootprints(a: MetricRect, b: MetricRect): MetricRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(right(a), right(b)) - x;
  const height = Math.min(bottom(a), bottom(b)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Union area by sweeping vertical edges and tracking covered y intervals. */
export function footprintUnionArea(rectangles: readonly MetricRect[]): number {
  const events = rectangles.flatMap(rect => [
    { x: rect.x, start: rect.y, end: bottom(rect), delta: 1 },
    { x: right(rect), start: rect.y, end: bottom(rect), delta: -1 },
  ]).sort((a, b) => a.x - b.x);
  if (events.length === 0) return 0;

  const coordinates = [...new Set(events.flatMap(event => [event.start, event.end]))].sort((a, b) => a - b);
  const index = new Map(coordinates.map((value, i) => [value, i]));
  const coverage = new Int32Array(coordinates.length - 1);
  let previousX = events[0].x;
  let coveredHeight = 0;
  let area = 0;

  for (const event of events) {
    area += (event.x - previousX) * coveredHeight;
    previousX = event.x;
    for (let i = index.get(event.start)!; i < index.get(event.end)!; i++) {
      const wasCovered = coverage[i] > 0;
      coverage[i] += event.delta;
      const isCovered = coverage[i] > 0;
      if (isCovered !== wasCovered) {
        coveredHeight += (isCovered ? 1 : -1) * (coordinates[i + 1] - coordinates[i]);
      }
    }
  }
  return Math.max(0, area);
}

export function calculateMetricCoverage(parent: MetricRect | null, footprints: readonly AreaFootprint[]): MetricCoverage {
  if (parent === null) return { grossArea: null, footprintArea: null, remainingArea: null };
  const grossArea = parent.width * parent.height;
  const clipped: MetricRect[] = [];
  for (const { rect } of footprints) {
    if (!rect) return { grossArea, footprintArea: null, remainingArea: null };
    const inside = intersectFootprints(parent, rect);
    if (inside) clipped.push(inside);
  }
  const footprintArea = Math.min(grossArea, footprintUnionArea(clipped));
  return { grossArea, footprintArea, remainingArea: Math.max(0, grossArea - footprintArea) };
}

function isOutside(rect: MetricRect, parent: MetricRect): boolean {
  return rect.x < parent.x - METRIC_EPSILON || rect.y < parent.y - METRIC_EPSILON
    || right(rect) > right(parent) + METRIC_EPSILON || bottom(rect) > bottom(parent) + METRIC_EPSILON;
}

/** Opposing edges form a path only where their perpendicular spans overlap. */
export function neighborGap(a: MetricRect, b: MetricRect): number | null {
  const gapX = Math.max(a.x - right(b), b.x - right(a));
  const gapY = Math.max(a.y - bottom(b), b.y - bottom(a));
  if (gapY < -METRIC_EPSILON && gapX >= -METRIC_EPSILON) return Math.max(0, gapX);
  if (gapX < -METRIC_EPSILON && gapY >= -METRIC_EPSILON) return Math.max(0, gapY);
  return null;
}

export function validateAreaGeometry(
  parent: MetricRect | null,
  footprints: readonly AreaFootprint[],
  recommendedM: number,
): { issues: GeometryIssue[]; coverage: MetricCoverage; uncertainIds: number[] } {
  const issues: GeometryIssue[] = [];
  const uncertainIds: number[] = [];
  const measured: { id: number; rect: MetricRect }[] = [];
  for (const { id, rect } of footprints) {
    if (!rect) {
      uncertainIds.push(id);
      continue;
    }
    measured.push({ id, rect });
    if (parent && isOutside(rect, parent)) issues.push({ kind: 'outside', id });
  }

  measured.sort((a, b) => a.rect.x - b.rect.x || a.id - b.id);
  for (let i = 0; i < measured.length; i++) {
    const a = measured[i];
    for (let j = i + 1; j < measured.length; j++) {
      const b = measured[j];
      if (b.rect.x > right(a.rect) + recommendedM + METRIC_EPSILON) break;
      const ids: [number, number] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      const intersection = intersectFootprints(a.rect, b.rect);
      if (intersection && intersection.width > METRIC_EPSILON && intersection.height > METRIC_EPSILON) {
        issues.push({ kind: 'overlap', ids });
        continue;
      }
      const gapM = neighborGap(a.rect, b.rect);
      if (gapM !== null && gapM + METRIC_EPSILON < recommendedM) {
        issues.push({ kind: 'shortGap', ids, gapM, recommendedM });
      }
    }
  }

  const coverage = calculateMetricCoverage(parent, footprints);
  if (recommendedM > 0 && coverage.grossArea && coverage.remainingArea !== null
      && coverage.remainingArea <= coverage.grossArea * METRIC_EPSILON) {
    issues.push({ kind: 'noPathSpace' });
  }
  return { issues, coverage, uncertainIds };
}
