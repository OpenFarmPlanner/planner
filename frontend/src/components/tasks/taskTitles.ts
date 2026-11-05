import type { Task } from '../../api/types';

const EVENT_TITLES: Record<string, string> = {
  propagation_start: 'Start propagation', sowing: 'Direct sowing', planting: 'Transplant',
  harvest_start: 'Start harvesting', harvest_end: 'Finish harvesting',
};

export function taskDisplayTitle(task: Task, translate: (key: string) => string): string {
  const event = /^plan:\d+:event:(propagation_start|sowing|planting|harvest_start|harvest_end)$/.exec(task.source_key ?? '')?.[1];
  if (task.origin === 'automatic' && event && task.title === EVENT_TITLES[event]) {
    return translate(`dashboard:events.${event}`);
  }
  return task.title;
}
