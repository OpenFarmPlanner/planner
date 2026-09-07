import React from "react";
import type { TaskGroup, TaskListProps } from "../../types";
import { CollisionService } from "../../services";
import {
  estimateTaskGroupLabelHeight,
  getHierarchyLevels,
  normalizeLeftColumnWidth,
  TREE_INDENT_PX,
} from "../../utils";
import { ContextMenuIndicator } from "../../../../components/contextMenu/ContextMenuIndicator";
import { OverflowTooltip } from "../../../../components/OverflowTooltip";
import { useLongPress } from "../../../../utils/contextMenu";

/**
 * TaskList Component - Displays the list of task groups on the left side of the Gantt chart
 */

const ChevronIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg
    viewBox="0 0 16 16"
    width="12"
    height="12"
    className={`rmg-task-group-chevron-icon ${expanded ? "rmg-task-group-chevron-icon-expanded" : ""}`}
    aria-hidden="true"
  >
    <path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TaskList: React.FC<TaskListProps> = ({
  tasks = [],
  headerLabel = "Resources",
  contextMenuLabel = "Actions",
  showTaskCount = false,
  showDescription = true,
  rowHeight = 40,
  className = "",
  onGroupClick,
  onGroupContextMenu,
  onToggleGroupExpand,
  hoveredGroupId = null,
  viewMode,
  showTimelineHeader = true,
  leftColumnWidth = 160,
}) => {
  // Validate task groups array
  const validTasks = Array.isArray(tasks) ? tasks : [];

  const normalizedLeftColumnWidth = normalizeLeftColumnWidth(leftColumnWidth);

  // Calculate height for each group based on tasks
  const getGroupHeight = (taskGroup: TaskGroup) => {
    if (taskGroup.rowHeightOverride !== undefined) {
      return taskGroup.rowHeightOverride;
    }

    const estimatedHeight = estimateTaskGroupLabelHeight(taskGroup, normalizedLeftColumnWidth, {
      includeDescription: showDescription,
    });

    if (!taskGroup.tasks || !Array.isArray(taskGroup.tasks)) {
      return estimatedHeight;
    }

    const taskRows = CollisionService.detectOverlaps(taskGroup.tasks, viewMode);
    const taskHeight = Math.max(40, taskRows.length * rowHeight + 12);
    return Math.max(taskHeight, estimatedHeight);
  };

  // Handle group click
  const handleGroupClick = (group: TaskGroup) => {
    if (onGroupClick) {
      onGroupClick(group);
    }
  };

  const handleChevronClick = (event: React.MouseEvent, groupId: string) => {
    event.stopPropagation();
    onToggleGroupExpand?.(groupId);
  };

  // Only one row can be pressed at a time, so a single long-press timer
  // (keyed by the currently pressed group) covers every tree row.
  const [pressedGroupId, setPressedGroupId] = React.useState<string | null>(null);
  const pressedGroupRef = React.useRef<TaskGroup | null>(null);
  const {
    onTouchStart: startGroupLongPress,
    onTouchMove: clearGroupLongPressMove,
    onTouchEnd: clearGroupLongPressEnd,
    isLongPressing,
  } = useLongPress((event) => {
    const group = pressedGroupRef.current;
    if (group && onGroupContextMenu) {
      onGroupContextMenu(event, group);
    }
  });
  const handleGroupTouchStart = (event: React.TouchEvent, group: TaskGroup) => {
    if (!onGroupContextMenu) return;
    pressedGroupRef.current = group;
    setPressedGroupId(group.id);
    startGroupLongPress(event);
  };
  const handleGroupTouchMove = () => {
    clearGroupLongPressMove();
    setPressedGroupId(null);
  };
  // Suppresses the trailing click after a long press fired, so it doesn't
  // also run the row's own onClick right on top of the context menu that
  // long press just opened.
  const handleGroupTouchEnd = (event: React.TouchEvent) => {
    clearGroupLongPressEnd(event);
    setPressedGroupId(null);
  };

  return (
    <div
      className={`rmg-task-list ${className}`}
      data-rmg-component="task-list"
      style={{
        width: `${normalizedLeftColumnWidth}px`,
        minWidth: `${normalizedLeftColumnWidth}px`,
        maxWidth: `${normalizedLeftColumnWidth}px`,
      }}
    >
      {/* Header - CSS handles the height adjustment based on view mode */}
      <div
        className="rmg-task-list-header"
        data-show-timeline-header={showTimelineHeader}
      >
        {headerLabel}
      </div>

      {/* Task Groups */}
      {validTasks.map((taskGroup) => {
        if (!taskGroup) return null;

        const groupHeight = getGroupHeight(taskGroup);
        const isTreeRow = taskGroup.depth !== undefined;

        if (isTreeRow) {
          const depth = taskGroup.depth ?? 0;
          const isExpanded = Boolean(taskGroup.isExpanded);
          const displayName = taskGroup.name || "Unnamed";

          return (
            <div
              key={`task-group-${taskGroup.id || "unknown"}`}
              className="rmg-task-group rmg-task-group-tree-row"
              style={{ minHeight: `${groupHeight}px` }}
              onClick={() => handleGroupClick(taskGroup)}
              onContextMenu={
                onGroupContextMenu ? (event) => onGroupContextMenu(event, taskGroup) : undefined
              }
              onTouchStart={(event) => handleGroupTouchStart(event, taskGroup)}
              onTouchEnd={handleGroupTouchEnd}
              onTouchMove={handleGroupTouchMove}
              data-testid={`task-group-${taskGroup.id || "unknown"}`}
              data-rmg-component="task-group"
              data-group-id={taskGroup.id}
              data-depth={depth}
              data-expanded={taskGroup.isExpandable ? isExpanded : undefined}
              data-hover-linked={hoveredGroupId === taskGroup.id ? "true" : undefined}
              data-long-pressing={isLongPressing && pressedGroupId === taskGroup.id ? "true" : undefined}
            >
              <div
                className="rmg-task-group-content rmg-task-group-tree-content"
                style={{ paddingLeft: `${depth * TREE_INDENT_PX}px` }}
              >
                {taskGroup.isExpandable ? (
                  <button
                    type="button"
                    className="rmg-task-group-chevron"
                    onClick={(event) => handleChevronClick(event, taskGroup.id)}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                    data-rmg-component="task-group-chevron"
                  >
                    <ChevronIcon expanded={isExpanded} />
                  </button>
                ) : (
                  <span className="rmg-task-group-chevron-spacer" aria-hidden="true" />
                )}

                <OverflowTooltip
                  title={taskGroup.emptyRowLabel
                    ? `${displayName} — ${taskGroup.emptyRowLabel}`
                    : displayName}
                >
                  <span
                    className="rmg-task-group-name rmg-task-group-tree-name"
                    data-rmg-component="task-group-name"
                  >
                    {displayName}
                  </span>
                </OverflowTooltip>
              </div>

              {showTaskCount && taskGroup.tasks && taskGroup.tasks.length > 0 && (
                <div
                  className="rmg-task-group-count"
                  data-rmg-component="task-group-count"
                >
                  {taskGroup.tasks.length}{" "}
                  {taskGroup.tasks.length === 1 ? "task" : "tasks"}
                </div>
              )}

              {onGroupContextMenu && (
                <ContextMenuIndicator
                  label={contextMenuLabel}
                  tabIndex={-1}
                  onClick={(event) => onGroupContextMenu(event, taskGroup)}
                  sx={{ position: "absolute", top: "50%", right: 4, transform: "translateY(-50%)" }}
                />
              )}
            </div>
          );
        }

        const hierarchyLevels = getHierarchyLevels(taskGroup);
        const hasHierarchy = Boolean(hierarchyLevels);
        const fullLabelTitle = (
          taskGroup.name ||
          hierarchyLevels?.join(" / ") ||
          "Unnamed"
        ).trim();

        return (
          <div
            key={`task-group-${taskGroup.id || "unknown"}`}
            className="rmg-task-group"
            style={{ minHeight: `${groupHeight}px` }}
            onClick={() => handleGroupClick(taskGroup)}
            data-testid={`task-group-${taskGroup.id || "unknown"}`}
            data-rmg-component="task-group"
            data-group-id={taskGroup.id}
          >
            <div className="rmg-task-group-content">
              {hasHierarchy ? (
                <div
                  className="rmg-task-group-hierarchy"
                  data-rmg-component="task-group-hierarchy"
                >
                  {hierarchyLevels?.map((level, index) => (
                    <OverflowTooltip key={`task-group-${taskGroup.id}-level-${index}`} title={fullLabelTitle || level}>
                      <div
                        className={`rmg-task-group-level rmg-task-group-level-depth-${index}`}
                        data-rmg-component={
                          index === hierarchyLevels.length - 1
                            ? "task-group-name"
                            : undefined
                        }
                      >
                        {level}
                      </div>
                    </OverflowTooltip>
                  ))}
                </div>
              ) : (
                <OverflowTooltip title={fullLabelTitle}>
                  <div
                    className="rmg-task-group-name"
                    data-rmg-component="task-group-name"
                  >
                    {taskGroup.name || "Unnamed"}
                  </div>
                </OverflowTooltip>
              )}
            </div>

            {/* Description (if available and enabled) */}
            {showDescription && taskGroup.description && !hasHierarchy && (
              <OverflowTooltip title={taskGroup.description}>
                <div
                  className="rmg-task-group-description"
                  data-rmg-component="task-group-description"
                >
                  {taskGroup.description}
                </div>
              </OverflowTooltip>
            )}

            {/* Task count (if enabled) */}
            {showTaskCount && taskGroup.tasks && taskGroup.tasks.length > 0 && (
              <div
                className="rmg-task-group-count"
                data-rmg-component="task-group-count"
              >
                {taskGroup.tasks.length}{" "}
                {taskGroup.tasks.length === 1 ? "task" : "tasks"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(TaskList);
