import { alpha, useTheme } from '@mui/material/styles';
import { Group, Layer, Line, Rect, Text } from 'react-konva';
import type { AreaAnnotation } from './graphicalAnnotationLayout';
import type { ViewportState } from './graphicalViewport';

export function GraphicalAreaAnnotations({ labels, viewport }: { labels: readonly AreaAnnotation[]; viewport: ViewportState }) {
  const theme = useTheme();
  if (!labels.length) return null;
  return (
    <Layer listening={false} data-testid="growing-area-annotations">
      <Group x={-viewport.x / viewport.scale} y={-viewport.y / viewport.scale}
        scaleX={1 / viewport.scale} scaleY={1 / viewport.scale}>
        {labels.map(({ subject, rect, leader, placement }) => (
          <Group key={subject.key}>
            {leader && <Line points={leader.flatMap(point => [point.x, point.y])}
              stroke={theme.palette.text.secondary} strokeWidth={1.5} lineCap="round"
              data-testid={`${subject.testId}-leader`} />}
            <Rect {...rect} cornerRadius={3} fill={alpha(theme.palette.background.paper, 0.92)} />
            <Text x={rect.x + 6} y={rect.y + 4} width={rect.width - 12} height={14}
              text={subject.text} fontSize={12} fontFamily="Arial, sans-serif" wrap="none"
              fontStyle={subject.kind === 'field' ? 'bold' : 'normal'} fill={theme.palette.text.primary}
              data-testid={subject.testId} data-area-annotation-placement={placement} />
          </Group>
        ))}
      </Group>
    </Layer>
  );
}
