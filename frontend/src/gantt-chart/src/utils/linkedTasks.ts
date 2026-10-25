import type { Task } from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Tasks in the same row that share the given task's `linkGroupId`,
 * excluding the task itself.
 */
export function getLinkedTasks(task: Task, rowTasks: Task[]): Task[] {
  if (!task.linkGroupId) return [];
  return rowTasks.filter(
    (candidate) =>
      candidate.id !== task.id && candidate.linkGroupId === task.linkGroupId,
  );
}

/**
 * Whole days between two instants, rounded so that a time-of-day or
 * time-zone offset below half a day does not count as a day.
 */
export function getDayDelta(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Shifts a task by whole 24-hour days, keeping its duration unchanged. Exact
 * for date-only values stored as UTC midnight, which is how callers persist
 * calendar dates.
 */
export function shiftTaskByDays(task: Task, days: number): Task {
  const offset = days * MS_PER_DAY;
  return {
    ...task,
    startDate: new Date(task.startDate.getTime() + offset),
    endDate: new Date(task.endDate.getTime() + offset),
  };
}

/**
 * Preview of a "move" drag: the dragged task keeps its original duration and
 * every linked task shifts by the same number of days, so the whole unit
 * renders exactly where the drop will place it. The dragged task comes first.
 */
export function buildMovePreviewTasks(
  originalTask: Task,
  previewStartDate: Date,
  rowTasks: Task[],
): Task[] {
  const dayDelta = getDayDelta(originalTask.startDate, previewStartDate);
  return [
    shiftTaskByDays(originalTask, dayDelta),
    ...getLinkedTasks(originalTask, rowTasks).map((task) =>
      shiftTaskByDays(task, dayDelta),
    ),
  ];
}
