import type { Theme } from '@mui/material/styles';

import type { TimingWindowKind } from '../api/types';

/**
 * Theme palette colours of the year bar's lanes, one per kind. Each lane is
 * also labelled with its kind, so the colour is never the only distinction.
 */
export const TIMING_WINDOW_LANE_COLORS: Record<TimingWindowKind, string> = {
  pre_cultivation: 'info.main',
  direct_sowing: 'primary.main',
  planting: 'warning.main',
};

/**
 * The derived "Ernte (berechnet)" lane: hatched in a theme colour so it reads
 * as calculated, not entered, without relying on the colour alone.
 */
export const computedHarvestSegmentSx = {
  backgroundImage: (theme: Theme) => `repeating-linear-gradient(135deg, ${theme.palette.success.main} 0 3px, transparent 3px 6px)`,
  border: 1,
  borderColor: 'success.main',
  borderStyle: 'dashed',
  boxSizing: 'border-box',
} as const;

export const timingWindowTrackSx = {
  position: 'relative',
  height: 16,
  borderRadius: 1,
  bgcolor: 'surface.surfaceSubtleBackground',
  border: 1,
  borderColor: 'divider',
  overflow: 'hidden',
} as const;

export const timingWindowLaneGridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '96px minmax(0, 1fr)', sm: '128px minmax(0, 1fr)' },
  columnGap: 1,
  rowGap: 0.75,
  alignItems: 'center',
} as const;
