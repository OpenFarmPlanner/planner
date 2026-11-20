import { act, renderHook } from '@testing-library/react';
import { useProjectHistory } from '../navigation/useProjectHistory';
import type { CropHistoryEntry } from '../api/types';

const api = vi.hoisted(() => ({
  projectHistory: vi.fn(),
  projectRestorePreview: vi.fn(),
  projectRestore: vi.fn(),
  revertBatch: vi.fn(),
  importUndoPreview: vi.fn(),
}));

vi.mock('../api/api', () => ({ cropAPI: api }));
vi.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const entry = (id: number): CropHistoryEntry => ({ history_id: id, batch_id: id * 10 } as CropHistoryEntry);
const ENTRIES = [entry(1), entry(2)];

function setup() {
  const showSnackbar = vi.fn();
  const view = renderHook(() => useProjectHistory(showSnackbar));
  return { showSnackbar, ...view };
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  api.projectRestorePreview.mockReset().mockResolvedValue({ data: { token: 'preview-token', impact: [] } });
  reload = vi.fn();
  // jsdom refuses a real reload; the hook calls it after every successful undo.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('openHistory', () => {
  it('starts closed and empty', () => {
    const { result } = setup();

    expect(result.current.open).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.pendingRestoreEntry).toBeNull();
  });

  it('loads the entries and opens the dialog', async () => {
    api.projectHistory.mockResolvedValue({ data: ENTRIES });
    const { result } = setup();

    await act(async () => { await result.current.openHistory(); });

    expect(result.current.items).toEqual(ENTRIES);
    expect(result.current.open).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('leaves the dialog closed and reports the failure when loading fails', async () => {
    api.projectHistory.mockRejectedValue(new Error('offline'));
    const { result, showSnackbar } = setup();

    await act(async () => { await result.current.openHistory(); });

    expect(result.current.open).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(showSnackbar).toHaveBeenCalledWith(
      'commandPalette.feedback.versionHistoryLoadError', 'error',
    );
  });

  it('clears the loading flag even when the request fails', async () => {
    api.projectHistory.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await act(async () => { await result.current.openHistory(); });

    expect(result.current.loading).toBe(false);
  });

  it('replaces the previous entries rather than appending on a second open', async () => {
    api.projectHistory.mockResolvedValueOnce({ data: ENTRIES });
    api.projectHistory.mockResolvedValueOnce({ data: [entry(3)] });
    const { result } = setup();

    await act(async () => { await result.current.openHistory(); });
    await act(async () => { await result.current.openHistory(); });

    expect(result.current.items).toEqual([entry(3)]);
  });
});

describe('selective import undo', () => {
  it('checks the selected import before allowing a destructive call', async () => {
    api.importUndoPreview.mockResolvedValue({ data: { created_count: 2, updated_count: 1, conflicts: [] } });
    api.revertBatch.mockResolvedValue({ data: {} });
    const { result, showSnackbar } = setup();
    await act(async () => { await result.current.requestImportUndo(ENTRIES[0]); });
    expect(api.importUndoPreview).toHaveBeenCalledWith(10);
    expect(api.revertBatch).not.toHaveBeenCalled();
    expect(result.current.importUndoPreview?.created_count).toBe(2);
    await act(async () => { await result.current.confirmImportUndo(); });
    expect(api.revertBatch).toHaveBeenCalledWith(10);
    expect(showSnackbar).toHaveBeenCalledWith('crops:history.import.undone', 'success');
    expect(reload).toHaveBeenCalledOnce();
    expect(result.current.pendingImportUndo).toBeNull();
  });

  it('keeps a conflicting import untouched', async () => {
    api.importUndoPreview.mockResolvedValue({ data: { created_count: 1, updated_count: 0, conflicts: [{ code: 'later_edit' }] } });
    const { result } = setup();
    await act(async () => { await result.current.requestImportUndo(ENTRIES[0]); });
    await act(async () => { await result.current.confirmImportUndo(); });
    expect(api.revertBatch).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('discards a preview that arrives after cancellation', async () => {
    let resolve!: (value: unknown) => void;
    api.importUndoPreview.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result } = setup();
    let loading!: Promise<void>;
    act(() => { loading = result.current.requestImportUndo(ENTRIES[0]); });
    act(() => { result.current.cancelImportUndo(); });
    await act(async () => {
      resolve({ data: { created_count: 9, updated_count: 0, conflicts: [] } });
      await loading;
    });
    expect(result.current.pendingImportUndo).toBeNull();
    expect(result.current.importUndoPreview).toBeNull();
  });

  it('refreshes conflicts after a stale preview without automatically retrying undo', async () => {
    api.importUndoPreview.mockResolvedValueOnce({ data: { created_count: 1, updated_count: 0, conflicts: [] } })
      .mockResolvedValueOnce({ data: { created_count: 1, updated_count: 0, conflicts: [{ code: 'dependent_data' }] } });
    api.revertBatch.mockRejectedValue({ response: { status: 409 } });
    const { result } = setup();
    await act(async () => { await result.current.requestImportUndo(ENTRIES[0]); });
    await act(async () => { await result.current.confirmImportUndo(); });
    expect(api.revertBatch).toHaveBeenCalledOnce();
    expect(result.current.importUndoPreview?.conflicts[0].code).toBe('dependent_data');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('the restore confirmation step', () => {
  it('holds the picked entry until it is confirmed or cancelled', async () => {
    const { result } = setup();

    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });
    expect(result.current.pendingRestoreEntry).toEqual(ENTRIES[0]);

    act(() => { result.current.cancelRestore(); });
    expect(result.current.pendingRestoreEntry).toBeNull();
  });

  it('only reads the preview when the history entry is selected', async () => {
    const { result } = setup();

    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });

    expect(api.projectRestorePreview).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    expect(api.projectRestore).not.toHaveBeenCalled();
  });

  it('leaves the dialog open while the confirmation is pending', async () => {
    api.projectHistory.mockResolvedValue({ data: ENTRIES });
    const { result } = setup();

    await act(async () => { await result.current.openHistory(); });
    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });

    expect(result.current.open).toBe(true);
  });

  it('ignores an outdated preview when the selected entry changes', async () => {
    let finish!: (response: unknown) => void;
    api.projectRestorePreview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = setup();
    act(() => { void result.current.requestRestore(ENTRIES[0]); });
    const signal = api.projectRestorePreview.mock.calls[0][1] as AbortSignal;
    await act(async () => { await result.current.requestRestore(ENTRIES[1]); });
    expect(signal.aborted).toBe(true);
    await act(async () => { finish({ data: { token: 'outdated', impact: [] } }); });
    expect(result.current.pendingRestoreEntry).toEqual(ENTRIES[1]);
    expect(result.current.restorePreview).toEqual({ status: 'ready', data: { token: 'preview-token', impact: [] } });
  });
});

describe('restoreVersion', () => {
  it('restores, closes both dialogs and reloads', async () => {
    api.projectHistory.mockResolvedValue({ data: ENTRIES });
    api.projectRestore.mockResolvedValue({ data: { detail: 'ok' } });
    const { result, showSnackbar } = setup();

    await act(async () => { await result.current.openHistory(); });
    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });
    await act(async () => { await result.current.restoreVersion(1); });

    expect(api.projectRestore).toHaveBeenCalledWith(1, 'preview-token');
    expect(result.current.open).toBe(false);
    expect(result.current.pendingRestoreEntry).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(showSnackbar).toHaveBeenCalledWith(
      'commandPalette.feedback.versionRestoredWithBackup', 'success',
    );
  });

  it('says a backup was taken, which is what makes the restore itself undoable', async () => {
    api.projectRestore.mockResolvedValue({ data: { detail: 'ok' } });
    const { result, showSnackbar } = setup();

    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });
    await act(async () => { await result.current.restoreVersion(1); });

    expect(showSnackbar.mock.calls[0][0]).toBe('commandPalette.feedback.versionRestoredWithBackup');
  });

  it('keeps the confirmation open and invalidates the preview when the restore fails', async () => {
    api.projectHistory.mockResolvedValue({ data: ENTRIES });
    api.projectRestore.mockRejectedValue(new Error('conflict'));
    const { result } = setup();

    await act(async () => { await result.current.openHistory(); });
    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });
    await act(async () => { await result.current.restoreVersion(1); });

    expect(result.current.pendingRestoreEntry).toEqual(ENTRIES[0]);
    expect(result.current.open).toBe(true);
    expect(result.current.restorePreview).toEqual({ status: 'unavailable' });
  });

  it('requires a fresh preview and a second confirmation after a stale response', async () => {
    api.projectRestore.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'project_restore_preview_changed' } },
    }).mockResolvedValueOnce({ data: {} });
    const { result } = setup();

    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });
    await act(async () => { await result.current.restoreVersion(1); });
    expect(result.current.restorePreview).toEqual({ status: 'stale' });
    await act(async () => { await result.current.restoreVersion(1); });
    expect(reload).not.toHaveBeenCalled();
    expect(api.projectRestore).toHaveBeenCalledOnce();

    api.projectRestorePreview.mockResolvedValueOnce({ data: { token: 'fresh-token', impact: [] } });
    await act(async () => { result.current.refreshRestorePreview(); });
    expect(api.projectRestore).toHaveBeenCalledOnce();
    await act(async () => { await result.current.restoreVersion(1); });
    expect(api.projectRestore).toHaveBeenLastCalledWith(1, 'fresh-token');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('blocks writes when the selected version has no valid preview', async () => {
    api.projectRestorePreview.mockRejectedValue({ response: { status: 409 } });
    const { result } = setup();
    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });
    expect(result.current.restorePreview).toEqual({ status: 'conflict' });
    await act(async () => { await result.current.restoreVersion(1); });
    expect(api.projectRestore).not.toHaveBeenCalled();
  });
});

describe('revertBatch', () => {
  it('reverts, closes the dialog and reloads', async () => {
    api.projectHistory.mockResolvedValue({ data: ENTRIES });
    api.revertBatch.mockResolvedValue({ data: { detail: 'ok' } });
    const { result, showSnackbar } = setup();

    await act(async () => { await result.current.openHistory(); });
    await act(async () => { await result.current.revertBatch(10); });

    expect(api.revertBatch).toHaveBeenCalledWith(10);
    expect(result.current.open).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(showSnackbar).toHaveBeenLastCalledWith(
      'commandPalette.feedback.versionRestored', 'success',
    );
  });

  it('uses the plain restored message, not the with-backup one', async () => {
    // A batch revert takes no backup, so promising one would be a lie the user
    // would only discover when trying to undo it.
    api.revertBatch.mockResolvedValue({ data: { detail: 'ok' } });
    const { result, showSnackbar } = setup();

    await act(async () => { await result.current.revertBatch(10); });

    expect(showSnackbar.mock.calls[0][0]).toBe('commandPalette.feedback.versionRestored');
  });

  it('reports the failure and does not reload', async () => {
    api.revertBatch.mockRejectedValue(new Error('gone'));
    const { result, showSnackbar } = setup();

    await act(async () => { await result.current.revertBatch(10); });

    expect(reload).not.toHaveBeenCalled();
    expect(showSnackbar).toHaveBeenLastCalledWith(
      'commandPalette.feedback.versionRestoreError', 'error',
    );
  });

  it('clears a pending confirmation so a stale dialog cannot reopen', async () => {
    api.revertBatch.mockRejectedValue(new Error('gone'));
    const { result } = setup();

    await act(async () => { await result.current.requestRestore(ENTRIES[0]); });
    await act(async () => { await result.current.revertBatch(10); });

    expect(result.current.pendingRestoreEntry).toBeNull();
  });
});
