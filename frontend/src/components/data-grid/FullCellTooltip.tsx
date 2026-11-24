import { useRef, type ReactNode } from 'react';
import { Box, type SxProps, type Theme, type TooltipProps } from '@mui/material';
import { AppTooltip } from '../AppTooltip';
import { ROW_LONG_PRESS_MS } from '../contextMenu/useLongPressTimer';

export const FULL_CELL_TOOLTIP_CELL_CLASS = 'ofp-cell-full-tooltip';

export interface FullCellTooltipProps
  extends Pick<TooltipProps, 'title' | 'describeChild' | 'disableInteractive' | 'enterDelay' | 'slotProps'> {
  children: ReactNode;
  cellHasFocus?: boolean;
  focusable?: boolean;
  touchPreview?: boolean;
  triggerSx?: SxProps<Theme>;
}

export function FullCellTooltip({
  children,
  cellHasFocus = false,
  focusable = false,
  touchPreview = false,
  triggerSx,
  ...tooltipProps
}: FullCellTooltipProps) {
  const previewedByTouch = useRef(false);

  return (
    <AppTooltip
      {...tooltipProps}
      cellHasFocus={cellHasFocus}
      enterTouchDelay={touchPreview ? ROW_LONG_PRESS_MS : undefined}
      onOpen={event => {
        if (touchPreview && event.type === 'touchstart') previewedByTouch.current = true;
      }}
    >
      <Box
        component="span"
        className="ofp-full-cell-tooltip-trigger"
        tabIndex={focusable ? 0 : undefined}
        onTouchStart={touchPreview ? event => {
          previewedByTouch.current = false;
          // Give the comparison preview the long press on this cell.
          event.stopPropagation();
        } : undefined}
        onTouchEnd={touchPreview ? event => {
          if (previewedByTouch.current) event.preventDefault();
        } : undefined}
        sx={[
          {
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            px: 1.25,
          },
          ...(Array.isArray(triggerSx) ? triggerSx : [triggerSx]),
        ]}
      >
        {children}
      </Box>
    </AppTooltip>
  );
}
