import { useTheme } from '@mui/material/styles';
import { Group, Rect } from 'react-konva';
import { freeAreaColor } from '../components/hierarchy/utils/freeAreaColors';
import type { MetricCoverage } from '../components/hierarchy/utils/growingAreaGeometry';
import type { Point } from './graphicalFieldsGeometry';

type AreaKind = 'site' | 'parcel';

export function GraphicalFreeRectangles({ coverage, origin, scale, kind }: {
  coverage?: MetricCoverage;
  origin: Point;
  scale: Point;
  kind: AreaKind;
}) {
  const color = freeAreaColor(useTheme(), kind);
  if (!coverage?.freeRects?.length) return null;
  return (
    <Group listening={false}>
      {coverage.freeRects.map((rect, index) => (
        <Rect
          key={index}
          x={origin.x + rect.x * scale.x}
          y={origin.y + rect.y * scale.y}
          width={rect.width * scale.x}
          height={rect.height * scale.y}
          fill={color}
          data-testid={`graphical-free-area-${kind}`}
        />
      ))}
    </Group>
  );
}
