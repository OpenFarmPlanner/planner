import { useRef } from 'react';
import { useTheme } from '@mui/material/styles';
import { Circle, Group, Rect, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { StemCoordinates } from '../api/types';
import type { BedTaskUrgency } from '../components/tasks/bedTaskUrgency';
import { bedTaskColors, BED_TASK_SYMBOLS } from './graphicalBedTaskStyle';
import type { BedCultivationEntry } from './graphicalCultivation';
import { graphicalPlantColors } from './graphicalDisplayStyle';
import { FIELD_WORLD_PX_PER_METER } from './graphicalFieldsGeometry';
import { hasShift } from './graphicalAreaDrag';
import { canvasToStem, stemToCanvas, type PlacementDimensions } from './individualPlantGeometry';
import type { GraphicalRotation, Position, Rect as CanvasRect } from './graphicalLayoutUtils';
import type { PlantSnapResult } from './individualPlantSnapping';

export interface CanvasStem extends StemCoordinates {
  key: string;
  planId: number | null;
  canopy: number;
  selected: boolean;
  objectKey?: string;
  urgency?: BedTaskUrgency;
  phase?: BedCultivationEntry['phase'];
  phaseColor?: string;
  neutralCrop?: boolean;
  label?: { name: string; x: number; y: number; width: number; height: number };
}

type Press = KonvaEventObject<MouseEvent | TouchEvent>;

const setCursor = (event: KonvaEventObject<MouseEvent>, cursor: string) => {
  const container = event.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
};

export function GraphicalIndividualPlantsLayer({
  field, surface, rotation, stems, zoom, editablePlanId, draggablePlanIds, captureStems, onSelect, onMove, onMoveWorld, onDragPreview,
  resolveDragPoint, onDragReapply, shouldCancelDrag, visibleRect, activeDragKey,
}: {
  field: PlacementDimensions;
  surface: CanvasRect;
  rotation: GraphicalRotation;
  stems: CanvasStem[];
  zoom: number;
  visibleRect?: CanvasRect;
  activeDragKey?: string;
  editablePlanId?: number | null;
  /** Saved plans whose stems can be dragged directly, in graphic edit mode (#1579). */
  draggablePlanIds?: ReadonlySet<number>;
  /**
   * Every stem takes its own pointer gestures, even while it cannot be dragged (a move is
   * saving or the plan has a panel draft), so they never reach the bed or parcel below.
   */
  captureStems?: boolean;
  onSelect?: (stem: CanvasStem) => void;
  onMove: (key: string, position: StemCoordinates) => void;
  onMoveWorld?: (key: string, point: Position) => void;
  onDragPreview?: (key: string, point: Position | null) => void;
  resolveDragPoint?: (stem: CanvasStem, raw: Position, previous: string | null, bypass: boolean) => PlantSnapResult;
  onDragReapply?: (apply: ((bypass: boolean) => void) | null) => void;
  shouldCancelDrag?: () => boolean;
}) {
  const theme = useTheme();
  const press = useRef<{ target: Press['target']; position: Position } | null>(null);
  const drag = useRef<{ key: string; target: string | null; apply: (bypass: boolean) => void } | null>(null);

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
      {stems.map(stem => {
        const point = stemToCanvas(stem, field, surface, rotation);
        if (!point) return null;
        const canopyRadius = stem.canopy > 0 ? stem.canopy * FIELD_WORLD_PX_PER_METER / 2 : 0;
        // Keep the canopy visible at an edge even when its stem has left the viewport.
        if (visibleRect && !stem.selected && activeDragKey !== stem.key
          && (point.x + canopyRadius < visibleRect.x || point.x - canopyRadius > visibleRect.x + visibleRect.width
            || point.y + canopyRadius < visibleRect.y || point.y - canopyRadius > visibleRect.y + visibleRect.height)) return null;
        const canDrag = (editablePlanId !== undefined && editablePlanId === stem.planId)
          || (stem.planId !== null && Boolean(draggablePlanIds?.has(stem.planId)));
        const freeDrag = canDrag ? onMoveWorld : undefined;
        const selectStem = !stem.objectKey && onSelect ? () => onSelect(stem) : undefined;
        const capturePress = captureStems && !canDrag;
        const taskColors = stem.urgency ? bedTaskColors(theme, stem.urgency) : null;
        const colors = graphicalPlantColors(theme, stem.phaseColor, taskColors, stem.neutralCrop);
        const radius = stem.urgency || stem.selected ? 6 : 4.5;
        const label = stem.label;
        return <Group key={stem.key} {...point} draggable={canDrag} dragDistance={8}
          // Only the listening stem hits this group. The canopy follows without intercepting gestures.
          name={canDrag ? 'graphical-editable' : undefined}
          onDragStart={canDrag ? event => { event.cancelBubble = true; press.current = null; } : undefined}
          onDragMove={canDrag ? event => {
            event.cancelBubble = true;
            if (shouldCancelDrag?.()) return;
            if (!freeDrag) {
              const { x, y } = event.currentTarget.position();
              event.currentTarget.position({
                x: Math.max(surface.x, Math.min(surface.x + surface.width, x)),
                y: Math.max(surface.y, Math.min(surface.y + surface.height, y)),
              });
            }
            const node = event.currentTarget;
            const stage = node.getStage();
            const parent = node.getParent();
            if (!stage || !parent) return;
            const raw = node.getAbsolutePosition(stage);
            const session = {
              key: stem.key,
              target: drag.current?.key === stem.key ? drag.current.target : null,
              apply: (bypass: boolean) => {
                const result = resolveDragPoint?.(stem, raw, session.target, bypass);
                const point = result?.point ?? raw;
                session.target = result?.target ?? null;
                node.position(parent.getAbsoluteTransform(stage).copy().invert().point(point));
                onDragPreview?.(stem.key, point);
                node.getLayer()?.batchDraw();
              },
            };
            drag.current = session;
            onDragReapply?.(session.apply);
            session.apply(hasShift(event.evt));
          } : undefined}
          onDragEnd={canDrag ? event => {
            event.cancelBubble = true;
            const node = event.currentTarget;
            const canceled = shouldCancelDrag?.() || !event.evt || ['touchcancel', 'pointercancel'].includes(event.evt.type);
            if (!canceled && drag.current?.key === stem.key) drag.current.apply(hasShift(event.evt));
            drag.current = null;
            onDragReapply?.(null);
            const stage = node.getStage();
            const world = stage && freeDrag ? node.getAbsolutePosition(stage) : null;
            const position = canvasToStem(node.position(), field, surface, rotation);
            // Reset the shared drag transform. React applies the confirmed rounded position to both shapes.
            node.position(point);
            onDragPreview?.(stem.key, null);
            if (canceled) return;
            if (world && freeDrag) freeDrag(stem.key, world);
            else if (position) onMove(stem.key, position);
          } : undefined}>
          {canopyRadius > 0 && <Circle listening={false}
            radius={canopyRadius}
            data-testid={`individual-canopy-${stem.key}`}
            fill={colors.canopyFill} stroke={colors.canopyOutline}
            strokeWidth={1} strokeScaleEnabled={false} />}
          <Circle radius={radius / zoom} fill={colors.stem}
            stroke={stem.selected ? theme.palette.primary.dark : theme.palette.common.white}
            strokeWidth={2} strokeScaleEnabled={false}
            listening={Boolean(stem.objectKey || onSelect || canDrag || captureStems)} hitStrokeWidth={canDrag ? 26 / zoom : 10 / zoom}
            data-graphical-object-key={stem.objectKey} data-task-urgency={stem.urgency} data-crop-phase={stem.phase ?? undefined}
            data-testid={`individual-stem-${stem.key}`} data-x-m={stem.x_m} data-y-m={stem.y_m}
            onMouseDown={selectStem || capturePress ? event => {
              if (capturePress) event.cancelBubble = true;
              beginPress(event);
            } : undefined}
            onTouchStart={selectStem || capturePress ? event => {
              if (capturePress && event.evt.touches.length === 1) event.cancelBubble = true;
              beginPress(event);
            } : undefined}
            onTouchMove={selectStem ? move : undefined}
            onMouseEnter={canDrag ? event => setCursor(event, 'move') : undefined}
            onMouseLeave={canDrag ? event => setCursor(event, '') : undefined}
            onClick={selectStem ? event => click(event, selectStem) : undefined}
            onTap={selectStem ? event => click(event, selectStem) : undefined} />
          {stem.urgency && <Text x={-radius / zoom} y={-4 / zoom} width={radius * 2} height={8}
            text={BED_TASK_SYMBOLS[stem.urgency]} fontSize={8} fontStyle="bold" align="center"
            fill={theme.palette.common.white} listening={false} scaleX={1 / zoom} scaleY={1 / zoom} />}
          {label && <Group x={label.x / zoom} y={label.y / zoom} scaleX={1 / zoom} scaleY={1 / zoom}
            listening={false} data-testid={`individual-label-${stem.key}`}>
            <Rect width={label.width} height={label.height} cornerRadius={3} fill={theme.palette.background.paper}
              stroke={theme.palette.divider} strokeWidth={1} />
            <Text x={5} y={3} width={label.width - 10} height={12} text={label.name} fontSize={11} fontFamily="Arial, sans-serif"
              wrap="none" ellipsis fill={theme.palette.text.primary} />
          </Group>}
        </Group>;
      })}
    </Group>
  );
}
