import { useTheme } from '@mui/material';
import { Group, Line, Rect, Text } from 'react-konva';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import type { GuideLine } from './graphicalFieldsGeometry';
import type { PlantDistanceGuide } from './individualPlantSnapping';

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

export function GraphicalPlantDistanceGuide({ guide, scale }: { guide: PlantDistanceGuide; scale: number }) {
  const { palette } = useTheme();
  const { neighbor, stem, meters, snapped } = guide;
  const color = snapped ? palette.primary.main : palette.text.secondary;
  const label = `${formatLocalizedNumber(meters, getActiveFormattingLocale(), { maximumFractionDigits: 2 })} m`;
  return (
    <Group listening={false} data-testid="individual-distance-guide" data-snapped={snapped}>
      <Line points={[neighbor.x, neighbor.y, stem.x, stem.y]} stroke={color}
        strokeWidth={snapped ? 2 : 1} strokeScaleEnabled={false} dash={snapped ? [] : [4 / scale, 3 / scale]} />
      <Text x={(neighbor.x + stem.x) / 2 + 4 / scale} y={(neighbor.y + stem.y) / 2 - 17 / scale}
        text={label} fontStyle={snapped ? 'bold' : 'normal'} fill={color}
        stroke={palette.background.paper} strokeWidth={3} fillAfterStrokeEnabled
        scaleX={1 / scale} scaleY={1 / scale} />
    </Group>
  );
}
