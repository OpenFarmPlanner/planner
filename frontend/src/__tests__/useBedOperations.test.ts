import { mockT } from './helpers/testI18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBedOperations } from '../components/hierarchy/hooks/useBedOperations';
import type { Bed } from '../api/api';

const { createBedMock, bulkCreateBedMock, updateBedMock, deleteBedMock, confirmActionMock } = vi.hoisted(() => ({
  createBedMock: vi.fn(),
  bulkCreateBedMock: vi.fn(),
  updateBedMock: vi.fn(),
  deleteBedMock: vi.fn(),
  confirmActionMock: vi.fn(),
}));

vi.mock('../api/api', () => ({
  bedAPI: {
    create: createBedMock,
    bulkCreate: bulkCreateBedMock,
    update: updateBedMock,
    delete: deleteBedMock,
  },
}));

vi.mock('../utils/confirmAction', () => ({
  confirmAction: confirmActionMock,
}));

function createStateHarness(initialBeds: Bed[]) {
  let beds = [...initialBeds];
  const setBeds = vi.fn((updater: Bed[] | ((prev: Bed[]) => Bed[])) => {
    beds = typeof updater === 'function' ? (updater as (prev: Bed[]) => Bed[])(beds) : updater;
  });

  return {
    getBeds: () => beds,
    setBeds,
  };
}

describe('useBedOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a temporary bed at the beginning with default values', () => {
    const harness = createStateHarness([{ id: 1, name: 'Existing', field: 1, notes: '' }]);
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    const tempId = result.current.addBed(9);
    const [tempBed] = harness.getBeds();

    expect(tempId).toBeLessThan(0);
    expect(tempBed).toEqual({
      id: tempId,
      name: '',
      field: 9,
      area_sqm: undefined,
      notes: '',
    });
  });

  it('prefills a temporary bed with a name and the dimensions only', () => {
    const harness = createStateHarness([]);
    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, vi.fn(), mockT as never)
    );

    const tempId = result.current.addBed(9, { name: 'E 2 9', length_m: 10, width_m: 0.75 });

    expect(harness.getBeds()).toEqual([{
      id: tempId,
      name: 'E 2 9',
      field: 9,
      // The grid derives the area from the dimensions; a stored area would
      // outlive clearing them.
      area_sqm: undefined,
      length_m: 10,
      width_m: 0.75,
      notes: '',
    }]);
  });

  it('duplicates a bed with only its dimensions and adds it to the state', async () => {
    const source: Bed = { id: 4, name: 'B-3', field: 2, length_m: 8, width_m: 1.2, area_sqm: 9.6, notes: 'Do not copy' };
    const harness = createStateHarness([source]);
    const created: Bed = { id: 40, name: 'B-4', field: 2, length_m: 8, width_m: 1.2, area_sqm: 9.6, notes: '' };
    createBedMock.mockResolvedValue({ data: created });
    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, vi.fn(), mockT as never)
    );

    const response = await result.current.duplicateBed(source, 'B-4');

    expect(createBedMock).toHaveBeenCalledWith({ name: 'B-4', field: 2, length_m: 8, width_m: 1.2, notes: '' });
    expect(response).toEqual(created);
    expect(harness.getBeds()).toEqual([created, source]);
  });

  it('ignores a second duplicate while the first is still saving', async () => {
    const source: Bed = { id: 4, name: 'B-3', field: 2, notes: '' };
    const harness = createStateHarness([source]);
    let resolveCreate: (value: { data: Bed }) => void = () => {};
    createBedMock.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, vi.fn(), mockT as never)
    );

    const first = result.current.duplicateBed(source, 'B-4');
    await expect(result.current.duplicateBed(source, 'B-4')).resolves.toBeNull();
    resolveCreate({ data: { id: 41, name: 'B-4', field: 2 } });
    await first;

    expect(createBedMock).toHaveBeenCalledTimes(1);
  });

  it('creates a bed series in one request and adds all beds in order', async () => {
    const harness = createStateHarness([{ id: 1, name: 'Old', field: 3 }]);
    const created: Bed[] = [{ id: 7, name: 'E 1', field: 3 }, { id: 8, name: 'E 2', field: 3 }];
    bulkCreateBedMock.mockResolvedValue({ data: created });
    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, vi.fn(), mockT as never)
    );
    const payload = {
      field: 3,
      beds: [{ name: 'E 1', length_m: 10, width_m: 1 }, { name: 'E 2', length_m: 10, width_m: 1 }],
    };

    await expect(result.current.bulkCreateBeds(payload)).resolves.toEqual(created);

    expect(bulkCreateBedMock).toHaveBeenCalledWith(payload);
    expect(harness.getBeds().map((bed) => bed.id)).toEqual([7, 8, 1]);
  });

  it('creates a new bed from temporary data and replaces local temporary row', async () => {
    const temporaryBed: Bed = { id: -123, name: '', field: 2, notes: '' };
    const harness = createStateHarness([temporaryBed, { id: 5, name: 'Stable', field: 2, notes: '' }]);
    const setError = vi.fn();

    const savedBed: Bed = { id: 44, name: 'New bed', field: 2, area_sqm: 12, notes: 'Saved' };
    createBedMock.mockResolvedValue({ data: savedBed });

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    const response = await result.current.saveBed({
      id: -123,
      field: 2,
      name: 'New bed',
      area_sqm: 12,
      notes: 'Saved',
    });

    expect(createBedMock).toHaveBeenCalledWith({
      name: 'New bed',
      field: 2,
      area_sqm: 12,
      length_m: null,
      width_m: null,
      notes: 'Saved',
    });
    expect(response).toEqual(savedBed);
    expect(harness.getBeds()).toEqual([savedBed, { id: 5, name: 'Stable', field: 2, notes: '' }]);
    expect(setError).toHaveBeenCalledWith('');
  });

  it('normalizes empty values when creating a new bed', async () => {
    const harness = createStateHarness([]);
    const setError = vi.fn();
    createBedMock.mockResolvedValue({ data: { id: 11, name: '', field: 1, notes: '' } });

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    await result.current.saveBed({ id: -10, field: 1 });

    expect(createBedMock).toHaveBeenCalledWith({
      name: '',
      field: 1,
      area_sqm: undefined,
      length_m: null,
      width_m: null,
      notes: '',
    });
  });

  it('updates existing bed data in place', async () => {
    const harness = createStateHarness([
      { id: 10, name: 'A', field: 1, area_sqm: 4, notes: '' },
      { id: 11, name: 'B', field: 1, area_sqm: 6, notes: '' },
    ]);
    const setError = vi.fn();

    const updatedBed: Bed = { id: 11, name: 'B-updated', field: 1, area_sqm: 7, notes: 'ok' };
    updateBedMock.mockResolvedValue({ data: updatedBed });

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    const response = await result.current.saveBed({ id: 11, field: 1, name: 'B-updated', area_sqm: 7, notes: 'ok' });

    expect(updateBedMock).toHaveBeenCalledWith(11, {
      name: 'B-updated',
      field: 1,
      area_sqm: 7,
      length_m: null,
      width_m: null,
      notes: 'ok',
    });
    expect(response).toEqual(updatedBed);
    expect(harness.getBeds()).toEqual([
      { id: 10, name: 'A', field: 1, area_sqm: 4, notes: '' },
      updatedBed,
    ]);
    expect(setError).toHaveBeenCalledWith('');
  });

  it('propagates save errors and sets user-facing error message', async () => {
    const harness = createStateHarness([]);
    const setError = vi.fn();
    const saveError = new Error('failed');
    createBedMock.mockRejectedValue(saveError);

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    await expect(result.current.saveBed({ id: -7, field: 4, name: 'X' })).rejects.toThrow('failed');
    expect(setError).toHaveBeenCalledWith('Fehler beim Speichern des Beets');
  });

  it('does nothing when delete confirmation is cancelled', async () => {
    confirmActionMock.mockReturnValue(false);

    const harness = createStateHarness([{ id: 3, name: 'A', field: 1, notes: '' }]);
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    await result.current.deleteBed(3);

    expect(deleteBedMock).not.toHaveBeenCalled();
    expect(harness.getBeds()).toEqual([{ id: 3, name: 'A', field: 1, notes: '' }]);
  });

  it('removes unsaved bed locally without API call', async () => {
    confirmActionMock.mockReturnValue(true);

    const harness = createStateHarness([
      { id: -1, name: 'Temp', field: 1, notes: '' },
      { id: 2, name: 'Saved', field: 1, notes: '' },
    ]);
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    await result.current.deleteBed(-1);

    expect(deleteBedMock).not.toHaveBeenCalled();
    expect(harness.getBeds()).toEqual([{ id: 2, name: 'Saved', field: 1, notes: '' }]);
  });

  it('deletes persisted bed and updates local state', async () => {
    confirmActionMock.mockReturnValue(true);

    const harness = createStateHarness([
      { id: 8, name: 'Bed 8', field: 1, notes: '' },
      { id: 9, name: 'Bed 9', field: 1, notes: '' },
    ]);
    const setError = vi.fn();
    deleteBedMock.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    await result.current.deleteBed(8);

    expect(deleteBedMock).toHaveBeenCalledWith(8);
    expect(harness.getBeds()).toEqual([{ id: 9, name: 'Bed 9', field: 1, notes: '' }]);
    expect(setError).toHaveBeenCalledWith('');
  });

  it('propagates delete errors and keeps state unchanged', async () => {
    confirmActionMock.mockReturnValue(true);

    const startingBeds: Bed[] = [{ id: 21, name: 'Locked', field: 2, notes: '' }];
    const harness = createStateHarness(startingBeds);
    const setError = vi.fn();

    const deleteError = new Error('cannot delete');
    deleteBedMock.mockRejectedValue(deleteError);

    const { result } = renderHook(() =>
      useBedOperations(harness.setBeds, setError, mockT as never)
    );

    await expect(result.current.deleteBed(21)).rejects.toThrow('cannot delete');

    expect(setError).toHaveBeenCalledWith('Fehler beim Löschen des Beets');
    expect(harness.getBeds()).toEqual(startingBeds);
  });
});
