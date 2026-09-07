import React from "react";
import type { Task, TaskGroup, GanttStyles } from "./core";
import { ViewMode } from "./enums";

export interface TaskListRenderProps {
  tasks: TaskGroup[];
  headerLabel?: React.ReactNode;
  onGroupClick?: (group: TaskGroup) => void;
  onToggleGroupExpand?: (groupId: string) => void;
  viewMode: ViewMode;
  leftColumnWidth?: number;
}

export interface TaskRenderProps {
  task: Task;
  leftPx: number;
  widthPx: number;
  topPx: number;
  isHovered: boolean;
  isDragging: boolean;
  editMode: boolean;
  showProgress?: boolean;
}

export interface TooltipRenderProps {
  task: Task;
  position: { x: number; y: number };
  dragType: "move" | "resize-left" | "resize-right" | null;
  startDate: Date;
  endDate: Date;
  viewMode: ViewMode;
}

export interface GanttLocaleText {
  title?: string;
  resources?: string;
  today?: string;
  actions?: string;
  adjustProgress?: string;
  viewModes?: Partial<Record<ViewMode, string>>;
}

export interface ViewModeSelectorRenderProps {
  activeMode: ViewMode;
  onChange: (mode: ViewMode) => void;
  darkMode: boolean;
  availableModes?: ViewMode[];
  labels?: Partial<Record<ViewMode, string>>;
}

export interface HeaderRenderProps {
  title: string;
  darkMode: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  showViewModeSelector: boolean;
}

export interface TimelineHeaderRenderProps {
  timeUnits: Date[];
  currentUnitIndex: number;
  viewMode: ViewMode;
  locale: string;
  unitWidth: number;
}

export interface TaskColorProps {
  task: Task;
  isHovered: boolean;
  isDragging: boolean;
}

// Component props
export interface GanttChartProps {
  tasks: TaskGroup[];
  startDate?: Date;
  endDate?: Date;
  title?: string;
  currentDate?: Date;
  showCurrentDateMarker?: boolean;
  todayLabel?: string;
  editMode?: boolean; // Global master switch for all editing (default: true)
  allowProgressEdit?: boolean; // Allow progress bar editing (default: true, requires editMode=true)
  allowTaskResize?: boolean; // Allow task resizing (default: true, requires editMode=true)
  allowTaskMove?: boolean; // Allow task movement (default: true, requires editMode=true)
  headerLabel?: React.ReactNode;
  leftColumnWidth?: number;
  showProgress?: boolean;
  darkMode?: boolean;
  locale?: string;
  localeText?: GanttLocaleText;
  styles?: GanttStyles;
  viewMode?: ViewMode;

  // Updated ViewMode configuration
  viewModes?: ViewMode[] | false; // Array of allowed modes, or false to hide selector

  // Timeline header configuration
  showTimelineHeader?: boolean; // Show the hierarchical header (month/year in week view). Default: true

  smoothDragging?: boolean;
  movementThreshold?: number;
  animationSpeed?: number;
  minuteStep?: number; // For minute view granularity (e.g., 5, 10, 15 minutes)

  // Infinite scroll feature
  infiniteScroll?: boolean; // Enable automatic timeline extension
  onTimelineExtend?: (
    direction: "left" | "right",
    newStartDate: Date,
    newEndDate: Date,
  ) => void;

  // Focus mode - automatically scroll to show "now" when switching view modes
  focusMode?: boolean; // Default: true

  // Custom rendering functions
  renderTaskList?: (props: TaskListRenderProps) => React.ReactNode;
  renderTask?: (props: TaskRenderProps) => React.ReactNode;
  renderTooltip?: (props: TooltipRenderProps) => React.ReactNode;
  renderTooltipInPortal?: boolean;
  tooltipOffset?: number;
  renderViewModeSelector?: (
    props: ViewModeSelectorRenderProps,
  ) => React.ReactNode;
  renderHeader?: (props: HeaderRenderProps) => React.ReactNode;
  renderTimelineHeader?: (props: TimelineHeaderRenderProps) => React.ReactNode;
  getTaskColor?: (props: TaskColorProps) => {
    backgroundColor: string;
    borderColor?: string;
    textColor?: string;
  };

  // Event handlers
  onTaskUpdate?: (groupId: string, updatedTask: Task) => void;
  onTaskClick?: (task: Task, group: TaskGroup) => void;
  onTaskSelect?: (task: Task, isSelected: boolean) => void;
  onTaskDoubleClick?: (task: Task, group: TaskGroup) => void;
  onTaskContextMenu?: (
    event: React.MouseEvent | React.TouchEvent,
    task: Task,
    group: TaskGroup,
  ) => void;
  onGroupClick?: (group: TaskGroup) => void;
  onGroupContextMenu?: (
    event: React.MouseEvent | React.TouchEvent,
    group: TaskGroup,
  ) => void;
  onToggleGroupExpand?: (groupId: string) => void;
  onViewModeChange?: (viewMode: ViewMode) => void;

  // Visual customization
  fontSize?: string;
  rowHeight?: number;
  timeStep?: number;
  unitWidth?: number;
  maxHeight?: string | number; // Max height for the chart body (enables vertical scrolling with sticky headers)
}
export interface TaskRowProps {
  taskGroup: TaskGroup;
  startDate: Date;
  endDate: Date;
  totalMonths: number;
  monthWidth: number;
  editMode?: boolean; // Global master switch
  allowProgressEdit?: boolean; // Allow progress editing
  allowTaskResize?: boolean; // Allow task resizing
  allowTaskMove?: boolean; // Allow task movement
  showProgress?: boolean;
  contextMenuLabel?: string;
  progressHandleLabel?: string;
  className?: string;
  tooltipClassName?: string;
  smoothDragging?: boolean;
  movementThreshold?: number;
  animationSpeed?: number;
  onTaskUpdate?: (groupId: string, updatedTask: Task) => void;
  onTaskClick?: (task: Task, group: TaskGroup) => void;
  onTaskSelect?: (task: Task, isSelected: boolean) => void;
  onTaskDoubleClick?: (task: Task, group: TaskGroup) => void;
  onTaskContextMenu?: (
    event: React.MouseEvent | React.TouchEvent,
    task: Task,
    group: TaskGroup,
  ) => void;
  onGroupContextMenu?: (
    event: React.MouseEvent | React.TouchEvent,
    group: TaskGroup,
  ) => void;
  onGroupHoverChange?: (groupId: string, isHovering: boolean) => void;
  onAutoScrollChange?: (isScrolling: boolean) => void;
  viewMode?: ViewMode;
  rowHeight?: number;
  leftColumnWidth?: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;

  // NEW: Infinite scroll support
  infiniteScroll?: boolean;
  onTimelineExtend?: (direction: "left" | "right") => void;

  // Custom render functions
  renderTask?: (props: TaskRenderProps) => React.ReactNode;
  renderTooltip?: (props: TooltipRenderProps) => React.ReactNode;
  renderTooltipInPortal?: boolean;
  tooltipOffset?: number;
  getTaskColor?: (props: TaskColorProps) => {
    backgroundColor: string;
    borderColor?: string;
    textColor?: string;
  };
}

export interface TaskListProps {
  tasks: TaskGroup[];
  headerLabel?: React.ReactNode;
  contextMenuLabel?: string;
  showTaskCount?: boolean;
  showDescription?: boolean;
  rowHeight?: number;
  className?: string;
  onGroupClick?: (group: TaskGroup) => void;
  onGroupContextMenu?: (
    event: React.MouseEvent | React.TouchEvent,
    group: TaskGroup,
  ) => void;
  onToggleGroupExpand?: (groupId: string) => void;
  hoveredGroupId?: string | null;
  viewMode?: ViewMode;
  showTimelineHeader?: boolean; // Pass through for styling adjustments
  leftColumnWidth?: number;
}

export interface TimelineProps {
  months: Date[];
  currentMonthIndex: number;
  locale?: string;
  className?: string;
  viewMode?: ViewMode;
  unitWidth?: number;
  showTimelineHeader?: boolean; // Show the hierarchical header (month/year). Default: true
}

export interface TaskItemProps {
  task: Task;
  leftPx: number;
  widthPx: number;
  topPx: number;
  isHovered: boolean;
  isDragging: boolean;
  editMode: boolean;
  allowProgressEdit?: boolean; // Allow progress editing
  allowTaskResize?: boolean; // Allow task resizing
  allowTaskMove?: boolean; // Allow task movement
  showProgress?: boolean;
  contextMenuLabel?: string;
  progressHandleLabel?: string;
  instanceId: string;
  className?: string;
  getTaskColor?: (props: TaskColorProps) => {
    backgroundColor: string;
    borderColor?: string;
    textColor?: string;
  };
  renderTask?: (props: TaskRenderProps) => React.ReactNode;
  onMouseDown: (
    event: React.MouseEvent,
    task: Task,
    type: "move" | "resize-left" | "resize-right",
  ) => void;
  onMouseEnter: (event: React.MouseEvent, task: Task) => void;
  onMouseLeave: () => void;
  onClick: (event: React.MouseEvent, task: Task) => void;
  onDoubleClick?: (event: React.MouseEvent, task: Task) => void;
  onContextMenu?: (event: React.MouseEvent | React.TouchEvent, task: Task) => void;
  onProgressUpdate?: (task: Task, newPercent: number) => void;
}

export interface TooltipProps {
  task: Task;
  position: { x: number; y: number };
  dragType: "move" | "resize-left" | "resize-right" | null;
  taskId?: string;
  startDate: Date;
  endDate: Date;
  totalMonths: number;
  monthWidth: number;
  showProgress?: boolean;
  instanceId: string;
  className?: string;
  viewMode?: ViewMode;
  renderTooltip?: (props: TooltipRenderProps) => React.ReactNode;
  renderTooltipInPortal?: boolean;
  tooltipOffset?: number;
}

export interface TodayMarkerProps {
  currentMonthIndex: number;
  height: number;
  label?: string;
  dayOfMonth?: number;
  className?: string;
  markerClass?: string;
  viewMode?: ViewMode;
  unitWidth?: number;
}

// Interaction states for custom hooks
export interface TaskInteraction {
  draggingTask: Task | null;
  dragType: "move" | "resize-left" | "resize-right" | null;
  dragStartX: number;
  hoveredTask: Task | null;
  tooltipPosition: { x: number; y: number };
  previewTask: Task | null;
}
