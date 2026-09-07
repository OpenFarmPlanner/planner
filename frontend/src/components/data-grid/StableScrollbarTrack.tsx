import { Box } from '@mui/material';
import type { StableDataGridScrollbar } from './hooks/useStableDataGridScrollbar';

/**
 * Renders the draggable track/thumb overlay for useStableDataGridScrollbar.
 * Shared between EditableDataGrid's continuous-scroll mode and the raw
 * Standort/Parzelle/Beet hierarchy grid so both keep identical markup
 * instead of copy-pasted absolutely-positioned Boxes.
 *
 * Must be rendered as a sibling of the horizontally-scrolling wrapper Box
 * (not nested inside it) — `right: 0` is relative to the nearest positioned
 * ancestor, so nesting it inside content that can be wider than the visible
 * viewport (e.g. surfaceSizing="contentFit") pins it to the content's right
 * edge instead of the viewport's, letting it scroll out of view.
 */

export interface StableScrollbarTrackProps {
  trackRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Attached to the thumb so the hook can move it directly, without a React
   * render per scroll frame — see useStableDataGridScrollbar.
   */
  thumbRef: React.RefObject<HTMLDivElement | null>;
  scrollbar: StableDataGridScrollbar;
  top: number | string;
  bottom: number | string;
  /**
   * Distance from the positioned ancestor's right edge to the track.
   * Defaults to 0 (flush with that ancestor's edge) — pass a measured value
   * when the ancestor can be wider than the actual visible table (e.g. a
   * centered content-fit table on a wide screen), so the track tracks the
   * table's own edge instead of drifting into empty space beside it.
   */
  right?: number | string;
  trackTestId?: string;
  thumbTestId?: string;
}

export function StableScrollbarTrack({
  trackRef,
  thumbRef,
  scrollbar,
  top,
  bottom,
  right = 0,
  trackTestId,
  thumbTestId,
}: StableScrollbarTrackProps) {
  if (!scrollbar.isActive) {
    return null;
  }

  return (
    <Box
      ref={trackRef}
      data-testid={trackTestId}
      onPointerDown={scrollbar.onTrackPointerDown}
      sx={{
        position: 'absolute',
        top: typeof top === 'number' ? `${top}px` : top,
        bottom: typeof bottom === 'number' ? `${bottom}px` : bottom,
        right: typeof right === 'number' ? `${right}px` : right,
        width: '10px',
        zIndex: 60,
      }}
    >
      <Box
        ref={thumbRef}
        data-testid={thumbTestId}
        onPointerDown={scrollbar.onThumbPointerDown}
        sx={{
          position: 'absolute',
          // `top` stays 0; the vertical position is a transform written by
          // useStableDataGridScrollbar on every scroll frame.
          top: 0,
          height: `${scrollbar.thumbHeight}px`,
          left: '2px',
          right: '2px',
          borderRadius: '4px',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          cursor: 'pointer',
          '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
        }}
      />
    </Box>
  );
}
