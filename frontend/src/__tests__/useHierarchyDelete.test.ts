import { act, renderHook } from '@testing-library/react';
import { useHierarchyDelete } from '../components/hierarchy/hooks/useHierarchyDelete';
import type { HierarchyRow } from '../components/hierarchy/utils/types';

const api = vi.hoisted(() => ({
  locationDelete: vi.fn(),
  fieldDelete: vi.fn(),
  bedDelete: vi.fn(),
  locationCreate: vi.fn(),
  fieldCreate: vi.fn(),
  bedCreate: vi.fn(),
}));

vi.mock('../api/api', () => ({
  locationAPI: { delete: api.locationDelete, create: api.locationCreate },
  fieldAPI: { delete: api.fieldDelete, create: api.fieldCreate },
  bedAPI: { delete: api.bedDelete, create: api.bedCreate },
}));

const LOCATIONS = [{ id: 1, name: 'Hof' }];
const FIELDS = [{ id: 10, name: 'Parzelle A', location: 1 }];
const BEDS = [
  { id: 100, name: 'Beet 1', field: 10, area_sqm: 20 },
  { id: 101, name: 'Beet 2', field: 10, area_sqm: 20 },
];

function locationRow(): HierarchyRow {
  return { id: 'location-1', type: 'location', level: 0, locationId: 1, name: 'Hof' };
}

function setup(overrides: Record<string, unknown> = {}) {
  const params = {
    locations: structuredClone(LOCATIONS),
    fields: structuredClone(FIELDS),
    beds: structuredClone(BEDS),
    expandedRows: new Set<string | number>(['location-1', 'field-10']),
    fetchData: vi.fn().mockResolvedValue(undefined),
    expandAll: vi.fn(),
    setLocations: vi.fn(),
    setFields: vi.fn(),
    setBeds: vi.fn(),
    setSelectedRowId: vi.fn(),
    setError: vi.fn(),
    onPendingDeletionCountChange: vi.fn(),
    t: ((key: string) => key) as never,
    ...overrides,
  };
  const view = renderHook(() => useHierarchyDelete(params as never));
  return { ...view, params };
}

async function deleteLocation(view: ReturnType<typeof setup>) {
  await act(async () => {
    await view.result.current.deleteHierarchyRowWithUndo(locationRow());
  });
}

describe('useHierarchyDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.locationDelete.mockResolvedValue({ data: {} });
    api.fieldDelete.mockResolvedValue({ data: {} });
    api.bedDelete.mockResolvedValue({ data: {} });
    // The backend assigns fresh ids on restore — never the originals.
    api.locationCreate.mockResolvedValue({ data: { id: 2 } });
    api.fieldCreate.mockResolvedValue({ data: { id: 20 } });
    api.bedCreate.mockResolvedValue({ data: { id: 200 } });
  });

  it('queues one undoable deletion carrying the whole cascade', async () => {
    const view = setup();
    await deleteLocation(view);

    expect(api.locationDelete).toHaveBeenCalledWith(1);
    expect(view.result.current.pendingDeletions).toHaveLength(1);
    const [pending] = view.result.current.pendingDeletions;
    expect(pending.locations.map((l) => l.id)).toEqual([1]);
    expect(pending.fields.map((f) => f.id)).toEqual([10]);
    expect(pending.beds.map((b) => b.id)).toEqual([100, 101]);
  });

  it('remaps child ids onto the newly created parents when undoing', async () => {
    const view = setup();
    await deleteLocation(view);
    const [pending] = view.result.current.pendingDeletions;

    await act(async () => {
      await view.result.current.undoPendingDeletion(pending.id);
    });

    // The restored location got id 2, so the field must point at 2, not 1.
    expect(api.fieldCreate).toHaveBeenCalledWith(expect.objectContaining({ location: 2 }));
    // The restored field got id 20, so both beds must point at 20, not 10.
    expect(api.bedCreate).toHaveBeenCalledTimes(2);
    for (const [payload] of api.bedCreate.mock.calls) {
      expect(payload).toEqual(expect.objectContaining({ field: 20 }));
    }
  });

  it('restores parents before their children', async () => {
    const view = setup();
    await deleteLocation(view);
    const [pending] = view.result.current.pendingDeletions;

    const order: string[] = [];
    api.locationCreate.mockImplementation(async () => { order.push('location'); return { data: { id: 2 } }; });
    api.fieldCreate.mockImplementation(async () => { order.push('field'); return { data: { id: 20 } }; });
    api.bedCreate.mockImplementation(async () => { order.push('bed'); return { data: { id: 200 } }; });

    await act(async () => {
      await view.result.current.undoPendingDeletion(pending.id);
    });

    expect(order).toEqual(['location', 'field', 'bed', 'bed']);
  });

  it('reopens the rows that were expanded before the delete', async () => {
    const view = setup();
    await deleteLocation(view);
    const [pending] = view.result.current.pendingDeletions;

    await act(async () => {
      await view.result.current.undoPendingDeletion(pending.id);
    });

    expect(view.params.expandAll).toHaveBeenCalledWith(
      expect.arrayContaining(['location-1', 'field-10']),
    );
  });

  it('drops the pending entry once undone', async () => {
    const view = setup();
    await deleteLocation(view);
    const [pending] = view.result.current.pendingDeletions;

    await act(async () => {
      await view.result.current.undoPendingDeletion(pending.id);
    });

    expect(view.result.current.pendingDeletions).toHaveLength(0);
  });

  it('queues nothing when the delete request itself fails', async () => {
    api.locationDelete.mockRejectedValue(new Error('boom'));
    const view = setup();

    await deleteLocation(view);

    expect(view.result.current.pendingDeletions).toHaveLength(0);
    expect(view.params.setError).toHaveBeenCalled();
    expect(view.params.fetchData).toHaveBeenCalled();
  });

  it('resyncs from the server when a restore fails part-way', async () => {
    const view = setup();
    await deleteLocation(view);
    const [pending] = view.result.current.pendingDeletions;
    view.params.fetchData.mockClear();
    api.fieldCreate.mockRejectedValue(new Error('boom'));

    await act(async () => {
      await view.result.current.undoPendingDeletion(pending.id);
    });

    expect(view.params.fetchData).toHaveBeenCalled();
    expect(view.params.setError).toHaveBeenCalled();
    expect(view.result.current.pendingDeletions).toHaveLength(0);
  });

  it('dismissing the snackbar drops the entry without restoring anything', async () => {
    const view = setup();
    await deleteLocation(view);
    const [pending] = view.result.current.pendingDeletions;

    act(() => {
      view.result.current.closePendingDeletionSnackbar(pending.id);
    });

    expect(view.result.current.pendingDeletions).toHaveLength(0);
    expect(api.locationCreate).not.toHaveBeenCalled();
  });

  it('ignores an undo for an entry that is already gone', async () => {
    const view = setup();

    await act(async () => {
      await view.result.current.undoPendingDeletion('does-not-exist');
    });

    expect(api.locationCreate).not.toHaveBeenCalled();
  });
});
