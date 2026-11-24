import { useMemo, useRef } from 'react';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { snapToNeighbors, type GuideLine, type Point, type RectViewModel } from './graphicalFieldsGeometry';

interface AreaDragSession {
  node: Konva.Node;
  raw: Point;
  targets: string[];
  preview: (bypass: boolean) => void;
}

export interface DragSnapping {
  enabled: boolean;
  thresholdPx: number;
  zoom: number;
  spacing?: { centimeters: number; pixelsPerMeter: Point };
}

export interface AreaDragOptions {
  area: RectViewModel;
  neighbors: readonly RectViewModel[];
  snapping: DragSnapping;
  constrain: (point: Point) => Point;
  onGuides: (guides: GuideLine[]) => void;
  onPreview: (position: Point | null) => void;
  onDrop: (position: Point) => void;
  offset?: Point;
  blocked?: () => boolean;
}

const hasShift = (event: Event | undefined): boolean =>
  Boolean(event && 'shiftKey' in event && event.shiftKey);

function resolvePosition(options: AreaDragOptions, raw: Point, bypass: boolean, previousTargets: string[]) {
  const { area, neighbors, snapping, constrain } = options;
  const position = constrain(raw);
  if (!snapping.enabled || bypass) return { ...position, guides: [] };
  return snapToNeighbors(area.id, position, area, neighbors, {
    thresholdPx: snapping.thresholdPx,
    zoom: snapping.zoom,
    spacing: area.supportsMetricSpacing ? snapping.spacing : undefined,
    previousTargets,
    constrain,
  });
}

const noOffset = { x: 0, y: 0 };
const readPosition = (node: Konva.Node, offset: Point): Point => ({ x: node.x() - offset.x, y: node.y() - offset.y });
const writePosition = (node: Konva.Node, offset: Point, point: Point): void => {
  node.position({ x: point.x + offset.x, y: point.y + offset.y });
};

export function useAreaDrag() {
  const sessions = useRef<AreaDragSession | null>(null);
  return useMemo(() => ({
    preview: (bypass: boolean) => sessions.current?.preview(bypass),
    move: (event: KonvaEventObject<Event>, options: AreaDragOptions): void => {
      const node = event.target;
      if (node !== event.currentTarget) return;
      if (options.blocked?.()) {
        node.stopDrag();
        return;
      }
      const offset = options.offset ?? noOffset;
      const previous = sessions.current;
      const session: AreaDragSession = {
        node,
        raw: readPosition(node, offset),
        targets: previous?.node === node ? previous.targets : [],
        preview: bypass => {
          const result = resolvePosition(options, session.raw, bypass, session.targets);
          writePosition(node, offset, result);
          session.targets = result.guides.map(guide => guide.target);
          options.onGuides(result.guides);
          options.onPreview({ x: result.x, y: result.y });
        },
      };
      sessions.current = session;
      session.preview(hasShift(event.evt));
    },
    end: (event: KonvaEventObject<Event>, options: AreaDragOptions): void => {
      const node = event.target;
      if (node !== event.currentTarget) return;
      const previous = sessions.current;
      const session = previous?.node === node ? previous : null;
      const offset = options.offset ?? noOffset;
      sessions.current = null;
      options.onGuides([]);
      options.onPreview(null);
      if (!event.evt || ['touchcancel', 'pointercancel'].includes(event.evt.type) || options.blocked?.()) {
        writePosition(node, offset, options.area);
        return;
      }
      // Konva still holds the last snapped position. Resolve the final drop
      // from the pointer's unsnapped position, including a late Shift press.
      const raw = session?.raw ?? readPosition(node, offset);
      const { x, y } = resolvePosition(options, raw, hasShift(event.evt), session?.targets ?? []);
      writePosition(node, offset, { x, y });
      options.onDrop({ x, y });
    },
  }), []);
}
