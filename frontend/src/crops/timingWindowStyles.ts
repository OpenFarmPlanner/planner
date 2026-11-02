import type { TimingWindowKind } from '../api/types';

/**
 * Theme palette colours of the year bar's lanes, one per kind. Each lane is
 * also labelled with its kind, so the colour is never the only distinction.
 */
export const TIMING_WINDOW_LANE_COLORS: Record<TimingWindowKind, string> = {
  pre_cultivation: 'info.main',
  direct_sowing: 'primary.main',
  planting: 'warning.main',
  harvest: 'error.light',
};

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
