import type { RotationStatus } from '../../../api/types';

export type RotationQuickFilter = 'all' | 'conflicts' | 'accepted' | 'info';

export const ROTATION_QUICK_FILTERS: readonly RotationQuickFilter[] = ['all', 'conflicts', 'accepted', 'info'];

const STATUS_BY_FILTER: Record<Exclude<RotationQuickFilter, 'all'>, RotationStatus> = {
  conflicts: 'conflict',
  accepted: 'accepted',
  info: 'info',
};

export const matchesRotationQuickFilter = (
  status: RotationStatus | undefined,
  filter: RotationQuickFilter,
): boolean => filter === 'all' || status === STATUS_BY_FILTER[filter];

export const countRotationQuickFilters = (
  statuses: readonly (RotationStatus | undefined)[],
): Record<RotationQuickFilter, number> => {
  const counts: Record<RotationQuickFilter, number> = { all: statuses.length, conflicts: 0, accepted: 0, info: 0 };
  for (const status of statuses) {
    if (status === 'conflict') {
      counts.conflicts += 1;
    } else if (status === 'accepted') {
      counts.accepted += 1;
    } else if (status === 'info') {
      counts.info += 1;
    }
  }
  return counts;
};
