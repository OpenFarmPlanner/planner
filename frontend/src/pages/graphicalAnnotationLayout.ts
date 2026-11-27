import { rectsOverlap, type Position, type Rect, type RectSize } from './graphicalLayoutUtils';

export interface AreaAnnotationSubject {
  key: string;
  testId: string;
  kind: 'location' | 'field';
  text: string;
  textWidth: number;
  footprint: Rect;
  gaps: readonly Rect[];
}

export interface AreaAnnotationObstacle {
  rect: Rect;
  /** A parcel's label may sit inside that parcel, provided its contents are clear. */
  owner?: string;
}

export interface AreaAnnotation {
  subject: AreaAnnotationSubject;
  rect: Rect;
  placement: 'inside' | 'gap' | 'outside';
  leader?: [Position, Position];
}

const CELL_SIZE = 64;
const LABEL_HEIGHT = 20;
const LABEL_INSET = 6;
const LEADER_LENGTH = 9;
const CLEARANCE = 2;

function containsRect(container: Rect, item: Rect, margin = 0): boolean {
  return item.x >= container.x + margin && item.y >= container.y + margin
    && item.x + item.width <= container.x + container.width - margin
    && item.y + item.height <= container.y + container.height - margin;
}

function clipRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function collisionIndex(view: Rect) {
  const cells = new Map<string, AreaAnnotationObstacle[]>();
  const large: AreaAnnotationObstacle[] = [];
  const cellsFor = (rect: Rect, padding = 0) => {
    const bounds = clipRect(view, {
      x: rect.x - padding, y: rect.y - padding, width: rect.width + 2 * padding, height: rect.height + 2 * padding,
    });
    if (!bounds) return [];
    const indices: string[] = [];
    for (let column = Math.floor(bounds.x / CELL_SIZE); column <= Math.floor((bounds.x + bounds.width) / CELL_SIZE); column += 1) {
      for (let row = Math.floor(bounds.y / CELL_SIZE); row <= Math.floor((bounds.y + bounds.height) / CELL_SIZE); row += 1) {
        indices.push(`${column}:${row}`);
      }
    }
    return indices;
  };
  return {
    add(obstacle: AreaAnnotationObstacle) {
      const keys = cellsFor(obstacle.rect, CLEARANCE);
      if (keys.length > 16) {
        large.push(obstacle);
        return;
      }
      for (const key of keys) {
        const entries = cells.get(key);
        if (entries) entries.push(obstacle);
        else cells.set(key, [obstacle]);
      }
    },
    overlaps(rect: Rect, owner: string) {
      const collides = (other: AreaAnnotationObstacle) => other.owner !== owner && rectsOverlap(rect, other.rect, CLEARANCE);
      return large.some(collides) || cellsFor(rect).some(key => cells.get(key)?.some(collides));
    },
  };
}

function labelCandidates(container: Rect, size: RectSize, inset: number): Rect[] {
  if (container.width < size.width + 2 * inset || container.height < size.height + 2 * inset) return [];
  const left = container.x + inset;
  const top = container.y + inset;
  const right = container.x + container.width - inset - size.width;
  const bottom = container.y + container.height - inset - size.height;
  const middleX = (left + right) / 2;
  const middleY = (top + bottom) / 2;
  return [[left, top], [middleX, top], [right, top], [middleX, middleY], [left, middleY],
    [right, middleY], [left, bottom], [middleX, bottom], [right, bottom]]
    .map(([x, y]) => ({ x, y, ...size }));
}

function outsideCandidates(area: Rect, size: RectSize): Array<{ rect: Rect; leader: [Position, Position] }> {
  const result: Array<{ rect: Rect; leader: [Position, Position] }> = [];
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const midX = area.x + area.width / 2;
  const midY = area.y + area.height / 2;
  const add = (x: number, y: number, start: Position, end: Position) => {
    result.push({ rect: { x, y, ...size }, leader: [start, end] });
  };
  for (const x of [midX, area.x + area.width / 4, right - area.width / 4]) {
    add(x - size.width / 2, area.y - LEADER_LENGTH - size.height, { x, y: area.y }, { x, y: area.y - LEADER_LENGTH });
    add(x - size.width / 2, bottom + LEADER_LENGTH, { x, y: bottom }, { x, y: bottom + LEADER_LENGTH });
  }
  for (const y of [midY, area.y + area.height / 4, bottom - area.height / 4]) {
    add(right + LEADER_LENGTH, y - size.height / 2, { x: right, y }, { x: right + LEADER_LENGTH, y });
    add(area.x - LEADER_LENGTH - size.width, y - size.height / 2, { x: area.x, y }, { x: area.x - LEADER_LENGTH, y });
  }
  return result;
}

function leaderBounds([start, b]: [Position, Position], trimStart = false): Rect {
  const fraction = trimStart ? (CLEARANCE + 1) / LEADER_LENGTH : 0;
  const a = { x: start.x + (b.x - start.x) * fraction, y: start.y + (b.y - start.y) * fraction };
  return { x: Math.min(a.x, b.x) - 0.5, y: Math.min(a.y, b.y) - 0.5,
    width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

/** Names are laid out in screen pixels. None of the input footprints are changed. */
export function layoutAreaAnnotations(
  subjects: readonly AreaAnnotationSubject[], obstacles: readonly AreaAnnotationObstacle[], viewport: RectSize,
): AreaAnnotation[] {
  const view = { x: 0, y: 0, ...viewport };
  const collisions = collisionIndex(view);
  obstacles.forEach(collisions.add);
  const placed: AreaAnnotation[] = [];
  const ordered = [...subjects].sort((a, b) => Number(b.kind === 'location') - Number(a.kind === 'location')
    || a.key.localeCompare(b.key, 'en'));
  for (const subject of ordered) {
    const shown = clipRect(subject.footprint, view);
    if (!shown || shown.width < 4 || shown.height < 4 || !subject.text.trim()) continue;
    const size = { width: Math.ceil(subject.textWidth) + 13, height: LABEL_HEIGHT };
    const clear = (rect: Rect) => containsRect(view, rect, 4) && !collisions.overlaps(rect, subject.key);
    const interior = labelCandidates(subject.footprint, size, LABEL_INSET).find(clear)
      ?? labelCandidates(shown, size, LABEL_INSET).find(clear);
    const nearbyGaps = interior ? [] : subject.gaps.filter(gap => clipRect(gap, view))
      .sort((a, b) => b.width * b.height - a.width * a.height || a.y - b.y || a.x - b.x).slice(0, 20);
    const gap = nearbyGaps.flatMap(space => labelCandidates(clipRect(space, view) ?? space, size, CLEARANCE + 2))
      .find(candidate => containsRect(subject.footprint, candidate, CLEARANCE) && clear(candidate));
    const outside = interior || gap ? undefined : outsideCandidates(subject.footprint, size)
      .find(candidate => clear(candidate.rect) && clear(leaderBounds(candidate.leader, true)));
    const rect = interior ?? gap ?? outside?.rect;
    if (!rect) continue;
    placed.push({ subject, rect, placement: interior ? 'inside' : gap ? 'gap' : 'outside', leader: outside?.leader });
    collisions.add({ rect });
    if (outside) collisions.add({ rect: leaderBounds(outside.leader) });
  }
  return placed;
}
