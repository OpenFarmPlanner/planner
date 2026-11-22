import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useIsAnyContextMenuOpen } from "../../../../components/contextMenu/contextMenuOpenState";
import { ViewMode, type TooltipRenderProps } from "../../types";
import { TaskService } from "../../services";
import type { TooltipProps } from "../../types";
import { format } from "date-fns";
import { getDuration } from "../../utils/dateUtils";

type TooltipPlacement = "top" | "bottom";
type ScrollListenerTarget = HTMLElement | typeof window;

const VIEWPORT_PADDING = 8;

const isBrowserEnvironment = () =>
  typeof window !== "undefined" && typeof document !== "undefined";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getScrollParents = (
  element: HTMLElement | null,
): ScrollListenerTarget[] => {
  if (!isBrowserEnvironment() || !element) return [];

  const parents: ScrollListenerTarget[] = [];
  let current: HTMLElement | null = element.parentElement;

  while (current && current !== document.body) {
    const styles = window.getComputedStyle(current);
    const overflowValue = `${styles.overflow}${styles.overflowX}${styles.overflowY}`;

    if (/(auto|scroll|overlay|hidden)/.test(overflowValue)) {
      parents.push(current);
    }

    current = current.parentElement;
  }

  parents.push(window);
  return parents;
};

/**
 * Tooltip Component - Shows task information on hover
 */
const Tooltip: React.FC<
  TooltipProps & {
    renderTooltip?: (props: TooltipRenderProps) => React.ReactNode;
  }
> = ({
  task,
  position,
  dragType,
  taskId,
  startDate,
  endDate,
  totalMonths,
  monthWidth,
  showProgress = false,
  instanceId,
  className = "",
  viewMode = ViewMode.MONTH,
  renderTooltip,
  renderTooltipInPortal = true,
  tooltipOffset = 12,
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  // A task tooltip must never sit on top of the Gantt context menu the same
  // right-click/long-press just opened - see components/contextMenu/contextMenuOpenState.ts.
  const contextMenuOpen = useIsAnyContextMenuOpen();
  const [portalPosition, setPortalPosition] = useState<{
    left: number;
    top: number;
    placement: TooltipPlacement;
  }>({
    left: position.x,
    top: position.y,
    placement: "bottom",
  });

  const canUsePortal = renderTooltipInPortal && isBrowserEnvironment();

  const getTaskElement = useCallback((): HTMLElement | null => {
    if (!isBrowserEnvironment()) return null;

    const id = taskId || task.id;
    return document.querySelector(
      `[data-task-id="${id}"][data-instance-id="${instanceId}"]`,
    ) as HTMLElement | null;
  }, [instanceId, task.id, taskId]);

  const [displayStartDate, displayEndDate] = useMemo(() => {
    let nextStartDate = task.startDate;
    let nextEndDate = task.endDate;

    if (!isBrowserEnvironment()) {
      return [nextStartDate, nextEndDate];
    }

    try {
      const taskEl = getTaskElement();

      if (taskEl && (dragType || taskEl.style.left || taskEl.style.width)) {
        const dates = TaskService.getLiveDatesFromElement(
          taskEl,
          startDate,
          endDate,
          totalMonths,
          monthWidth,
          viewMode,
        );
        nextStartDate = dates.startDate;
        nextEndDate = dates.endDate;
      }
    } catch (error) {
      console.error("Error calculating live dates for tooltip:", error);
    }

    return [nextStartDate, nextEndDate];
  }, [
    dragType,
    endDate,
    getTaskElement,
    monthWidth,
    startDate,
    task.endDate,
    task.startDate,
    totalMonths,
    viewMode,
  ]);

  const duration = getDuration(displayStartDate, displayEndDate, viewMode);

  const formatDate = useCallback(
    (date: Date) => {
      if (!(date instanceof Date) || isNaN(date.getTime())) {
        return "Invalid date";
      }

      switch (viewMode) {
        case ViewMode.MINUTE:
          return format(date, "MMM d, yyyy HH:mm");
        case ViewMode.HOUR:
          return format(date, "MMM d, yyyy HH:00");
        case ViewMode.DAY:
          return format(date, "EEE, MMM d, yyyy");
        default:
          return format(date, "MMM d, yyyy");
      }
    },
    [viewMode],
  );

  const getActionText = () => {
    if (!dragType) return null;

    switch (dragType) {
      case "move":
        return "Moving task...";
      case "resize-left":
        return "Adjusting start date...";
      case "resize-right":
        return "Adjusting end date...";
      default:
        return null;
    }
  };

  const actionText = getActionText();

  const tooltipBody = useMemo(() => {
    if (renderTooltip) {
      return renderTooltip({
        task,
        position,
        dragType,
        startDate: displayStartDate,
        endDate: displayEndDate,
        viewMode,
      });
    }

    return (
      <>
        <div className="rmg-tooltip-title" data-rmg-component="tooltip-title">
          {task.name || "Unnamed Task"}
        </div>

        {actionText && (
          <div
            className="rmg-tooltip-action"
            data-rmg-component="tooltip-action"
          >
            {actionText}
          </div>
        )}

        <div
          className="rmg-tooltip-content"
          data-rmg-component="tooltip-content"
        >
          <div className="rmg-tooltip-row" data-rmg-component="tooltip-row">
            <div className="rmg-tooltip-label">Start:</div>
            <div className="rmg-tooltip-value">
              {formatDate(displayStartDate)}
            </div>
          </div>

          <div className="rmg-tooltip-row" data-rmg-component="tooltip-row">
            <div className="rmg-tooltip-label">End:</div>
            <div className="rmg-tooltip-value">
              {formatDate(displayEndDate)}
            </div>
          </div>

          <div className="rmg-tooltip-row" data-rmg-component="tooltip-row">
            <div className="rmg-tooltip-label">Duration:</div>
            <div className="rmg-tooltip-value">
              {duration.value} {duration.unit}
            </div>
          </div>

          {showProgress && typeof task.percent === "number" && (
            <div className="rmg-tooltip-row" data-rmg-component="tooltip-row">
              <div className="rmg-tooltip-label">Progress:</div>
              <div className="rmg-tooltip-value">{task.percent}%</div>
            </div>
          )}

          {task.dependencies && task.dependencies.length > 0 && (
            <div className="rmg-tooltip-row" data-rmg-component="tooltip-row">
              <div className="rmg-tooltip-label">Dependencies:</div>
              <div className="rmg-tooltip-value">
                {task.dependencies.join(", ")}
              </div>
            </div>
          )}
        </div>
      </>
    );
  }, [
    actionText,
    displayEndDate,
    displayStartDate,
    dragType,
    duration.unit,
    duration.value,
    formatDate,
    position,
    renderTooltip,
    showProgress,
    task,
    viewMode,
  ]);

  const updatePortalPosition = useCallback(() => {
    if (!canUsePortal || !tooltipRef.current) return;

    const tooltipElement = tooltipRef.current;
    const anchorElement = getTaskElement();
    const anchorRect = anchorElement?.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const anchorLeft = anchorRect?.left ?? position.x;
    const anchorTop = anchorRect?.top ?? position.y;
    const anchorWidth = anchorRect?.width ?? 0;
    const anchorBottom = anchorRect?.bottom ?? position.y;

    const centeredLeft = anchorLeft + anchorWidth / 2 - tooltipRect.width / 2;
    const maxLeft = Math.max(
      VIEWPORT_PADDING,
      viewportWidth - tooltipRect.width - VIEWPORT_PADDING,
    );
    const left = clamp(centeredLeft, VIEWPORT_PADDING, maxLeft);

    const bottomTop = anchorBottom + tooltipOffset;
    const fitsBelow =
      bottomTop + tooltipRect.height <= viewportHeight - VIEWPORT_PADDING;
    const topPlacement = anchorTop - tooltipRect.height - tooltipOffset;
    const top = fitsBelow
      ? bottomTop
      : Math.max(VIEWPORT_PADDING, topPlacement);

    setPortalPosition((current) => {
      const nextPlacement: TooltipPlacement = fitsBelow ? "bottom" : "top";
      if (
        current.left === left &&
        current.top === top &&
        current.placement === nextPlacement
      ) {
        return current;
      }

      return { left, top, placement: nextPlacement };
    });
  }, [canUsePortal, getTaskElement, position.x, position.y, tooltipOffset]);

  const schedulePositionUpdate = useCallback(() => {
    if (!canUsePortal || !isBrowserEnvironment()) return;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updatePortalPosition();
    });
  }, [canUsePortal, updatePortalPosition]);

  useLayoutEffect(() => {
    schedulePositionUpdate();
  }, [schedulePositionUpdate, tooltipBody]);

  useEffect(() => {
    if (!canUsePortal || !isBrowserEnvironment()) return;

    const anchorElement = getTaskElement();
    const scrollParents = getScrollParents(anchorElement);

    const handleViewportChange = () => {
      schedulePositionUpdate();
    };

    window.addEventListener("resize", handleViewportChange);
    scrollParents.forEach((parent) => {
      parent.addEventListener("scroll", handleViewportChange, {
        passive: true,
      });
    });

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      scrollParents.forEach((parent) => {
        parent.removeEventListener("scroll", handleViewportChange);
      });
    };
  }, [canUsePortal, getTaskElement, schedulePositionUpdate]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null && isBrowserEnvironment()) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  if (contextMenuOpen) {
    return null;
  }

  const tooltipNode = (
    <div
      ref={tooltipRef}
      className={`rmg-tooltip ${className} rmg-tooltip-visible ${canUsePortal ? "rmg-tooltip-portal" : ""}`}
      style={
        canUsePortal
          ? {
              left: `${portalPosition.left}px`,
              top: `${portalPosition.top}px`,
              position: "fixed",
            }
          : {
              left: `${position.x}px`,
              top: `${position.y - 40}px`,
            }
      }
      data-rmg-component="tooltip"
      role="tooltip"
      data-placement={canUsePortal ? portalPosition.placement : "inline"}
    >
      {tooltipBody}
    </div>
  );

  if (canUsePortal) {
    return createPortal(tooltipNode, document.body);
  }

  return tooltipNode;
};

export default Tooltip;
