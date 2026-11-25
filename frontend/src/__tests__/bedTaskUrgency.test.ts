import { describe, expect, it } from 'vitest';
import type { Task } from '../api/types';
import { bedTaskDateBounds, linkTasksToBeds, summarizeBedTasks } from '../components/tasks/bedTaskUrgency';

const bounds = bedTaskDateBounds(new Date(2026, 10, 25));

function task(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id, project: 1, season: 4, title: `Task ${id}`, description: '', status: 'pending',
    due_date: null, planting_plan: 40, crop: null, assigned_to: null, field: 10,
    origin: 'manual', calculated_due_date: null, due_date_overridden: false,
    source_key: '', occurrence_index: 0, created_at: '', updated_at: '', ...overrides,
  };
}

describe('bed task urgency', () => {
  it.each([
    ['2026-11-24', 'overdue'], ['2026-11-25', 'upcoming'],
    ['2026-12-02', 'upcoming'], ['2026-12-03', 'later'],
  ])('classifies a task on %s as %s', (due_date, urgency) => {
    const open = task(1, { due_date, status: 'in_progress' });
    expect(summarizeBedTasks([open], bounds)).toEqual({ urgency, outstanding: 1, undated: 0 });
  });

  it('takes the most urgent open task and keeps the count of undated work', () => {
    const overdue = task(1, { due_date: '2026-11-24' });
    const later = task(2, { due_date: '2026-12-04' });
    const undated = task(3);
    const completed = task(4, { status: 'completed' });
    const cancelled = task(5, { status: 'cancelled', due_date: '2026-11-23' });
    expect(summarizeBedTasks([overdue, later, undated, completed, cancelled], bounds))
      .toEqual({ urgency: 'overdue', outstanding: 3, undated: 1 });
    expect(summarizeBedTasks([later, undated, completed, cancelled], bounds).urgency).toBe('later');
    expect(summarizeBedTasks([undated, completed, cancelled], bounds))
      .toEqual({ urgency: 'undated', outstanding: 1, undated: 1 });
    expect(summarizeBedTasks([completed, cancelled], bounds).urgency).toBe('completed');
    expect(summarizeBedTasks([cancelled], bounds).urgency).toBeNull();
  });

  it('joins several plans to their actual beds and excludes missing and parcel-wide links', () => {
    const first = task(1);
    const succession = task(2, { planting_plan: 41 });
    const neighboringBed = task(3, { planting_plan: 42 });
    const unassignedPlan = task(4, { planting_plan: 43 });
    const orphan = task(5, { planting_plan: 99 });
    const parcelOnly = task(6, { planting_plan: null });
    const canceled = task(7, { status: 'cancelled' });
    const plans = [{ id: 40, bed: 27 }, { id: 41, bed: 27 }, { id: 42, bed: 28 }, { id: 43, bed: null }];
    expect(linkTasksToBeds(
      [first, succession, neighboringBed, unassignedPlan, orphan, parcelOnly, canceled], plans,
    )).toEqual(new Map([[27, [first, succession]], [28, [neighboringBed]]]));
    expect(linkTasksToBeds([canceled, orphan, parcelOnly], plans, true)).toEqual(new Map([[27, [canceled]]]));
  });
});
