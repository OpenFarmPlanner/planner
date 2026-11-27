import { useRef } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { Circle, Group, Rect } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { GraphicPlacementResolution } from './graphicalPlantPlacement';
import type { Position, RectSize } from './graphicalLayoutUtils';
import type { ViewportState } from './graphicalViewport';

type Press = KonvaEventObject<MouseEvent | TouchEvent>;

export function GraphicalFreePlantPlacement({
  viewport, size, preview, point, onPreview, onPlace,
}: {
  viewport: ViewportState;
  size: RectSize;
  preview: GraphicPlacementResolution | null;
  point: Position | null;
  onPreview: (point: Position | null) => void;
  onPlace: (point: Position) => void;
}) {
  const theme = useTheme();
  const press = useRef<Position | null>(null);
  const begin = (event: Press) => {
    const stage = event.target.getStage();
    const singlePress = 'touches' in event.evt ? event.evt.touches.length === 1 : event.evt.button === 0;
    press.current = singlePress ? stage?.getPointerPosition() ?? null : null;
    onPreview(singlePress ? stage?.getRelativePointerPosition() ?? null : null);
  };
  const move = (event: Press) => {
    const stage = event.target.getStage();
    if ('touches' in event.evt && event.evt.touches.length !== 1) {
      press.current = null;
      onPreview(null);
      return;
    }
    onPreview(stage?.getRelativePointerPosition() ?? null);
  };
  const place = (event: Press) => {
    const stage = event.target.getStage();
    const start = press.current;
    press.current = null;
    const pixel = stage?.getPointerPosition();
    const world = stage?.getRelativePointerPosition();
    if (!start || !world || !pixel || Math.hypot(start.x - pixel.x, start.y - pixel.y) > 8) return;
    event.cancelBubble = true;
    onPlace(world);
  };

  return <Group>
    {preview && 'frame' in preview && <Rect {...preview.frame.world} listening={false}
      fill={alpha(theme.palette.primary.main, 0.12)} stroke={theme.palette.primary.main}
      strokeWidth={2} strokeScaleEnabled={false} />}
    {point && <Circle {...point} radius={6 / viewport.scale} listening={false}
      fill={preview && 'error' in preview ? theme.palette.error.main : theme.palette.primary.main}
      stroke={theme.palette.background.paper} strokeWidth={2} strokeScaleEnabled={false} />}
    <Rect x={-viewport.x / viewport.scale} y={-viewport.y / viewport.scale}
      width={size.width / viewport.scale} height={size.height / viewport.scale}
      fill="transparent" name="individual-placement-surface" data-testid="individual-free-placement-surface"
      onMouseDown={begin} onMouseMove={move} onMouseLeave={() => { press.current = null; onPreview(null); }}
      onTouchStart={begin} onTouchMove={move}
      onTouchCancel={() => { press.current = null; onPreview(null); }} onClick={place} onTap={place} />
  </Group>;
}
