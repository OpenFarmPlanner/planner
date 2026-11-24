import { useTheme } from '@mui/material';
import { Group, Rect, Text } from 'react-konva';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import type { GuideLine } from './graphicalFieldsGeometry';

export function GraphicalSnapGuides({ guides, scale }: { guides: GuideLine[]; scale: number }) {
  const { palette } = useTheme();
  const locale = getActiveFormattingLocale();
  const stroke = 1.5 / scale;
  return guides.map(guide => {
    const vertical = guide.orientation === 'vertical';
    const color = guide.gapCm === undefined ? palette.error.main : palette.primary.main;
    const center = (guide.start + guide.end) / 2;
    return (
      <Group key={guide.target} listening={false}>
        <Rect
          x={vertical ? guide.value - stroke / 2 : guide.start}
          y={vertical ? guide.start : guide.value - stroke / 2}
          width={vertical ? stroke : Math.max(stroke, guide.end - guide.start)}
          height={vertical ? Math.max(stroke, guide.end - guide.start) : stroke}
          fill={color}
          opacity={0.8}
        />
        {guide.gapCm === undefined ? null : (
          <Text
            x={vertical ? guide.value + 4 / scale : center}
            y={vertical ? center : guide.value - 19 / scale}
            text={`${formatLocalizedNumber(guide.gapCm, locale, { maximumFractionDigits: 2 })} cm`}
            fontStyle="bold"
            padding={2}
            fill={color}
            stroke={palette.background.paper}
            strokeWidth={3}
            fillAfterStrokeEnabled
            scaleX={1 / scale}
            scaleY={1 / scale}
            data-testid="graphical-snap-gap"
          />
        )}
      </Group>
    );
  });
}
