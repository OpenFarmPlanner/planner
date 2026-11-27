import { useTheme } from '@mui/material/styles';
import { Group, Rect } from 'react-konva';
import { freeAreaColor } from '../components/hierarchy/utils/freeAreaColors';
import type { MetricCoverage } from '../components/hierarchy/utils/growingAreaGeometry';
import type { Point } from './graphicalFieldsGeometry';
import { getGraphicalFreeRects } from './graphicalAreaGeometry';

type AreaKind = 'site' | 'parcel';

export function GraphicalFreeRectangles({ coverage, origin, scale, kind, objectKey }: {
  coverage?: MetricCoverage;
  origin: Point;
  scale: Point;
  kind: AreaKind;
  objectKey?: string;
}) {
  const color = freeAreaColor(useTheme(), kind);
  if (!coverage?.freeRects?.length) return null;
  return (
    <Group listening={Boolean(objectKey)}>
      {getGraphicalFreeRects(coverage, origin, scale).map((rect, index) => (
        <Rect
          key={index}
          {...rect}
          fill={color}
          data-graphical-object-key={objectKey}
          data-testid={`graphical-free-area-${kind}`}
        />
      ))}
    </Group>
  );
}
