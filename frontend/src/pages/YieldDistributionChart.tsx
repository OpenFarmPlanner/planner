import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Box, Button, Card, CardContent, Divider, MenuItem, Typography } from "@mui/material";
import { type YieldCalendarWeek } from "../api/api";
import { type Season } from "../api/types";
import { YieldYearBoundaryMarker } from "./YieldYearBoundaryMarker";
import { copyTextToClipboardSilently } from "../components/data-grid";
import { CustomContextMenu } from "../components/contextMenu/CustomContextMenu";
import { useContextMenuPositionState } from "../components/contextMenu/useContextMenuPositionState";
import {
  closestContextMenuElement,
  shouldOpenCustomContextMenu,
  suppressNativeContextMenu,
  useLongPress,
} from "../utils/contextMenu";
import { useFocusRegion } from "../focus/useFocusManager";
import { useTranslation } from "../i18n";
import { YieldChartSegment } from "./YieldChartSegment";
import { useYieldChartData } from "./useYieldChartData";
import { getCropDisplayName } from "../crops/cropDisplay";
import {
  formatCompactYield,
  getYieldAxisLabelStep,
  type ChartPeriod,
} from "./yieldOverviewUtils";

interface YieldContextMenuPayload {
  cropId: number;
  cropName: string;
  periodLabel: string;
  yieldValue: number;
}

const DEFAULT_LEGEND_CROP_LIMIT = 15;

interface YieldDistributionChartProps {
  weeklyYield: YieldCalendarWeek[];
  selectedCropId: string;
  period: ChartPeriod;
  activeSeason: Season | null;
}

export function YieldDistributionChart({
  weeklyYield,
  selectedCropId,
  period,
  activeSeason,
}: YieldDistributionChartProps) {
  const { t, i18n } = useTranslation(["yieldOverview", "common"]);
  const yieldUnitLabel = t('common:units.kilograms');
  const navigate = useNavigate();
  const { chartData, chartCrops, maxTotalYield, yearBoundary } = useYieldChartData(
    weeklyYield,
    selectedCropId,
    period,
    i18n.resolvedLanguage ?? i18n.language,
  );

  // Only mark the calendar-year boundary when the active season deliberately
  // straddles one (e.g. a Sep–Aug season); a plain calendar-year season never
  // crosses and needs no marker.
  const seasonCrossesYearBoundary = Boolean(
    activeSeason &&
      new Date(`${activeSeason.start_date}T00:00:00`).getFullYear() !==
        new Date(`${activeSeason.end_date}T00:00:00`).getFullYear(),
  );
  const visibleYearBoundary =
    seasonCrossesYearBoundary && yearBoundary ? yearBoundary : null;
  const axisRef = useRef<HTMLDivElement | null>(null);
  const chartPlotRef = useRef<HTMLDivElement | null>(null);
  useFocusRegion('yield-chart', chartPlotRef, { label: t('chart.title'), order: 3 });
  const segmentElementsRef = useRef(new Map<string, HTMLElement>());
  const [focusedSegmentKey, setFocusedSegmentKey] = useState<string | null>(null);
  const [keyboardTooltipKey, setKeyboardTooltipKey] = useState<string | null>(null);
  // MUI's Tooltip locks in "controlled" vs. "uncontrolled" mode on its first
  // render and ignores later prop changes that would flip that (e.g. going
  // from `open={undefined}` to `open={true}` later does nothing visible) —
  // so hover has to be tracked explicitly here to keep the tooltip always
  // controlled by a real boolean, letting the keyboard (Space) toggle work.
  const [hoveredSegmentKey, setHoveredSegmentKey] = useState<string | null>(null);
  const [highlightedCropId, setHighlightedCropId] = useState<number | null>(null);
  const handleHoverEnd = useCallback((key: string) => {
    setHoveredSegmentKey((current) => (current === key ? null : current));
  }, []);
  const toggleHighlightedCrop = useCallback((cropId: number) => {
    setHighlightedCropId((current) => (current === cropId ? null : cropId));
  }, []);
  const registerSegmentElement = useCallback((key: string, element: HTMLElement | null) => {
    if (element) segmentElementsRef.current.set(key, element);
    else segmentElementsRef.current.delete(key);
  }, []);
  const tooltipPeriodLabel = t("chart.tooltipPeriod");
  const tooltipYieldLabel = t("chart.tooltipYield");
  const actionsLabel = t("common:actions.actions");

  const isYieldContextMenuTarget = useCallback((target: EventTarget | null): boolean => (
    shouldOpenCustomContextMenu(target)
    && closestContextMenuElement(target, '[data-rmg-component="yield-segment"]') !== null
  ), []);
  const {
    state: contextMenuState,
    open: openContextMenuState,
    close: closeContextMenu,
  } = useContextMenuPositionState<YieldContextMenuPayload>({ isContextMenuTarget: isYieldContextMenuTarget });

  const openContextMenu = useCallback((
    event: React.MouseEvent | React.TouchEvent,
    payload: YieldContextMenuPayload,
  ) => {
    if (!shouldOpenCustomContextMenu(event.target)) return;
    suppressNativeContextMenu(event);
    const point = "changedTouches" in event
      ? event.changedTouches[0] ?? event.touches[0]
      : event;
    if (!point) return;
    openContextMenuState(payload, point.clientX + 2, point.clientY - 6);
  }, [openContextMenuState]);

  const openCrop = useCallback((cropId: number) => {
    navigate(`/app/crops?cropId=${cropId}`);
  }, [navigate]);

  const copySegmentSummary = useCallback((payload: YieldContextMenuPayload) => {
    const summary = `${payload.cropName} · ${payload.periodLabel} · ${payload.yieldValue.toFixed(2)} ${yieldUnitLabel}`;
    copyTextToClipboardSilently(summary);
  }, [yieldUnitLabel]);

  // Keyboard navigation between bars — the chart-region reference
  // implementation described in docs/keyboard-architecture.md. Only one
  // segment is ever part of the tab order (roving tabindex); arrow keys move
  // that "current" segment across periods (left/right) and, within a
  // period's stacked bar, across crops (up/down).
  const getSegmentKey = useCallback((columnId: string, cropId: number) => `${columnId}-${cropId}`, []);

  const defaultSegmentKey = useMemo(() => {
    const firstColumn = chartData[0];
    const firstCrop = firstColumn?.crops[0];
    return firstColumn && firstCrop ? getSegmentKey(firstColumn.id, firstCrop.crop_id) : null;
  }, [chartData, getSegmentKey]);

  const allSegmentKeys = useMemo(
    () => new Set(chartData.flatMap((column) => column.crops.map((crop) => getSegmentKey(column.id, crop.crop_id)))),
    [chartData, getSegmentKey],
  );

  const activeSegmentKey = focusedSegmentKey && allSegmentKeys.has(focusedSegmentKey) ? focusedSegmentKey : defaultSegmentKey;

  const focusSegment = useCallback((key: string) => {
    setFocusedSegmentKey(key);
    setKeyboardTooltipKey(null);
    segmentElementsRef.current.get(key)?.focus();
  }, []);

  const handleSegmentKeyDown = useCallback((
    event: React.KeyboardEvent,
    columnIndex: number,
    cropIndex: number,
    payload: { cropId: number; cropName: string; periodLabel: string; yieldValue: number },
  ) => {
    const column = chartData[columnIndex];
    if (!column) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const nextColumn = chartData[columnIndex + (event.key === "ArrowLeft" ? -1 : 1)];
      if (!nextColumn) return;
      event.preventDefault();
      const nextCrop = nextColumn.crops[Math.min(cropIndex, nextColumn.crops.length - 1)];
      if (nextCrop) focusSegment(getSegmentKey(nextColumn.id, nextCrop.crop_id));
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // The stack renders column-reverse (first array entry at the bottom),
      // so moving "up" means the next array index.
      const nextCrop = column.crops[cropIndex + (event.key === "ArrowUp" ? 1 : -1)];
      if (!nextCrop) return;
      event.preventDefault();
      focusSegment(getSegmentKey(column.id, nextCrop.crop_id));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      openCrop(payload.cropId);
      return;
    }

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      const key = getSegmentKey(column.id, payload.cropId);
      setKeyboardTooltipKey((current) => (current === key ? null : key));
      return;
    }

    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openContextMenuState(payload, rect.left + 2, rect.bottom - 6);
    }
  }, [chartData, focusSegment, getSegmentKey, openContextMenuState, openCrop]);

  // Only one segment can be pressed at a time, so a single long-press timer
  // (keyed by the currently pressed segment's payload) covers every bar.
  const [pressedSegmentKey, setPressedSegmentKey] = useState<string | null>(null);
  const pressedSegmentPayloadRef = useRef<YieldContextMenuPayload | null>(null);
  const {
    onTouchStart: startSegmentLongPress,
    onTouchMove: clearSegmentLongPressMove,
    onTouchEnd: clearSegmentLongPressEnd,
    isLongPressing,
  } = useLongPress(
    (event) => {
      const payload = pressedSegmentPayloadRef.current;
      if (payload) openContextMenu(event, payload);
    },
  );
  const handleSegmentTouchStart = useCallback((
    event: React.TouchEvent,
    payload: YieldContextMenuPayload,
    segmentKey: string,
  ) => {
    pressedSegmentPayloadRef.current = payload;
    setPressedSegmentKey(segmentKey);
    startSegmentLongPress(event);
  }, [startSegmentLongPress]);
  const handleSegmentTouchMove = useCallback(() => {
    clearSegmentLongPressMove();
    setPressedSegmentKey(null);
  }, [clearSegmentLongPressMove]);
  // Suppresses the trailing click after a long press fired, so it doesn't
  // also run the segment's own onClick right on top of the context menu
  // that long press just opened.
  const handleSegmentTouchEnd = useCallback((event: React.TouchEvent) => {
    clearSegmentLongPressEnd(event);
    setPressedSegmentKey(null);
  }, [clearSegmentLongPressEnd]);
  const [axisWidth, setAxisWidth] = useState(0);
  const labelStep = getYieldAxisLabelStep(
    axisWidth,
    chartData.length,
    period,
  );
  const yAxisTicks = useMemo(() => {
    const tickCount = 5;
    if (maxTotalYield <= 0) {
      return [0];
    }
    return Array.from({ length: tickCount }, (_, index) =>
      Number(((maxTotalYield / (tickCount - 1)) * index).toFixed(1)),
    );
  }, [maxTotalYield]);

  useEffect(() => {
    const axisElement = axisRef.current;
    if (!axisElement) {
      return undefined;
    }

    const updateAxisWidth = (): void => {
      setAxisWidth(axisElement.getBoundingClientRect().width);
    };

    updateAxisWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateAxisWidth);
      return () => window.removeEventListener("resize", updateAxisWidth);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      setAxisWidth(width ?? axisElement.getBoundingClientRect().width);
    });
    resizeObserver.observe(axisElement);
    return () => resizeObserver.disconnect();
  }, []);

  // Crops are pre-sorted by visible yield (see useYieldChartData), so the
  // collapsed legend still shows the most relevant entries instead of hiding
  // every crop behind a count button.
  const legendCropCount = chartCrops.length;
  const legendExpansionResetKey = `${legendCropCount}:${period}:${selectedCropId}`;
  const [legendExpansionState, setLegendExpansionState] = useState({
    resetKey: legendExpansionResetKey,
    expanded: false,
  });
  const isLegendExpanded = (
    legendExpansionState.resetKey === legendExpansionResetKey
      ? legendExpansionState.expanded
      : false
  );
  const toggleLegendExpanded = useCallback(() => {
    setLegendExpansionState((current) => {
      const currentExpanded = current.resetKey === legendExpansionResetKey
        ? current.expanded
        : false;
      return {
        resetKey: legendExpansionResetKey,
        expanded: !currentExpanded,
      };
    });
  }, [legendExpansionResetKey]);
  const chartCropIds = useMemo(() => new Set(chartCrops.map((crop) => crop.id)), [chartCrops]);
  const activeHighlightedCropId = highlightedCropId !== null && chartCropIds.has(highlightedCropId)
    ? highlightedCropId
    : null;
  const isLegendExpandable = legendCropCount > DEFAULT_LEGEND_CROP_LIMIT;
  const visibleLegendCrops = useMemo(
    () => (
      isLegendExpanded || !isLegendExpandable
        ? chartCrops
        : chartCrops.slice(0, DEFAULT_LEGEND_CROP_LIMIT)
    ),
    [chartCrops, isLegendExpanded, isLegendExpandable],
  );
  const hiddenLegendCropCount = legendCropCount - DEFAULT_LEGEND_CROP_LIMIT;

  return (
    <>
    <Card
      variant="outlined"
      sx={{
        width: "100%",
        borderColor: "surface.surfaceSoftBorder",
        boxShadow: "none",
      }}
    >
      <CardContent
        sx={{ p: { xs: 1.5, sm: 2, lg: 3 }, "&:last-child": { pb: 2 } }}
      >
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
          {t("chart.title")}
        </Typography>
        <Box sx={{ my: 2 }}>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            {visibleLegendCrops.map((crop) => {
              const isHighlighted = activeHighlightedCropId === crop.id;
              const isDimmed = activeHighlightedCropId !== null && !isHighlighted;
              const formattedYield = formatCompactYield(
                crop.totalYield,
                i18n.resolvedLanguage ?? i18n.language,
              );
              return (
                <Box
                  key={crop.id}
                  component="button"
                  type="button"
                  aria-label={`${crop.name} ${formattedYield} ${yieldUnitLabel}`}
                  aria-pressed={isHighlighted}
                  onClick={() => toggleHighlightedCrop(crop.id)}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.75,
                    minHeight: 30,
                    px: 0.75,
                    py: 0.25,
                    border: "1px solid",
                    borderColor: isHighlighted ? "primary.main" : "transparent",
                    borderRadius: 1,
                    bgcolor: isHighlighted ? "action.selected" : "transparent",
                    color: "text.primary",
                    cursor: "pointer",
                    font: "inherit",
                    opacity: isDimmed ? 0.55 : 1,
                    transition: "background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease",
                    "&:hover": {
                      bgcolor: "action.hover",
                    },
                    "&:focus-visible": {
                      outline: "2px solid",
                      outlineColor: "primary.main",
                      outlineOffset: 2,
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: "2px",
                      backgroundColor: crop.color,
                      flex: "0 0 auto",
                    }}
                  />
                  <Typography variant="body2" component="span" sx={{ lineHeight: 1.3 }}>
                    {crop.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{ color: "text.secondary", fontWeight: 600, lineHeight: 1.3, whiteSpace: "nowrap" }}
                  >
                    {formattedYield} {yieldUnitLabel}
                  </Typography>
                </Box>
              );
            })}
          </Box>
          {isLegendExpandable ? (
            <Button
              size="small"
              onClick={toggleLegendExpanded}
              sx={{ textTransform: "none", mt: 1 }}
            >
              {isLegendExpanded
                ? t("legend.collapse", { count: DEFAULT_LEGEND_CROP_LIMIT })
                : t("legend.showMore", { count: hiddenLegendCropCount })}
            </Button>
          ) : null}
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "52px minmax(0, 1fr)",
              sm: "68px minmax(0, 1fr)",
            },
            gap: { xs: 0.5, sm: 1 },
            alignItems: "start",
            width: "100%",
          }}
        >
          <Box>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column-reverse",
                justifyContent: "space-between",
                height: { xs: 300, md: 400 },
                pr: 1,
              }}
            >
              {yAxisTicks.map((tick, index) => (
                <Typography
                  key={`${tick}-${index}`}
                  variant="caption"
                  sx={{ textAlign: "right", color: "text.secondary" }}
                >
                  {tick.toFixed(1)} {yieldUnitLabel}
                </Typography>
              ))}
            </Box>
            <Box sx={{ height: 44 }} />
          </Box>

          <Box ref={axisRef} sx={{ minWidth: 0 }}>
            <Box
              ref={chartPlotRef}
              data-testid="yield-chart-plot"
              sx={{
                position: "relative",
                width: "100%",
                height: { xs: 300, md: 400 },
                px: { xs: 0.25, sm: 0.75 },
                borderLeft: "1px solid",
                borderBottom: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "flex-end",
                gap: { xs: "1px", sm: "2px" },
              }}
            >
              {chartData.map((column, columnIndex) => (
                <Box
                  key={column.id}
                  data-testid={`yield-bar-column-${column.id}`}
                  sx={{
                    flex: "1 1 0",
                    minWidth: 0,
                    height: "100%",
                    display: "flex",
                    alignItems: "flex-end",
                  }}
                >
                  <Box
                    sx={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "column-reverse",
                      justifyContent: "flex-start",
                    }}
                  >
                    {column.crops.map((crop, cropIndex) => {
                      const periodLabel = `${column.primaryLabel} ${column.secondaryLabel}`;
                      const segmentKey = getSegmentKey(column.id, crop.crop_id);
                      return (
                        <YieldChartSegment
                          key={segmentKey}
                          segmentKey={segmentKey}
                          columnIndex={columnIndex}
                          cropIndex={cropIndex}
                          cropId={crop.crop_id}
                          cropName={getCropDisplayName(crop)}
                          color={crop.color}
                          yieldValue={crop.yield}
                          periodLabel={periodLabel}
                          heightPercent={maxTotalYield > 0 ? (crop.yield / maxTotalYield) * 100 : 0}
                          isTabbable={segmentKey === activeSegmentKey}
                          isHovered={hoveredSegmentKey === segmentKey}
                          isKeyboardTooltipOpen={keyboardTooltipKey === segmentKey}
                          isPressed={pressedSegmentKey === segmentKey && isLongPressing}
                          isDimmed={activeHighlightedCropId !== null && activeHighlightedCropId !== crop.crop_id}
                          tooltipPeriodLabel={tooltipPeriodLabel}
                          tooltipYieldLabel={tooltipYieldLabel}
                          actionsLabel={actionsLabel}
                          yieldUnitLabel={yieldUnitLabel}
                          onFocusSegment={setFocusedSegmentKey}
                          onHoverStart={setHoveredSegmentKey}
                          onHoverEnd={handleHoverEnd}
                          onKeyDownSegment={handleSegmentKeyDown}
                          onContextMenuOpen={openContextMenu}
                          onTouchStartSegment={handleSegmentTouchStart}
                          onTouchMoveSegment={handleSegmentTouchMove}
                          onTouchEndSegment={handleSegmentTouchEnd}
                          registerElement={registerSegmentElement}
                        />
                      );
                    })}
                  </Box>
                </Box>
              ))}
              {visibleYearBoundary ? (
                <YieldYearBoundaryMarker
                  plotRef={chartPlotRef}
                  boundaryColumnId={visibleYearBoundary.columnId}
                  label={t("chart.yearBoundary", {
                    year1: visibleYearBoundary.year1,
                    year2: visibleYearBoundary.year2,
                  })}
                  remeasureKey={`${period}:${chartData.length}:${axisWidth}`}
                />
              ) : null}
            </Box>

            <Box
              sx={{
                height: 44,
                px: { xs: 0.25, sm: 0.75 },
                display: "flex",
                gap: { xs: "1px", sm: "2px" },
              }}
            >
              {chartData.map((column, index) => (
                <Box
                  key={`${column.id}-axis`}
                  data-testid={`yield-axis-column-${column.id}`}
                  sx={{
                    flex: "1 1 0",
                    minWidth: 0,
                    textAlign: "center",
                    overflow: "visible",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      visibility:
                        index % labelStep === 0 ? "visible" : "hidden",
                      fontWeight: 600,
                      lineHeight: 1.2,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {column.primaryLabel}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      visibility:
                        index % labelStep === 0 ? "visible" : "hidden",
                      color: "text.secondary",
                      lineHeight: 1.2,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {column.secondaryLabel}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </CardContent>
    </Card>
    <CustomContextMenu
      open={contextMenuState !== null}
      onClose={closeContextMenu}
      mouseX={contextMenuState?.mouseX}
      mouseY={contextMenuState?.mouseY}
    >
      <MenuItem
        onClick={() => {
          if (!contextMenuState) return;
          const { key: payload } = contextMenuState;
          closeContextMenu();
          openCrop(payload.cropId);
        }}
      >
        {t("contextMenu.openCrop")}
      </MenuItem>
      <Divider role="separator" />
      <MenuItem
        onClick={() => {
          if (!contextMenuState) return;
          const { key: payload } = contextMenuState;
          closeContextMenu();
          copySegmentSummary(payload);
        }}
      >
        {t("common:actions.copyRow")}
      </MenuItem>
    </CustomContextMenu>
    </>
  );
}
