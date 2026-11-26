import { addDays } from 'date-fns';
import type { PlantingPlan, Task } from '../../api/types';
import { formatDateToAPI } from '../../utils/isoDate';
import { isOpenTask } from './taskBoard';

export const BED_TASK_URGENCIES = ['overdue', 'upcoming', 'later', 'undated', 'completed'] as const;
export type BedTaskUrgency = typeof BED_TASK_URGENCIES[number];

export function bedTaskUrgencyLabel(urgency: BedTaskUrgency, t: (key: string) => string): string {
  return t(urgency === 'overdue' ? 'dashboard:board.metrics.overdue' : `fields:graphical.taskLayer.urgency.${urgency}`);
}

export interface BedTaskSummary {
  urgency: BedTaskUrgency | null;
  outstanding: number;
  undated: number;
}

export function bedTaskDateBounds(today: Date) {
  return { today: formatDateToAPI(today), upcomingEnd: formatDateToAPI(addDays(today, 7)) };
}

export function bedTaskDueUrgency(dueDate: Task['due_date'], bounds: ReturnType<typeof bedTaskDateBounds>) {
  if (!dueDate) return 'undated';
  if (dueDate < bounds.today) return 'overdue';
  return dueDate <= bounds.upcomingEnd ? 'upcoming' : 'later';
}

export function linkTasksToBeds(
  tasks: readonly Task[], plans: readonly Pick<PlantingPlan, 'id' | 'bed'>[], includeCancelled = false,
) {
  const bedByPlan = new Map(plans.map(plan => [plan.id, plan.bed]));
  const byBed = new Map<number, Task[]>();
  for (const task of tasks) {
    if (task.planting_plan === null || (!includeCancelled && task.status === 'cancelled')) continue;
    const bed = bedByPlan.get(task.planting_plan);
    if (bed == null) continue;
    const current = byBed.get(bed);
    if (current) current.push(task);
    else byBed.set(bed, [task]);
  }
  return byBed;
}

export function linkTasksToPlans(tasks: readonly Task[], includeCancelled = false) {
  const byPlan = new Map<number, Task[]>();
  for (const task of tasks) {
    const plan = task.planting_plan;
    if (plan === null || (!includeCancelled && task.status === 'cancelled')) continue;
    const current = byPlan.get(plan);
    if (current) current.push(task);
    else byPlan.set(plan, [task]);
  }
  return byPlan;
}

export function summarizeBedTasks(tasks: readonly Task[], bounds: ReturnType<typeof bedTaskDateBounds>): BedTaskSummary {
  const counts: Record<BedTaskUrgency, number> = { overdue: 0, upcoming: 0, later: 0, undated: 0, completed: 0 };
  for (const task of tasks) {
    if (task.status === 'completed') counts.completed += 1;
    if (!isOpenTask(task)) continue;
    counts[bedTaskDueUrgency(task.due_date, bounds)] += 1;
  }
  return {
    urgency: BED_TASK_URGENCIES.find(urgency => counts[urgency] > 0) ?? null,
    outstanding: counts.overdue + counts.upcoming + counts.later + counts.undated,
    undated: counts.undated,
  };
}

export function orderBedTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.due_date === b.due_date) return a.id - b.id;
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}
