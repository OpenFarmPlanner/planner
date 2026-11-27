import { alpha, type Theme } from '@mui/material/styles';
import { getGanttPhaseColors } from '../utils/colorContrast';
import type { OutlineKind } from './graphicalAreaGeometry';

export const GRAPHICAL_GEOMETRY_OUTLINES = ['outside', 'overlap', 'shortGap'] as const satisfies readonly OutlineKind[];

export function graphicalGeometryOutline(theme: Theme, kind: OutlineKind): { stroke: string; strokeWidth: number; dash: [number, number] } {
  switch (kind) {
    case 'outside': return { stroke: theme.palette.warning.dark, strokeWidth: 2.5, dash: [9, 4] };
    case 'overlap': return { stroke: theme.palette.error.dark, strokeWidth: 2.5, dash: [4, 2] };
    case 'shortGap': return { stroke: theme.palette.secondary.dark, strokeWidth: 2.5, dash: [2, 4] };
  }
}

export function graphicalCropPhaseColor(theme: Theme, phase: 'growth' | 'harvest' | 'occupancy', color?: string | null) {
  const colors = getGanttPhaseColors(color && /^#[\da-f]{6}$/i.test(color) ? color : theme.palette.success.main);
  return colors[phase === 'harvest' ? 'harvest' : 'growth'];
}

export function graphicalBedCropFill(theme: Theme, phase: 'growth' | 'harvest' | 'occupancy' | null, color?: string | null) {
  return phase ? alpha(graphicalCropPhaseColor(theme, phase, color), 0.45) : alpha(theme.palette.grey[700], 0.22);
}

export function graphicalPlantColors(
  theme: Theme, phaseColor?: string, taskColors?: { fill: string; glyph: string } | null, neutralCrop = false,
) {
  const coloredInk = taskColors?.glyph ?? phaseColor;
  return {
    stem: coloredInk ?? theme.palette.text.primary,
    canopyFill: taskColors?.fill ?? alpha(phaseColor ?? (neutralCrop ? theme.palette.grey[700] : theme.palette.success.main), 0.15),
    canopyOutline: alpha(coloredInk ?? (neutralCrop ? theme.palette.grey[700] : theme.palette.success.dark), coloredInk ? 0.65 : 0.36),
  };
}
