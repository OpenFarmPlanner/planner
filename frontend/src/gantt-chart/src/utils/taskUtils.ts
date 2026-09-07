import type { Task } from "../types";
import { packIntoNonOverlappingRows } from "./rowPacking";

function hasValidDateRange(task: Task): boolean {
  return (
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
  return packIntoNonOverlappingRows(tasks, hasValidDateRange, tasksOverlap);
}
