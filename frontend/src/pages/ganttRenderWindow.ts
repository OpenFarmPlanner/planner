import type { GanttTaskGroup } from './ganttChartUtils';

export const GANTT_ESTIMATED_ROW_HEIGHT = 72;
export const GANTT_OVERSCAN_ROWS = 5;
export const GANTT_MAX_RENDERED_TASKS = 500;

type GanttRowHeightGetter = (group: GanttTaskGroup, index: number) => number;

export interface GanttRenderWindow {
  groups: GanttTaskGroup[];
  startIndex: number;
  endIndex: number;
  /** Offset of the first rendered row from the top of the first row. */
  startOffset: number;
  totalHeight: number;
}

export function getGanttRenderWindow(
  taskGroups: GanttTaskGroup[],
  scrollTop: number,
  viewportHeight: number,
  getRowHeight?: GanttRowHeightGetter,
): GanttRenderWindow {
  if (taskGroups.length === 0) {
    return {
      groups: [],
      startIndex: 0,
      endIndex: 0,
      startOffset: 0,
      totalHeight: 0,
    };
  }

  const rowHeights = taskGroups.map((group, index) => {
    const rowHeight = getRowHeight?.(group, index) ?? GANTT_ESTIMATED_ROW_HEIGHT;
    return Number.isFinite(rowHeight) && rowHeight > 0
      ? rowHeight
      : GANTT_ESTIMATED_ROW_HEIGHT;
  });
  const rowOffsets: number[] = [];
  let totalHeight = 0;
  rowHeights.forEach((rowHeight) => {
    rowOffsets.push(totalHeight);
    totalHeight += rowHeight;
  });

  const normalizedScrollTop = Math.max(0, scrollTop);
  const viewportBottom = normalizedScrollTop + Math.max(1, viewportHeight);
  let firstVisibleIndex = rowOffsets.findIndex((offset, index) => (
    offset + rowHeights[index] > normalizedScrollTop
  ));
  if (firstVisibleIndex === -1) {
    firstVisibleIndex = taskGroups.length - 1;
  }

  let firstHiddenAfterViewport = firstVisibleIndex + 1;
  while (
    firstHiddenAfterViewport < taskGroups.length
    && rowOffsets[firstHiddenAfterViewport] < viewportBottom
  ) {
    firstHiddenAfterViewport += 1;
  }

  const startIndex = Math.max(0, firstVisibleIndex - GANTT_OVERSCAN_ROWS);
  const targetEndIndex = Math.min(
    taskGroups.length,
    firstHiddenAfterViewport + GANTT_OVERSCAN_ROWS,
  );

  const groups: GanttTaskGroup[] = [];
  let renderedTaskCount = 0;
  let endIndex = startIndex;

  for (let index = startIndex; index < targetEndIndex; index += 1) {
    const group = taskGroups[index];
    if (!group) {
      continue;
    }
    if (
      groups.length > 0
      && renderedTaskCount + group.tasks.length > GANTT_MAX_RENDERED_TASKS
    ) {
      break;
    }
    groups.push(group);
    renderedTaskCount += group.tasks.length;
    endIndex = index + 1;
  }

  if (groups.length === 0) {
    groups.push(taskGroups[startIndex]);
    endIndex = startIndex + 1;
  }

  return {
    groups,
    startIndex,
    endIndex,
    startOffset: rowOffsets[startIndex] ?? 0,
    totalHeight,
  };
}
