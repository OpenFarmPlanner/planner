import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  countRotationQuickFilters,
  matchesRotationQuickFilter,
} from '../components/planting-plans/rotation/rotationQuickFilters';
import { compareRotationStatus } from '../components/planting-plans/rotation/rotationCopy';
import {
  buildRotationKey,
  useRotationAcceptanceDraft,
} from '../components/planting-plans/rotation/useRotationAcceptanceDraft';

describe('rotation quick filters', () => {
  it('counts each status group and matches rows', () => {
    const counts = countRotationQuickFilters(['conflict', 'conflict', 'accepted', 'info', 'ok', undefined]);

    expect(counts).toEqual({ all: 6, conflicts: 2, accepted: 1, info: 1 });
    expect(matchesRotationQuickFilter('accepted', 'conflicts')).toBe(false);
    expect(matchesRotationQuickFilter('accepted', 'accepted')).toBe(true);
    expect(matchesRotationQuickFilter(undefined, 'all')).toBe(true);
  });

  it('sorts conflicts first', () => {
    const statuses = ['ok', 'info', 'conflict', undefined, 'accepted', 'hint'] as const;
    expect([...statuses].sort(compareRotationStatus)).toEqual(['conflict', 'accepted', 'hint', 'info', 'ok', undefined]);
  });
});

describe('useRotationAcceptanceDraft', () => {
  const key = buildRotationKey('1', '2', '01.04.2026');
  const movedKey = buildRotationKey('1', '3', '01.04.2026');
  const storedPlan = {
    rotation_conflict_accepted: true,
    rotation_conflict_accepted_at: '2026-03-02T10:00:00Z',
    rotation_conflict_accepted_by_user: { id: 1, email: 'a@example.com', display_name: 'Alex', display_label: 'Alex' },
  };

  it('sends nothing for an unchanged stored acceptance', () => {
    const { result } = renderHook(() => useRotationAcceptanceDraft());
    act(() => result.current.resetFromPlan(storedPlan, key));

    expect(result.current.getControls(key).persisted).toEqual({ userLabel: 'Alex', acceptedAt: '2026-03-02T10:00:00Z' });
    expect(result.current.getPayload(key)).toEqual({});
  });

  it('drops the acceptance when bed, crop or date change, like the backend', () => {
    const { result } = renderHook(() => useRotationAcceptanceDraft());
    act(() => result.current.resetFromPlan(storedPlan, key));

    expect(result.current.getControls(movedKey).accepted).toBe(false);
    expect(result.current.getPayload(movedKey)).toEqual({});
  });

  it('sends a new acceptance and a withdrawal explicitly', () => {
    const { result } = renderHook(() => useRotationAcceptanceDraft());
    act(() => result.current.resetFromPlan(null, key));
    act(() => result.current.getControls(movedKey).onChange(true));
    expect(result.current.getPayload(movedKey)).toEqual({ rotation_conflict_accepted: true });

    act(() => result.current.resetFromPlan(storedPlan, key));
    act(() => result.current.getControls(key).onChange(false));
    expect(result.current.getPayload(key)).toEqual({ rotation_conflict_accepted: false });
  });
});
