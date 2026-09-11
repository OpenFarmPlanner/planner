import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { Box, Typography } from '@mui/material';
import { ContextMenuIndicator } from "../components/contextMenu/ContextMenuIndicator";
import { contextMenuIndicatorHostSx } from "../components/contextMenu/contextMenuIndicatorStyles";
import { AppTooltip } from '../components/AppTooltip';
import { alpha } from '@mui/material/styles';

export interface YieldSegmentPayload {
  cropId: number;
  cropName: string;
  periodLabel: string;
  yieldValue: number;
}

interface YieldChartSegmentProps {
  segmentKey: string;
  columnIndex: number;
  cropIndex: number;
  cropId: number;
  cropName: string;
  color: string;
  yieldValue: number;
  periodLabel: string;
  heightPercent: number;
  isTabbable: boolean;
  isHovered: boolean;
  isKeyboardTooltipOpen: boolean;
  isPressed: boolean;
  isDimmed: boolean;
  tooltipPeriodLabel: string;
  tooltipYieldLabel: string;
  actionsLabel: string;
  yieldUnitLabel: string;
  onFocusSegment: (segmentKey: string) => void;
  onHoverStart: (segmentKey: string) => void;
  onHoverEnd: (segmentKey: string) => void;
  onKeyDownSegment: (
    event: ReactKeyboardEvent,
    columnIndex: number,
    cropIndex: number,
    payload: YieldSegmentPayload,
  ) => void;
  onContextMenuOpen: (event: ReactMouseEvent | ReactTouchEvent, payload: YieldSegmentPayload) => void;
  onTouchStartSegment: (event: ReactTouchEvent, payload: YieldSegmentPayload, segmentKey: string) => void;
  onTouchMoveSegment: () => void;
  onTouchEndSegment: (event: ReactTouchEvent) => void;
  registerElement: (segmentKey: string, element: HTMLElement | null) => void;
}

/**
 * A single stacked-bar segment (one crop within one period's column).
 * Memoized so that hovering/focusing one segment only re-renders that
 * segment (and whichever one it's replacing) instead of every segment in
 * the chart — with many crops/periods that's the difference between a
 * handful of re-renders and thousands on every mouse move. Every prop here
 * must therefore stay a primitive or a referentially stable callback (see
 * the parent's useCallback hooks) for the memo comparison to actually skip
 * unrelated segments.
 */
export const YieldChartSegment = memo(function YieldChartSegment({
  segmentKey,
  columnIndex,
  cropIndex,
  cropId,
  cropName,
  color,
  yieldValue,
  periodLabel,
  heightPercent,
  isTabbable,
  isHovered,
  isKeyboardTooltipOpen,
  isPressed,
  isDimmed,
  tooltipPeriodLabel,
  tooltipYieldLabel,
  actionsLabel,
  yieldUnitLabel,
  onFocusSegment,
  onHoverStart,
  onHoverEnd,
  onKeyDownSegment,
  onContextMenuOpen,
  onTouchStartSegment,
  onTouchMoveSegment,
  onTouchEndSegment,
  registerElement,
}: YieldChartSegmentProps) {
  const payload: YieldSegmentPayload = { cropId, cropName, periodLabel, yieldValue };

  return (
    <AppTooltip
      // Always an explicit boolean (never `undefined`) — driven by hover and
      // the keyboard (Space) toggle. Hiding it while the segment's context
      // menu is open is AppTooltip's job, not this component's.
      open={isHovered || isKeyboardTooltipOpen}
      slotProps={{
        tooltip: {
          sx: {
            minWidth: "12rem",
            "& .MuiTypography-root": {
              color: "inherit",
            },
            "& .MuiTypography-caption": {
              fontSize: "inherit",
              lineHeight: "inherit",
            },
            "& [data-yield-tooltip-label='true']": {
              color: (theme) => alpha(theme.palette.common.white, 0.72),
            },
          },
        },
      }}
      title={
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            {cropName}
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1, rowGap: 0.25 }}>
            <Typography variant="caption" data-yield-tooltip-label="true" sx={{ fontWeight: 600 }}>
              {tooltipPeriodLabel}:
            </Typography>
            <Typography variant="caption">{periodLabel}</Typography>
            <Typography variant="caption" data-yield-tooltip-label="true" sx={{ fontWeight: 600 }}>
              {tooltipYieldLabel}:
            </Typography>
            <Typography variant="caption">{yieldValue.toFixed(2)} {yieldUnitLabel}</Typography>
          </Box>
        </Box>
      }
    >
      <Box
        ref={(element: HTMLElement | null) => registerElement(segmentKey, element)}
        data-testid={`yield-bar-${segmentKey}`}
        data-rmg-component="yield-segment"
        role="button"
        tabIndex={isTabbable ? 0 : -1}
        aria-label={`${cropName}, ${periodLabel}, ${yieldValue.toFixed(2)} ${yieldUnitLabel}`}
        onFocus={() => onFocusSegment(segmentKey)}
        onKeyDown={(event) => onKeyDownSegment(event, columnIndex, cropIndex, payload)}
        onMouseEnter={() => onHoverStart(segmentKey)}
        onMouseLeave={() => onHoverEnd(segmentKey)}
        data-long-pressing={isPressed ? "true" : undefined}
        onContextMenu={(event) => onContextMenuOpen(event, payload)}
        onTouchStart={(event) => onTouchStartSegment(event, payload, segmentKey)}
        onTouchEnd={onTouchEndSegment}
        onTouchMove={onTouchMoveSegment}
        sx={{
          position: "relative",
          width: "100%",
          height: `${heightPercent}%`,
          minHeight: yieldValue > 0 ? "2px" : 0,
          backgroundColor: color,
          opacity: isDimmed ? 0.28 : 1,
          filter: isPressed ? "brightness(0.9)" : undefined,
          transition: "filter 0.15s ease, opacity 0.15s ease",
          ...contextMenuIndicatorHostSx,
        }}
      >
        <ContextMenuIndicator
          label={actionsLabel}
          tabIndex={-1}
          onClick={(event) => onContextMenuOpen(event, payload)}
          withBackdrop
          sx={{ position: "absolute", top: -2, right: -2 }}
        />
      </Box>
    </AppTooltip>
  );
});
