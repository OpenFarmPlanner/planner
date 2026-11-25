import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlantingPlan, Season } from '../api/types';
import { getDirectlyDraggableStemPlans, useIndividualPlants } from '../pages/useIndividualPlants';

const { listMock, saveMock } = vi.hoisted(() => ({ listMock: vi.fn(), saveMock: vi.fn() }));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    plantingPlanAPI: { ...actual.plantingPlanAPI, listIndividualAtLocation: listMock, saveIndividualPlacement: saveMock },
  };
});

const season = { id: 3, start_date: '2026-01-01', end_date: '2026-12-31' } as Season;
const plan = (overrides: Partial<PlantingPlan> = {}) => ({
  id: 7, parcel: 11, updated_at: '2026-05-01T10:00:00Z',
  individual_positions: [{ id: 'a', x_m: 1, y_m: 1 }, { id: 'b', x_m: 2, y_m: 3 }],
  ...overrides,
}) as PlantingPlan;
const conflict = () => new AxiosError('conflict', '409', undefined, undefined, {
  status: 409, statusText: 'Conflict', data: {}, headers: {}, config: { headers: new AxiosHeaders() },
});

describe('useIndividualPlants direct stem moves (#1579)', () => {
  beforeEach(() => {
    listMock.mockReset();
    saveMock.mockReset();
  });

  it('saves a moved stem with the plan version and keeps the other stems', async () => {
    listMock.mockResolvedValue({ results: [plan()] });
    saveMock.mockImplementation((_id, _version, data) => Promise.resolve({
      data: plan({ updated_at: '2026-05-01T10:05:00Z', individual_positions: data.individual_positions }),
    }));
    const { result } = renderHook(() => useIndividualPlants(5, season, true));
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    await act(async () => { await result.current.moveSavedStem(7, 'b', { x_m: 4, y_m: 5 }); });

    expect(saveMock).toHaveBeenCalledWith(7, '2026-05-01T10:00:00Z', {
      individual_positions: [{ id: 'a', x_m: 1, y_m: 1 }, { id: 'b', x_m: 4, y_m: 5 }],
    });
    expect(result.current.plans[0].individual_positions?.[1]).toMatchObject({ x_m: 4, y_m: 5 });
    expect(result.current.moveError).toBe(false);
  });

  it('reloads a plan that changed elsewhere instead of retrying with its stale version', async () => {
    listMock.mockResolvedValueOnce({ results: [plan()] })
      .mockResolvedValueOnce({ results: [plan({ updated_at: '2026-05-01T11:00:00Z' })] });
    saveMock.mockRejectedValueOnce(conflict());
    const { result } = renderHook(() => useIndividualPlants(5, season, true));
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    await act(async () => { await result.current.moveSavedStem(7, 'b', { x_m: 4, y_m: 5 }); });

    expect(result.current.moveError).toBe(true);
    await waitFor(() => expect(result.current.plans[0]?.updated_at).toBe('2026-05-01T11:00:00Z'));
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(result.current.plans[0].individual_positions?.[1]).toMatchObject({ x_m: 2, y_m: 3 });
  });

  it('restores the stem after another failure without reloading', async () => {
    listMock.mockResolvedValue({ results: [plan()] });
    saveMock.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useIndividualPlants(5, season, true));
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    await act(async () => { await result.current.moveSavedStem(7, 'b', { x_m: 4, y_m: 5 }); });

    expect(result.current.moveError).toBe(true);
    expect(result.current.plans[0].individual_positions?.[1]).toMatchObject({ x_m: 2, y_m: 3 });
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('does not write a superseded move into a plan loaded again after switching locations', async () => {
    let failSave: (reason: unknown) => void = () => undefined;
    listMock.mockImplementation((location: number) => Promise.resolve({
      results: location === 5 ? [plan({ updated_at: `v${listMock.mock.calls.length}` })] : [],
    }));
    saveMock.mockReturnValueOnce(new Promise((_resolve, reject) => { failSave = reject; }));
    const { result, rerender } = renderHook(({ location }) => useIndividualPlants(location, season, true), {
      initialProps: { location: 5 },
    });
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    let move: Promise<void> = Promise.resolve();
    act(() => { move = result.current.moveSavedStem(7, 'b', { x_m: 4, y_m: 5 }); });
    rerender({ location: 6 });
    await waitFor(() => expect(result.current.plans).toHaveLength(0));
    rerender({ location: 5 });
    await waitFor(() => expect(result.current.plans[0]?.updated_at).toBe('v3'));
    await act(async () => { failSave(new Error('offline')); await move; });

    expect(result.current.plans[0]).toMatchObject({ updated_at: 'v3' });
    expect(result.current.plans[0].individual_positions?.[1]).toMatchObject({ x_m: 2, y_m: 3 });
  });

  it('neither reports nor refreshes a conflict from a location the user has left', async () => {
    let failSave: (reason: unknown) => void = () => undefined;
    listMock.mockImplementation((location: number) => Promise.resolve({ results: location === 5 ? [plan()] : [] }));
    saveMock.mockReturnValueOnce(new Promise((_resolve, reject) => { failSave = reject; }));
    const { result, rerender } = renderHook(({ location }) => useIndividualPlants(location, season, true), {
      initialProps: { location: 5 },
    });
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    let move: Promise<void> = Promise.resolve();
    act(() => { move = result.current.moveSavedStem(7, 'b', { x_m: 4, y_m: 5 }); });
    rerender({ location: 6 });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    await act(async () => { failSave(conflict()); await move; });

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(result.current.moveError).toBe(false);
    rerender({ location: 5 });
    await waitFor(() => expect(result.current.plans).toHaveLength(1));
    expect(result.current.moveError).toBe(false);
  });

  it('does not start a panel draft for a plan whose direct move is still saving', async () => {
    let finishSave: (value: { data: PlantingPlan }) => void = () => undefined;
    listMock.mockResolvedValue({ results: [plan()] });
    saveMock.mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve; }));
    const { result } = renderHook(() => useIndividualPlants(5, season, true));
    await waitFor(() => expect(result.current.plans).toHaveLength(1));

    let move: Promise<void> = Promise.resolve();
    act(() => { move = result.current.moveSavedStem(7, 'b', { x_m: 4, y_m: 5 }); });
    act(() => { result.current.startDraft(11, result.current.plans[0]); });
    expect(result.current.editor.draft).toBeNull();

    await act(async () => { finishSave({ data: plan({ updated_at: 'v2' }) }); await move; });
    act(() => { result.current.startDraft(11, result.current.plans[0]); });
    expect(result.current.editor.draft).toMatchObject({ planId: 7, expectedUpdatedAt: 'v2' });
  });

  it('keeps plans with an open panel draft, a pending move or no edit right out of direct dragging', () => {
    const plans = [plan({ id: 7 }), plan({ id: 8 }), plan({ id: 9 })];
    const base = { canEdit: true, plans, movingPlans: new Set([8]), editor: { draft: { planId: 9 } } };

    expect([...getDirectlyDraggableStemPlans(base as never)]).toEqual([7]);
    expect([...getDirectlyDraggableStemPlans({ ...base, canEdit: false } as never)]).toEqual([]);
  });
});
