import type { Task } from "../types";
import { packIntoNonOverlappingRows } from "./rowPacking";

/**
 * Accepts only tasks that carry a usable date range. Callers receive task
 * lists from untyped runtime data, so malformed entries are rejected here
 * rather than trusted from the `Task` type alone.
 */
export function hasValidTaskDates(task: Task): boolean {
  return (
    task != null &&
    task.startDate instanceof Date &&
    task.endDate instanceof Date &&
    !Number.isNaN(task.startDate.getTime()) &&
    !Number.isNaN(task.endDate.getTime())
  );
}

function tasksOverlap(task: Task, existingTask: Task): boolean {
  return !(
    task.startDate >= existingTask.endDate ||
    task.endDate <= existingTask.startDate
  );
}

/**
 * Detects task overlaps and organizes them into rows
 */
export function detectTaskOverlaps(tasks: Task[]): Task[][] {
  if (!Array.isArray(tasks)) {
    return [];
  }
  return packIntoNonOverlappingRows(tasks, hasValidTaskDates, tasksOverlap);
}
