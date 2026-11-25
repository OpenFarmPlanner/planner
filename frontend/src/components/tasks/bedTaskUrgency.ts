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

export function linkTasksToBeds(tasks: readonly Task[], plans: readonly Pick<PlantingPlan, 'id' | 'bed'>[]) {
  const bedByPlan = new Map(plans.map(plan => [plan.id, plan.bed]));
  const byBed = new Map<number, Task[]>();
  for (const task of tasks) {
    if (task.planting_plan === null || task.status === 'cancelled') continue;
    const bed = bedByPlan.get(task.planting_plan);
    if (bed == null) continue;
    const current = byBed.get(bed);
    if (current) current.push(task);
    else byBed.set(bed, [task]);
  }
  return byBed;
}

export function summarizeBedTasks(tasks: readonly Task[], bounds: ReturnType<typeof bedTaskDateBounds>): BedTaskSummary {
  const counts: Record<BedTaskUrgency, number> = { overdue: 0, upcoming: 0, later: 0, undated: 0, completed: 0 };
  for (const task of tasks) {
    if (task.status === 'completed') counts.completed += 1;
    if (!isOpenTask(task)) continue;
    if (!task.due_date) counts.undated += 1;
    else if (task.due_date < bounds.today) counts.overdue += 1;
    else if (task.due_date <= bounds.upcomingEnd) counts.upcoming += 1;
    else counts.later += 1;
  }
  return {
    urgency: BED_TASK_URGENCIES.find(urgency => counts[urgency] > 0) ?? null,
    outstanding: counts.overdue + counts.upcoming + counts.later + counts.undated,
    undated: counts.undated,
  };
}
