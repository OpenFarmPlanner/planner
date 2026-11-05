import { addDays, format, startOfWeek } from 'date-fns';
import type { Task } from '../../api/types';

export const BOARD_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type BoardStatus = typeof BOARD_STATUSES[number];
export type TaskPeriod = 'all' | 'overdue' | 'today' | 'week' | 'custom';
export interface TaskFilters {
  period: TaskPeriod;
  from: string;
  to: string;
  crop: string;
  field: string;
  person: string;
}
export const EMPTY_TASK_FILTERS: TaskFilters = {
  period: 'all', from: '', to: '', crop: '', field: '', person: '',
};

export function isBoardStatus(value: unknown): value is BoardStatus {
  return BOARD_STATUSES.some((status) => status === value);
}

export function taskDateBounds(today: Date) {
  return {
    today: format(today, 'yyyy-MM-dd'),
    weekStart: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    weekEnd: format(addDays(startOfWeek(today, { weekStartsOn: 1 }), 6), 'yyyy-MM-dd'),
  };
}

export function taskMatchesFilters(
  task: Task, filters: TaskFilters, fieldId: number | undefined,
  bounds: ReturnType<typeof taskDateBounds>,
): boolean {
  if (!isBoardStatus(task.status)) return false;
  if (filters.crop && String(task.crop) !== filters.crop) return false;
  if (filters.field && String(fieldId) !== filters.field) return false;
  if (filters.person && String(task.assigned_to) !== filters.person) return false;
  const date = task.due_date;
  if (filters.period === 'overdue') {
    return task.status !== 'completed' && date !== null && date < bounds.today;
  }
  if (filters.period === 'today') return date === bounds.today;
  if (filters.period === 'week') {
    return date !== null && date >= bounds.weekStart && date <= bounds.weekEnd;
  }
  if (filters.period === 'custom') {
    if (!date) return !filters.from && !filters.to;
    return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  }
  return true;
}

export function taskMetrics(tasks: Task[], bounds: ReturnType<typeof taskDateBounds>) {
  const open = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress');
  return {
    overdue: open.filter((task) => task.due_date && task.due_date < bounds.today).length,
    today: open.filter((task) => task.due_date === bounds.today).length,
    week: open.filter((task) => task.due_date && task.due_date >= bounds.weekStart
      && task.due_date <= bounds.weekEnd).length,
  };
}
