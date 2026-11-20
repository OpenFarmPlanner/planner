import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { GanttTask, GanttTaskGroup } from '../pages/ganttChartUtils';
import {
  buildGanttContextMenuActions,
  type GanttContextMenuCallbacks,
} from '../pages/ganttContextMenuActions';

const t = ((key: string) => key) as unknown as TFunction;

const makeCallbacks = (): GanttContextMenuCallbacks => ({
  openPlantingPlanFromTask: vi.fn(),
  openCropFromTask: vi.fn(),
  openAreasPage: vi.fn(),
  copyTaskSummary: vi.fn(),
  deletePlantingPlanFromTask: vi.fn(),
  addPlantingPlanForBed: vi.fn(),
});

const task = (overrides: Partial<GanttTask> = {}): GanttTask =>
  (({
    id: 't1',
    name: 'Task',
    startDate: new Date(),
    endDate: new Date(),
    ...overrides
  }) as GanttTask);

const group = (overrides: Partial<GanttTaskGroup> = {}): GanttTaskGroup =>
  (({
    id: 'g1',
    name: 'Group',
    tasks: [],
    ...overrides
  }) as GanttTaskGroup);

describe('buildGanttContextMenuActions - task target', () => {
  it('always offers open-plan, edit, copy, and delete', () => {
    const actions = buildGanttContextMenuActions(
      { type: 'task', task: task(), group: group() },
      makeCallbacks(),
      t,
    );
    expect(actions.map((a) => a.id)).toEqual(['open-plan', 'edit', 'copy', 'delete']);
    expect(actions.find((a) => a.id === 'delete')?.group).toBe('danger');
  });

  it('adds open-crop only when the task has a crop name', () => {
    const withCrop = buildGanttContextMenuActions(
      { type: 'task', task: task({ cropName: 'Tomate' }), group: group() },
      makeCallbacks(),
      t,
    );
    expect(withCrop.map((a) => a.id)).toContain('open-crop');
  });

  it('offers a separate detail action when the task represents a plan', () => {
    const callbacks = makeCallbacks();
    const planTask = task({ plantingPlanId: 42 });
    const actions = buildGanttContextMenuActions({ type: 'task', task: planTask, group: group() }, callbacks, t);

    expect(actions.slice(0, 2).map(action => action.id)).toEqual(['open-plan', 'plan-details']);
    actions[1].onClick();
    expect(callbacks.openPlantingPlanFromTask).toHaveBeenCalledWith(planTask, { details: true });
  });

  it('adds bed/field/location navigation when the group carries those ids', () => {
    const actions = buildGanttContextMenuActions(
      { type: 'task', task: task(), group: group({ bedId: 5, fieldId: 8, locationId: 2 }) },
      makeCallbacks(),
      t,
    );
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(['open-bed', 'open-field', 'open-location']),
    );
  });

  it('delegates onClick to the matching callback', () => {
    const callbacks = makeCallbacks();
    const actions = buildGanttContextMenuActions(
      { type: 'task', task: task({ cropName: 'Tomate' }), group: group() },
      callbacks,
      t,
    );
    actions.find((a) => a.id === 'open-crop')?.onClick();
    expect(callbacks.openCropFromTask).toHaveBeenCalledTimes(1);
    actions.find((a) => a.id === 'edit')?.onClick();
    expect(callbacks.openPlantingPlanFromTask).toHaveBeenCalledWith(expect.anything(), { edit: true });
  });
});

describe('buildGanttContextMenuActions - group target', () => {
  it('returns bed actions (open, edit, add-plan) for a bed group', () => {
    const actions = buildGanttContextMenuActions(
      { type: 'group', group: group({ bedId: 5 }) },
      makeCallbacks(),
      t,
    );
    expect(actions.map((a) => a.id)).toEqual(['open-bed', 'edit-bed', 'add-plan']);
  });

  it('returns field actions for a field group without a bed', () => {
    const actions = buildGanttContextMenuActions(
      { type: 'group', group: group({ fieldId: 8 }) },
      makeCallbacks(),
      t,
    );
    expect(actions.map((a) => a.id)).toEqual(['open-field', 'edit-field']);
  });

  it('returns an empty list for a group with no ids', () => {
    expect(buildGanttContextMenuActions({ type: 'group', group: group() }, makeCallbacks(), t)).toEqual([]);
  });
});
