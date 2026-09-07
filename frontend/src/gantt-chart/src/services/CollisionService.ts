import { type Task, ViewMode } from "../types";
import { packIntoNonOverlappingRows } from "../utils/rowPacking";

const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

function hasValidTaskDates(task: Task): boolean {
  return (
    task.startDate instanceof Date &&
    task.endDate instanceof Date &&
    !Number.isNaN(task.startDate.getTime()) &&
    !Number.isNaN(task.endDate.getTime())
  );
}

/**
 * Service for detecting and resolving task collisions/overlaps
 * Used for arranging tasks in rows to prevent visual overlapping
 */
export class CollisionService {
  /**
   * Detects overlapping tasks and organizes them into rows
   * Using precise visual overlap detection
   */
  public static detectOverlaps(
    tasks: Task[],
    viewMode: ViewMode = ViewMode.MONTH,
  ): Task[][] {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return [];
    }

    // Sort tasks by start date to optimize row placement
    const sortedTasks = [...tasks].sort((a, b) => {
      if (!a.startDate || !b.startDate) return 0;
      return a.startDate.getTime() - b.startDate.getTime();
    });

    return packIntoNonOverlappingRows(
      sortedTasks,
      hasValidTaskDates,
      (task, existingTask) =>
        this.tasksVisuallyOverlap(task, existingTask, viewMode),
    );
  }

  /**
   * Check if tasks visually overlap
   * Uses a more precise algorithm that matches visual representation based on view mode
   */
  public static tasksVisuallyOverlap(
    taskA: Task,
    taskB: Task,
    viewMode: ViewMode = ViewMode.MONTH,
  ): boolean {
    if (
      !taskA.startDate ||
      !taskA.endDate ||
      !taskB.startDate ||
      !taskB.endDate
    ) {
      return false;
    }

    // Get timestamps for comparison
    const startA = taskA.startDate.getTime();
    const endA = taskA.endDate.getTime();
    const startB = taskB.startDate.getTime();
    const endB = taskB.endDate.getTime();

    // Apply a small buffer based on view mode to prevent over-eager collision detection
    const timeBuffer = this.getCollisionBufferByViewMode(viewMode);

    // Check if tasks overlap with appropriate buffer
    return (
      // Check if A overlaps with B (with buffer)
      (startA + timeBuffer < endB - timeBuffer &&
        endA - timeBuffer > startB + timeBuffer) ||
      // Check for very short tasks that might visually overlap due to minimum width
      Math.abs(startA - startB) < timeBuffer * 2 ||
      Math.abs(endA - endB) < timeBuffer * 2
    );
  }

  /**
   * Get appropriate collision buffer based on view mode
   * Smaller buffer for minute/hour view, larger for year view
   */
  private static getCollisionBufferByViewMode(viewMode: ViewMode): number {
    // Define buffers in milliseconds
    const hour = MINUTES_PER_HOUR * MILLISECONDS_PER_MINUTE;
    const day = HOURS_PER_DAY * hour;

    switch (viewMode) {
      case ViewMode.MINUTE:
        return MILLISECONDS_PER_MINUTE / 2; // 30 seconds buffer for minute view
      case ViewMode.HOUR:
        return MILLISECONDS_PER_MINUTE * 15; // 15 minutes buffer for hour view
      case ViewMode.DAY:
        return hour; // 1 hour buffer for day view
      case ViewMode.WEEK:
        return 4 * hour; // 4 hour buffer for week view
      case ViewMode.MONTH:
        return 12 * hour; // 12 hour buffer for month view
      case ViewMode.QUARTER:
        return day; // 1 day buffer for quarter view
      case ViewMode.YEAR:
        return 2 * day; // 2 day buffer for year view
      default:
        return 12 * hour; // Default
    }
  }

  /**
   * Check if a task would collide with any other tasks in the list
   */
  public static wouldCollide(
    task: Task,
    allTasks: Task[],
    viewMode: ViewMode = ViewMode.MONTH,
    excludeTaskId?: string,
  ): boolean {
    return allTasks.some((existingTask) => {
      // Skip self-comparison or excluded task
      if (existingTask.id === task.id || existingTask.id === excludeTaskId) {
        return false;
      }

      // Check visual overlap
      return this.tasksVisuallyOverlap(task, existingTask, viewMode);
    });
  }

  /**
   * Calculates a preview of how tasks would be arranged with an updated task
   */
  public static getPreviewArrangement(
    updatedTask: Task,
    allTasks: Task[],
    viewMode: ViewMode = ViewMode.MONTH,
  ): Task[][] {
    // Create updated tasks array
    const updatedTasks = allTasks.map((task) =>
      task.id === updatedTask.id ? updatedTask : task,
    );

    return this.detectOverlaps(updatedTasks, viewMode);
  }
}
