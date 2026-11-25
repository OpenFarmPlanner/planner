import { alpha, type Theme } from '@mui/material/styles';
import type { BedTaskUrgency } from '../components/tasks/bedTaskUrgency';

const TASK_COLORS = { overdue: 'error', upcoming: 'warning', later: 'info', completed: 'success' } as const;

export const BED_TASK_SYMBOLS: Record<BedTaskUrgency, string> = {
  overdue: '!', upcoming: '◷', later: '→', undated: '…', completed: '✓',
};

export function bedTaskColors(theme: Theme, urgency: BedTaskUrgency) {
  if (urgency === 'undated') return { fill: theme.palette.grey[300], glyph: theme.palette.grey[800] };
  const palette = theme.palette[TASK_COLORS[urgency]];
  return { fill: alpha(palette.main, 0.28), glyph: palette.dark };
}
