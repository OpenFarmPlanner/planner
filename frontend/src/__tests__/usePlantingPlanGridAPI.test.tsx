import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { plantingPlanAPI } from '../api/api';
import type { HarvestOverlap, PlantingPlan } from '../api/types';
import type { PlantingPlanRow } from '../pages/plantingPlansUtils';
import { usePlantingPlanGridAPI } from '../planting-plans/usePlantingPlanGridAPI';

vi.mock('../api/api', () => ({
  plantingPlanAPI: {
    listAll: vi.fn(),
    listForArea: vi.fn(),
    update: vi.fn(),
    patch: vi.fn(),
  },
}));

const overlap: HarvestOverlap = {
  role: 'predecessor', other_plan_id: 1, other_crop_label: 'Salat', date: '2026-07-01',
};
const plan = (id: number, bed: number, harvest_overlaps: HarvestOverlap[] = []): PlantingPlanRow => ({
  id, bed, crop: 1, planting_date: '2026-05-01', harvest_overlaps,
});
const page = (results: PlantingPlan[]) => ({ results, count: results.length, next: null, previous: null });
const response = (data: PlantingPlan): Awaited<ReturnType<typeof plantingPlanAPI.update>> => (
  { data } as Awaited<ReturnType<typeof plantingPlanAPI.update>>
);

const defer = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
};

describe('Planting Plans bed-scoped overlap updates', () => {
  beforeEach(() => vi.resetAllMocks());

  it('refreshes both beds after a move, removing old warnings and adding new ones without reloading the table', async () => {
    const moving = plan(1, 10);
    const previousNeighbour = plan(2, 10, [overlap]);
    const nextNeighbour = plan(3, 11);
    const otherBed = plan(4, 12, [overlap]);
    vi.mocked(plantingPlanAPI.listAll).mockResolvedValue(page([moving, previousNeighbour, nextNeighbour, otherBed]));
    const moved = plan(1, 11);
    vi.mocked(plantingPlanAPI.update).mockResolvedValue(response(moved));
    vi.mocked(plantingPlanAPI.listForArea).mockImplementation(async (_kind, bed) => page(
      bed === 10 ? [plan(2, 10)] : [moved, plan(3, 11, [overlap])],
    ));

    const { result } = renderHook(() => usePlantingPlanGridAPI('project:season'));
    await act(() => result.current.api.list().then(() => undefined));
    await act(() => result.current.api.update(moving.id, { bed: 11 }).then(() => undefined));

    expect(vi.mocked(plantingPlanAPI.listForArea).mock.calls.map(([kind, bed]) => [kind, bed]))
      .toEqual([['bed', 10], ['bed', 11]]);
    expect(plantingPlanAPI.listAll).toHaveBeenCalledTimes(1);
    expect(result.current.getRowHarvestOverlaps(previousNeighbour)).toEqual([]);
    expect(result.current.getRowHarvestOverlaps(nextNeighbour)).toEqual([overlap]);
    expect(result.current.getRowHarvestOverlaps(otherBed)).toEqual([overlap]);
  });

  it('discards superseded snapshots of the same bed even when the old request completes last', async () => {
    const a = plan(1, 10);
    const b = plan(2, 10);
    const c = plan(3, 10);
    vi.mocked(plantingPlanAPI.listAll).mockResolvedValue(page([a, b, c]));
    vi.mocked(plantingPlanAPI.update)
      .mockResolvedValueOnce(response({ ...a, planting_date: '2026-05-02' }))
      .mockResolvedValueOnce(response({ ...b, planting_date: '2026-05-03' }));
    const older = defer<ReturnType<typeof page>>();
    const newer = defer<ReturnType<typeof page>>();
    vi.mocked(plantingPlanAPI.listForArea).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { result } = renderHook(() => usePlantingPlanGridAPI('project:season'));
    await act(() => result.current.api.list().then(() => undefined));
    await act(() => result.current.api.update(a.id, { planting_date: '2026-05-02' }).then(() => undefined));
    await act(() => result.current.api.update(b.id, { planting_date: '2026-05-03' }).then(() => undefined));

    const firstSignal = vi.mocked(plantingPlanAPI.listForArea).mock.calls[0][2];
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => newer.resolve(page([plan(c.id, 10, [overlap])])));
    await act(async () => older.resolve(page([c])));
    expect(result.current.getRowHarvestOverlaps(c)).toEqual([overlap]);
  });

  it('does not request any bed for an actual date that leaves the occupied interval unchanged', async () => {
    const row = plan(1, 10);
    vi.mocked(plantingPlanAPI.listAll).mockResolvedValue(page([row]));
    vi.mocked(plantingPlanAPI.patch).mockResolvedValue(response({ ...row, actual_transplanting_date: '2026-05-09' }));

    const { result } = renderHook(() => usePlantingPlanGridAPI('project:season'));
    await act(() => result.current.api.list().then(() => undefined));
    await act(() => result.current.api.patch(row.id, { actual_transplanting_date: '2026-05-09' }).then(() => undefined));

    expect(plantingPlanAPI.patch).toHaveBeenCalledTimes(1);
    expect(plantingPlanAPI.listForArea).not.toHaveBeenCalled();
  });

  it('discards any pending bed refresh when the active season changes', async () => {
    const row = plan(1, 10);
    vi.mocked(plantingPlanAPI.listAll).mockResolvedValue(page([row]));
    vi.mocked(plantingPlanAPI.update).mockResolvedValue(response({ ...row, planting_date: '2026-05-02' }));
    const pending = defer<ReturnType<typeof page>>();
    vi.mocked(plantingPlanAPI.listForArea).mockReturnValue(pending.promise);

    const { result, rerender } = renderHook(({ scope }) => usePlantingPlanGridAPI(scope), {
      initialProps: { scope: 'project:2026' },
    });
    await act(() => result.current.api.list().then(() => undefined));
    await act(() => result.current.api.update(row.id, { planting_date: '2026-05-02' }).then(() => undefined));
    const signal = vi.mocked(plantingPlanAPI.listForArea).mock.calls[0][2];

    rerender({ scope: 'project:2027' });
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(page([plan(1, 10, [overlap])])));
    expect(result.current.getRowHarvestOverlaps(row)).toEqual([]);
  });
});
