import { useRef } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { Circle, Ellipse, Group, Rect } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Field, StemCoordinates } from '../api/types';
import { canvasToStem, stemToCanvas } from './individualPlantGeometry';
import type { GraphicalRotation, Position, Rect as CanvasRect } from './graphicalLayoutUtils';

export interface CanvasStem extends StemCoordinates {
  key: string;
  planId: number | null;
  canopy: number;
  selected: boolean;
}

type Press = KonvaEventObject<MouseEvent | TouchEvent>;

const setCursor = (event: KonvaEventObject<MouseEvent>, cursor: string) => {
  const container = event.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
};

export function GraphicalIndividualPlantsLayer({
  field, surface, pixelsPerMeter, rotation, stems, zoom, placing, editablePlanId, draggablePlanIds, captureStems, onAdd, onSelect, onMove,
}: {
  field: Field;
  surface: CanvasRect;
  pixelsPerMeter: Position;
  rotation: GraphicalRotation;
  stems: CanvasStem[];
  zoom: number;
  placing: boolean;
  editablePlanId?: number | null;
  /** Saved plans whose stems can be dragged directly, in graphic edit mode (#1579). */
  draggablePlanIds?: ReadonlySet<number>;
  /**
   * Every stem takes its own pointer gestures, even while it cannot be dragged (a move is
   * saving or the plan has a panel draft), so they never reach the bed or parcel below.
   */
  captureStems?: boolean;
  onAdd: (position: StemCoordinates) => void;
  onSelect?: (stem: CanvasStem) => void;
  onMove: (key: string, position: StemCoordinates) => void;
}) {
  const theme = useTheme();
  const press = useRef<{ target: Press['target']; position: Position } | null>(null);

  const beginPress = (event: Press) => {
    const position = event.target.getStage()?.getPointerPosition();
    press.current = position
      && (!('touches' in event.evt) ? event.evt.button === 0 : event.evt.touches.length === 1)
      ? { target: event.target, position } : null;
  };
  const click = (event: Press, onClick: () => void) => {
    const start = press.current;
    const end = event.target.getStage()?.getPointerPosition();
    press.current = null;
    if (start?.target === event.target && end
      && Math.hypot(end.x - start.position.x, end.y - start.position.y) <= 8) {
      event.cancelBubble = true;
      onClick();
    }
  };
  const place = (event: Press) => click(event, () => {
    const pointer = event.target.getParent()?.getRelativePointerPosition();
    const position = pointer && canvasToStem(pointer, field, surface, rotation);
    if (position) onAdd(position);
  });
  const touchMove = (event: KonvaEventObject<TouchEvent>) => {
    if (event.evt.touches.length !== 1) press.current = null;
  };

  return (
    <Group>
      {stems.map(stem => {
        const point = stemToCanvas(stem, field, surface, rotation);
        if (!point) return null;
        const canDrag = (editablePlanId !== undefined && editablePlanId === stem.planId)
          || (stem.planId !== null && Boolean(draggablePlanIds?.has(stem.planId)));
        const ink = stem.selected ? theme.palette.primary.dark : theme.palette.text.primary;
        return <Group key={stem.key}>
          {stem.canopy > 0 && <Ellipse {...point} listening={false}
            radiusX={stem.canopy * pixelsPerMeter.x / 2} radiusY={stem.canopy * pixelsPerMeter.y / 2}
            data-testid={`individual-canopy-${stem.key}`}
            fill={alpha(theme.palette.success.main, 0.15)} stroke={alpha(theme.palette.success.dark, 0.36)}
            strokeWidth={1} strokeScaleEnabled={false} />}
          <Circle {...point} radius={(stem.selected ? 6 : 4.5) / zoom} fill={ink}
            stroke={theme.palette.common.white} strokeWidth={2} strokeScaleEnabled={false}
            listening={Boolean(onSelect) || canDrag || Boolean(captureStems)} hitStrokeWidth={canDrag ? 26 / zoom : 10 / zoom}
            data-testid={`individual-stem-${stem.key}`} data-x-m={stem.x_m} data-y-m={stem.y_m}
            draggable={canDrag} dragDistance={8}
            // Enrolls the stem in the graphic's Escape cancellation, like beds and parcels.
            name={canDrag ? 'graphical-editable' : undefined}
            onMouseDown={event => { if (captureStems && !canDrag) event.cancelBubble = true; beginPress(event); }}
            onTouchStart={event => { if (captureStems && !canDrag) event.cancelBubble = true; beginPress(event); }}
            onTouchMove={touchMove}
            onMouseEnter={event => { if (canDrag) setCursor(event, 'move'); }}
            onMouseLeave={event => { if (canDrag) setCursor(event, ''); }}
            onClick={event => click(event, () => onSelect?.(stem))}
            onTap={event => click(event, () => onSelect?.(stem))}
            onDragStart={event => { event.cancelBubble = true; press.current = null; }}
            onDragMove={event => {
              event.cancelBubble = true;
              const point = event.target.position();
              event.target.position({
                x: Math.max(surface.x, Math.min(surface.x + surface.width, point.x)),
                y: Math.max(surface.y, Math.min(surface.y + surface.height, point.y)),
              });
            }}
            onDragEnd={event => {
              event.cancelBubble = true;
              const position = canvasToStem(event.target.position(), field, surface, rotation);
              // Reset Konva's transient drag position. React then applies the confirmed rounded value.
              event.target.position(point);
              // Escape (stopDrag without an event) and an interrupted touch cancel the move.
              const canceled = !event.evt || ['touchcancel', 'pointercancel'].includes(event.evt.type);
              if (position && !canceled) onMove(stem.key, position);
            }} />
        </Group>;
      })}
      {placing && <Rect {...surface} fill={alpha(theme.palette.primary.light, 0.08)}
        stroke={theme.palette.primary.main} strokeWidth={2} strokeScaleEnabled={false} dash={[6, 4]}
        data-testid={`individual-place-surface-${field.id}`}
        onMouseDown={beginPress} onTouchStart={beginPress} onTouchMove={touchMove}
        onClick={place} onTap={place} />}
    </Group>
  );
}
