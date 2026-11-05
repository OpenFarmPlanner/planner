import { describe, expect, it } from 'vitest';
import type { Task } from '../api/types';
import { taskDisplayTitle } from '../components/tasks/taskTitles';

describe('automatic task titles', () => {
  const task = {
    origin: 'automatic', title: 'Start propagation',
    source_key: 'plan:42:event:propagation_start',
  } as Task;
  it('localizes only canonical generated titles', () => {
    expect(taskDisplayTitle(task, (key) => `translated:${key}`)).toBe('translated:dashboard:events.propagation_start');
    expect(taskDisplayTitle({ ...task, title: 'My own title' }, () => 'translated')).toBe('My own title');
    expect(taskDisplayTitle({ ...task, origin: 'manual' }, () => 'translated')).toBe('Start propagation');
    expect(taskDisplayTitle({ ...task, source_key: 'external' }, () => 'translated')).toBe('Start propagation');
  });
});
