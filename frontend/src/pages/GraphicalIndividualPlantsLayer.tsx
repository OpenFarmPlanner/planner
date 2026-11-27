import { useRef } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { Circle, Ellipse, Group, Rect, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { StemCoordinates } from '../api/types';
import type { BedTaskUrgency } from '../components/tasks/bedTaskUrgency';
import { bedTaskColors, BED_TASK_SYMBOLS } from './graphicalBedTaskStyle';
import type { BedCultivationEntry } from './graphicalCultivation';
import { graphicalPlantColors } from './graphicalDisplayStyle';
import { canvasToStem, stemToCanvas, type PlacementDimensions } from './individualPlantGeometry';
import type { GraphicalRotation, Position, Rect as CanvasRect } from './graphicalLayoutUtils';

export interface CanvasStem extends StemCoordinates {
  key: string;
  planId: number | null;
  canopy: number;
  selected: boolean;
  objectKey?: string;
  urgency?: BedTaskUrgency;
  phase?: BedCultivationEntry['phase'];
  phaseColor?: string;
  label?: { name: string; phase: string | null; x: number; y: number; width: number; height: number };
}

type Press = KonvaEventObject<MouseEvent | TouchEvent>;

const setCursor = (event: KonvaEventObject<MouseEvent>, cursor: string) => {
  const container = event.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
};

export function GraphicalIndividualPlantsLayer({
  field, surfaceId, surface, pixelsPerMeter, rotation, stems, zoom, placing, editablePlanId, draggablePlanIds, captureStems, onAdd, onSelect, onMove,
}: {
  field: PlacementDimensions;
  surfaceId: string;
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
  const move = (event: Press) => {
    const current = event.target.getStage()?.getPointerPosition();
    const start = press.current?.position;
    if (('touches' in event.evt && event.evt.touches.length !== 1)
      || (start && current && Math.hypot(current.x - start.x, current.y - start.y) > 8)) {
      press.current = null;
    }
  };

  return (
    <Group>
      {placing && <Rect {...surface} name="individual-placement-surface" fill={alpha(theme.palette.primary.light, 0.08)}
        stroke={theme.palette.primary.main} strokeWidth={2} strokeScaleEnabled={false} dash={[6, 4]}
        data-testid={surfaceId}
        onMouseDown={beginPress} onMouseMove={move} onTouchStart={beginPress} onTouchMove={move}
        onClick={place} onTap={place} />}
      {stems.map(stem => {
        const point = stemToCanvas(stem, field, surface, rotation);
        if (!point) return null;
        const canDrag = (editablePlanId !== undefined && editablePlanId === stem.planId)
          || (stem.planId !== null && Boolean(draggablePlanIds?.has(stem.planId)));
        const taskColors = stem.urgency ? bedTaskColors(theme, stem.urgency) : null;
        const colors = graphicalPlantColors(theme, stem.phaseColor, taskColors);
        const radius = stem.urgency || stem.selected ? 6 : 4.5;
        const label = stem.label;
        return <Group key={stem.key} {...point} draggable={canDrag} dragDistance={8}
          // Only the listening stem hits this group. The canopy follows without intercepting gestures.
          name={canDrag ? 'graphical-editable' : undefined}
          onDragStart={event => { event.cancelBubble = true; press.current = null; }}
          onDragMove={event => {
            event.cancelBubble = true;
            const { x, y } = event.currentTarget.position();
            event.currentTarget.position({
              x: Math.max(surface.x, Math.min(surface.x + surface.width, x)),
              y: Math.max(surface.y, Math.min(surface.y + surface.height, y)),
            });
          }}
          onDragEnd={event => {
            event.cancelBubble = true;
            const position = canvasToStem(event.currentTarget.position(), field, surface, rotation);
            // Reset the shared drag transform. React applies the confirmed rounded position to both shapes.
            event.currentTarget.position(point);
            const canceled = !event.evt || ['touchcancel', 'pointercancel'].includes(event.evt.type);
            if (position && !canceled) onMove(stem.key, position);
          }}>
          {stem.canopy > 0 && <Ellipse listening={false}
            radiusX={stem.canopy * pixelsPerMeter.x / 2} radiusY={stem.canopy * pixelsPerMeter.y / 2}
            data-testid={`individual-canopy-${stem.key}`}
            fill={colors.canopyFill} stroke={colors.canopyOutline}
            strokeWidth={1} strokeScaleEnabled={false} />}
          <Circle radius={radius / zoom} fill={colors.stem}
            stroke={stem.selected ? theme.palette.primary.dark : theme.palette.common.white}
            strokeWidth={2} strokeScaleEnabled={false}
            listening={Boolean(stem.objectKey || onSelect || canDrag || captureStems)} hitStrokeWidth={canDrag ? 26 / zoom : 10 / zoom}
            data-graphical-object-key={stem.objectKey} data-task-urgency={stem.urgency} data-crop-phase={stem.phase ?? undefined}
            data-testid={`individual-stem-${stem.key}`} data-x-m={stem.x_m} data-y-m={stem.y_m}
            onMouseDown={event => { if (captureStems && !canDrag) event.cancelBubble = true; beginPress(event); }}
            onTouchStart={event => { if (captureStems && !canDrag) event.cancelBubble = true; beginPress(event); }}
            onTouchMove={move}
            onMouseEnter={event => { if (canDrag) setCursor(event, 'move'); }}
            onMouseLeave={event => { if (canDrag) setCursor(event, ''); }}
            onClick={onSelect && !stem.objectKey ? event => click(event, () => onSelect(stem)) : undefined}
            onTap={onSelect && !stem.objectKey ? event => click(event, () => onSelect(stem)) : undefined} />
          {stem.urgency && <Text x={-radius / zoom} y={-4 / zoom} width={radius * 2} height={8}
            text={BED_TASK_SYMBOLS[stem.urgency]} fontSize={8} fontStyle="bold" align="center"
            fill={theme.palette.common.white} listening={false} scaleX={1 / zoom} scaleY={1 / zoom} />}
          {label && <Group x={label.x / zoom} y={label.y / zoom} scaleX={1 / zoom} scaleY={1 / zoom}
            listening={false} data-testid={`individual-label-${stem.key}`}>
            <Rect width={label.width} height={label.height} cornerRadius={3} fill={theme.palette.background.paper}
              stroke={theme.palette.divider} strokeWidth={1} />
            <Text x={5} y={3} width={label.width - 10} height={12} text={label.name} fontSize={11} fontFamily="Arial, sans-serif"
              wrap="none" ellipsis fill={theme.palette.text.primary} />
            {label.phase && <Text x={5} y={17} width={label.width - 10} height={12} text={label.phase} fontSize={11} fontFamily="Arial, sans-serif"
              wrap="none" ellipsis fill={theme.palette.text.secondary} />}
          </Group>}
        </Group>;
      })}
    </Group>
  );
}
