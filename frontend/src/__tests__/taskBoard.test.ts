import { describe, expect, it } from 'vitest';
import type { Task } from '../api/types';
import { EMPTY_TASK_FILTERS, taskDateBounds, taskMatchesFilters, taskMetrics } from '../components/tasks/taskBoard';

const task = (overrides: Partial<Task> = {}) => ({
  id: 1, status: 'pending', due_date: '2026-11-05', crop: 4, assigned_to: 7,
  ...overrides,
} as Task);
const bounds = taskDateBounds(new Date(2026, 10, 5));

describe('task board filters and metrics', () => {
  it('combines crop, field and person filters without excluding undated tasks by default', () => {
    const filters = { ...EMPTY_TASK_FILTERS, crop: '4', field: '3', person: '7' };
    expect(taskMatchesFilters(task(), filters, 3, bounds)).toBe(true);
    expect(taskMatchesFilters(task(), filters, 2, bounds)).toBe(false);
    expect(taskMatchesFilters(task({ crop: 2 }), filters, 3, bounds)).toBe(false);
    expect(taskMatchesFilters(task({ assigned_to: null }), filters, 3, bounds)).toBe(false);
    expect(taskMatchesFilters(task({ due_date: null }), EMPTY_TASK_FILTERS, undefined, bounds)).toBe(true);
    expect(taskMatchesFilters(task({ assigned_to: null }), { ...EMPTY_TASK_FILTERS, person: 'null' }, undefined, bounds)).toBe(true);
  });

  it('uses inclusive local calendar date bounds and excludes cancelled work', () => {
    const filters = { ...EMPTY_TASK_FILTERS, period: 'custom' as const, from: '2026-11-05', to: '2026-11-05' };
    expect(taskMatchesFilters(task(), filters, undefined, bounds)).toBe(true);
    expect(taskMatchesFilters(task({ due_date: '2026-11-06' }), filters, undefined, bounds)).toBe(false);
    expect(taskMatchesFilters(task({ due_date: null }), filters, undefined, bounds)).toBe(false);
    expect(taskMatchesFilters(task({ status: 'cancelled' }), EMPTY_TASK_FILTERS, undefined, bounds)).toBe(false);
  });

  it('counts only unfinished work in metrics and uses Monday through Sunday for this week', () => {
    expect(bounds).toEqual({ today: '2026-11-05', weekStart: '2026-11-02', weekEnd: '2026-11-08' });
    const tasks = [task(), task({ due_date: '2026-11-01' }), task({ due_date: '2026-11-08' }),
      task({ due_date: null }), task({ status: 'completed' }), task({ status: 'cancelled' })];
    expect(taskMetrics(tasks, bounds)).toEqual({ overdue: 1, today: 1, week: 2 });
    expect(taskMatchesFilters(task({ status: 'completed', due_date: '2026-11-01' }), { ...EMPTY_TASK_FILTERS, period: 'overdue' }, undefined, bounds)).toBe(false);
    expect(taskMatchesFilters(task({ due_date: '2026-11-08' }), { ...EMPTY_TASK_FILTERS, period: 'week' }, undefined, bounds)).toBe(true);
    expect(taskMatchesFilters(task({ due_date: '2026-11-09' }), { ...EMPTY_TASK_FILTERS, period: 'week' }, undefined, bounds)).toBe(false);
  });
});
