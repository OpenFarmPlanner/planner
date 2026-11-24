import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePlantingPlanDateMode } from '../planting-plans/usePlantingPlanDateMode';

const firstKey = 'plantingPlans:dateMode:user:101';
const secondKey = 'plantingPlans:dateMode:user:202';

afterEach(() => localStorage.clear());

describe('usePlantingPlanDateMode', () => {
  it('defaults to planned and stores only an explicit choice for the signed-in user', () => {
    const { result, rerender, unmount } = renderHook(
      ({ userId }: { userId: number | null }) => usePlantingPlanDateMode(userId),
      { initialProps: { userId: 101 } },
    );

    expect(result.current[0]).toBe('planned');
    expect(localStorage.getItem(firstKey)).toBeNull();

    act(() => result.current[1]('actual'));
    expect(localStorage.getItem(firstKey)).toBe('actual');
    rerender({ userId: null });
    expect(result.current[0]).toBe('planned');
    rerender({ userId: 202 });
    expect(result.current[0]).toBe('planned');
    expect(localStorage.getItem(secondKey)).toBeNull();

    rerender({ userId: 101 });
    expect(result.current[0]).toBe('actual');
    act(() => result.current[1]('combined'));
    unmount();

    const reopened = renderHook(() => usePlantingPlanDateMode(101));
    expect(reopened.result.current[0]).toBe('combined');
  });

  it('ignores an unrecognized saved value', () => {
    localStorage.setItem(firstKey, 'invalid');
    const { result } = renderHook(() => usePlantingPlanDateMode(101));
    expect(result.current[0]).toBe('planned');
  });
});
