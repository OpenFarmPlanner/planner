import { act, renderHook } from '@testing-library/react';
import { useProjectHistory } from '../navigation/useProjectHistory';
import type { CropHistoryEntry } from '../api/types';

const api = vi.hoisted(() => ({
  projectHistory: vi.fn(),
  projectRestore: vi.fn(),
  revertBatch: vi.fn(),
}));

vi.mock('../api/api', () => ({ cropAPI: api }));
vi.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const entry = (id: number): CropHistoryEntry => ({ id, batch_id: id * 10 } as CropHistoryEntry);
const ENTRIES = [entry(1), entry(2)];

function setup() {
  const showSnackbar = vi.fn();
  const view = renderHook(() => useProjectHistory(showSnackbar));
  return { showSnackbar, ...view };
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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

describe('the restore confirmation step', () => {
  it('holds the picked entry until it is confirmed or cancelled', () => {
    const { result } = setup();

    act(() => { result.current.requestRestore(ENTRIES[0]); });
    expect(result.current.pendingRestoreEntry).toEqual(ENTRIES[0]);

    act(() => { result.current.cancelRestore(); });
    expect(result.current.pendingRestoreEntry).toBeNull();
  });

  it('does not restore anything on its own', () => {
    const { result } = setup();

    act(() => { result.current.requestRestore(ENTRIES[0]); });

    expect(api.projectRestore).not.toHaveBeenCalled();
  });

  it('leaves the dialog open while the confirmation is pending', async () => {
    api.projectHistory.mockResolvedValue({ data: ENTRIES });
    const { result } = setup();

    await act(async () => { await result.current.openHistory(); });
    act(() => { result.current.requestRestore(ENTRIES[0]); });

    expect(result.current.open).toBe(true);
  });
});

describe('restoreVersion', () => {
  it('restores, closes both dialogs and reloads', async () => {
    api.projectHistory.mockResolvedValue({ data: ENTRIES });
    api.projectRestore.mockResolvedValue({ data: { detail: 'ok' } });
    const { result, showSnackbar } = setup();

    await act(async () => { await result.current.openHistory(); });
    act(() => { result.current.requestRestore(ENTRIES[0]); });
    await act(async () => { await result.current.restoreVersion(1); });

    expect(api.projectRestore).toHaveBeenCalledWith(1);
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

    await act(async () => { await result.current.restoreVersion(1); });

    expect(showSnackbar.mock.calls[0][0]).toBe('commandPalette.feedback.versionRestoredWithBackup');
  });

  it('clears the confirmation but keeps the dialog open when the restore fails', async () => {
    api.projectHistory.mockResolvedValue({ data: ENTRIES });
    api.projectRestore.mockRejectedValue(new Error('conflict'));
    const { result, showSnackbar } = setup();

    await act(async () => { await result.current.openHistory(); });
    act(() => { result.current.requestRestore(ENTRIES[0]); });
    await act(async () => { await result.current.restoreVersion(1); });

    expect(result.current.pendingRestoreEntry).toBeNull();
    expect(result.current.open).toBe(true);
    expect(showSnackbar).toHaveBeenLastCalledWith(
      'commandPalette.feedback.versionRestoreError', 'error',
    );
  });

  it('never reloads when the restore failed, so the error stays on screen', async () => {
    api.projectRestore.mockRejectedValue(new Error('conflict'));
    const { result } = setup();

    await act(async () => { await result.current.restoreVersion(1); });

    expect(reload).not.toHaveBeenCalled();
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

    act(() => { result.current.requestRestore(ENTRIES[0]); });
    await act(async () => { await result.current.revertBatch(10); });

    expect(result.current.pendingRestoreEntry).toBeNull();
  });
});
