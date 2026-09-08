import { act, renderHook } from '@testing-library/react';
import { useCropDelete } from '../pages/useCropDelete';
import type { Crop } from '../api/api';

const api = vi.hoisted(() => ({
  del: vi.fn(),
  undelete: vi.fn(),
  deletePreview: vi.fn(),
}));

vi.mock('../api/api', () => ({
  cropAPI: { delete: api.del, undelete: api.undelete, deletePreview: api.deletePreview },
}));

vi.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function crop(id: number, name: string): Crop {
  return { id, name, variety: '' } as Crop;
}

const CROPS = [crop(1, 'Salat'), crop(2, 'Tomate'), crop(3, 'Gurke')];

function setup(selectedCropId: number | undefined = undefined) {
  let crops = [...CROPS];
  const setCrops = vi.fn((updater: unknown) => {
    crops = typeof updater === 'function'
      ? (updater as (prev: Crop[]) => Crop[])(crops)
      : (updater as Crop[]);
  });
  const updateSelectedCropId = vi.fn();
  const showSnackbar = vi.fn();
  const view = renderHook(() => useCropDelete({
    crops: CROPS,
    setCrops: setCrops as never,
    selectedCropId,
    updateSelectedCropId,
    showSnackbar,
  }));
  return {
    ...view,
    setCrops,
    updateSelectedCropId,
    showSnackbar,
    currentCrops: () => crops,
    addCrop: (added: Crop) => { crops = [...crops, added]; },
  };
}

/** Open the confirm dialog for one crop and confirm it. */
async function deleteCrop(view: ReturnType<typeof setup>, target: Crop) {
  act(() => { view.result.current.handleDelete(target); });
  await act(async () => { await view.result.current.handleDeleteConfirm(); });
}

describe('useCropDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    api.del.mockResolvedValue({ data: {} });
    api.undelete.mockResolvedValue({ data: {} });
    api.deletePreview.mockResolvedValue({ data: { crop_ids: [], variety_count: 0 } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues an undoable deletion after the delete succeeds', async () => {
    const view = setup();
    await deleteCrop(view, CROPS[1]);

    expect(api.del).toHaveBeenCalledWith(2);
    expect(view.result.current.pendingCropDeletions).toHaveLength(1);
    expect(view.result.current.pendingCropDeletions[0].visible).toBe(true);
  });

  it('queues nothing when the delete request fails', async () => {
    api.del.mockRejectedValue(new Error('boom'));
    const view = setup();

    await deleteCrop(view, CROPS[1]);

    expect(view.result.current.pendingCropDeletions).toHaveLength(0);
    expect(view.showSnackbar).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('undeletes on the server and clears the entry', async () => {
    const view = setup();
    await deleteCrop(view, CROPS[1]);
    const [pending] = view.result.current.pendingCropDeletions;

    await act(async () => { await view.result.current.undoPendingCropDeletion(pending.id); });

    expect(api.undelete).toHaveBeenCalledWith(2);
    expect(view.result.current.pendingCropDeletions).toHaveLength(0);
  });

  it('puts a restored crop back in its original position, not at the end', async () => {
    const view = setup();
    await deleteCrop(view, CROPS[1]);
    const [pending] = view.result.current.pendingCropDeletions;
    // A crop that arrived after the delete. Without it every crop on screen is
    // one the restore already orders, and appending would be indistinguishable
    // from restoring in place.
    view.addCrop(crop(4, 'Zucchini'));

    await act(async () => { await view.result.current.undoPendingCropDeletion(pending.id); });

    expect(view.currentCrops().map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });

  it('keeps the entry when the undelete fails, so the user can retry', async () => {
    const view = setup();
    await deleteCrop(view, CROPS[1]);
    const [pending] = view.result.current.pendingCropDeletions;
    api.undelete.mockRejectedValue(new Error('boom'));

    await act(async () => { await view.result.current.undoPendingCropDeletion(pending.id); });

    expect(view.result.current.pendingCropDeletions).toHaveLength(1);
    expect(view.showSnackbar).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('hides the snackbar on close but keeps the entry, so it can animate out', async () => {
    const view = setup();
    await deleteCrop(view, CROPS[1]);
    const [pending] = view.result.current.pendingCropDeletions;

    act(() => { view.result.current.closePendingCropDeletionSnackbar(pending.id); });

    expect(view.result.current.pendingCropDeletions).toHaveLength(1);
    expect(view.result.current.pendingCropDeletions[0].visible).toBe(false);
  });

  it('drops the entry once the undo window elapses', async () => {
    const view = setup();
    await deleteCrop(view, CROPS[1]);
    expect(view.result.current.pendingCropDeletions).toHaveLength(1);

    await act(async () => { vi.runAllTimers(); });

    expect(view.result.current.pendingCropDeletions).toHaveLength(0);
  });

  it('leaves an undone entry gone when the undo window later elapses', async () => {
    const view = setup();
    await deleteCrop(view, CROPS[1]);
    const [pending] = view.result.current.pendingCropDeletions;

    await act(async () => { await view.result.current.undoPendingCropDeletion(pending.id); });
    await act(async () => { vi.runAllTimers(); });

    expect(api.undelete).toHaveBeenCalledTimes(1);
    expect(view.result.current.pendingCropDeletions).toHaveLength(0);
  });

  it('selects the next surviving crop when the selected one is deleted', async () => {
    const view = setup(2);
    await deleteCrop(view, CROPS[1]);

    expect(view.updateSelectedCropId).toHaveBeenCalledWith(3, 'internal');
  });

  it('falls back to the previous crop when the deleted one was last', async () => {
    const view = setup(3);
    await deleteCrop(view, CROPS[2]);

    expect(view.updateSelectedCropId).toHaveBeenCalledWith(2, 'internal');
  });

  it('leaves the selection alone when another crop is deleted', async () => {
    const view = setup(1);
    await deleteCrop(view, CROPS[1]);

    expect(view.updateSelectedCropId).not.toHaveBeenCalled();
  });

  it('restores the selection that the delete moved away', async () => {
    const view = setup(2);
    await deleteCrop(view, CROPS[1]);
    const [pending] = view.result.current.pendingCropDeletions;
    view.updateSelectedCropId.mockClear();

    await act(async () => { await view.result.current.undoPendingCropDeletion(pending.id); });

    expect(view.updateSelectedCropId).toHaveBeenCalledWith(2, 'internal');
  });
});
