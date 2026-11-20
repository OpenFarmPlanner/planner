import { useCallback, useEffect, useRef, useState } from 'react';
import { cropAPI } from '../api/api';
import type { CropHistoryEntry, ProjectRestorePreview } from '../api/types';
import { useTranslation } from '../i18n';

type ShowSnackbar = (message: string, severity: 'success' | 'error' | 'info') => void;

export type RestorePreviewState =
  | { status: 'ready'; data: ProjectRestorePreview }
  | { status: 'loading' | 'unavailable' | 'conflict' | 'stale' };

function restoreErrorStatus(error: unknown): 'unavailable' | 'conflict' | 'stale' {
  const status = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  if (status?.data?.code === 'project_restore_preview_changed') return 'stale';
  if (status?.status === 409 || status?.status === 404) return 'conflict';
  return 'unavailable';
}

export interface ProjectHistory {
  open: boolean;
  items: CropHistoryEntry[];
  loading: boolean;
  /** The entry the user picked, awaiting confirmation in the restore dialog. */
  pendingRestoreEntry: CropHistoryEntry | null;
  restorePreview: RestorePreviewState;
  restoreBusy: boolean;
  openHistory: () => Promise<void>;
  closeHistory: () => void;
  requestRestore: (entry: CropHistoryEntry) => Promise<void>;
  refreshRestorePreview: () => void;
  cancelRestore: () => void;
  restoreVersion: (historyId: number) => Promise<void>;
  revertBatch: (batchId: number) => Promise<void>;
  pendingImportUndo: CropHistoryEntry | null;
  importUndoPreview: Awaited<ReturnType<typeof cropAPI.importUndoPreview>>['data'] | null;
  importUndoError: 'unavailable' | 'already_undone' | null;
  undoBusy: boolean;
  requestImportUndo: (entry: CropHistoryEntry) => Promise<void>;
  cancelImportUndo: () => void;
  confirmImportUndo: () => Promise<void>;
  pendingBatchRevert: CropHistoryEntry | null;
  requestBatchRevert: (entry: CropHistoryEntry | null) => void;
}

/**
 * The project version history dialog: loading the entries, and the two ways a
 * user can undo their way back — restoring a single version or reverting a
 * whole batch operation. Both reload the page, because a restore rewrites rows
 * every open screen may already be showing.
 */
export function useProjectHistory(showSnackbar: ShowSnackbar): ProjectHistory {
  const { t } = useTranslation('navigation');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CropHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingRestoreEntry, setPendingRestoreEntry] = useState<CropHistoryEntry | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreviewState>({ status: 'loading' });
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreRequest = useRef<AbortController | null>(null);
  const restoring = useRef(false);
  const [pendingBatchRevert, requestBatchRevert] = useState<CropHistoryEntry | null>(null);
  const [pendingImportUndo, setPendingImportUndo] = useState<CropHistoryEntry | null>(null);
  const [importUndoPreview, setImportUndoPreview] = useState<ProjectHistory['importUndoPreview']>(null);
  const [importUndoError, setImportUndoError] = useState<ProjectHistory['importUndoError']>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const undoRequest = useRef(0);

  const cancelImportUndo = useCallback(() => {
    undoRequest.current += 1;
    setPendingImportUndo(null);
    setImportUndoPreview(null);
    setImportUndoError(null);
  }, []);

  const requestImportUndo = useCallback(async (entry: CropHistoryEntry): Promise<void> => {
    const request = ++undoRequest.current;
    setPendingImportUndo(entry);
    setImportUndoPreview(null);
    setImportUndoError(null);
    try {
      const response = await cropAPI.importUndoPreview(entry.batch_id!);
      if (request === undoRequest.current) setImportUndoPreview(response.data);
    } catch (error) {
      const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (request === undoRequest.current) setImportUndoError(code === 'crop_import_already_undone' ? 'already_undone' : 'unavailable');
    }
  }, []);

  const confirmImportUndo = useCallback(async (): Promise<void> => {
    if (!pendingImportUndo?.batch_id || !importUndoPreview || importUndoPreview.conflicts.length || undoBusy) return;
    setUndoBusy(true);
    try {
      await cropAPI.revertBatch(pendingImportUndo.batch_id);
      cancelImportUndo();
      setOpen(false);
      showSnackbar(t('crops:history.import.undone'), 'success');
      window.location.reload();
    } catch {
      // A later edit can invalidate a preview; refresh the same checks before retry.
      await requestImportUndo(pendingImportUndo);
    } finally {
      setUndoBusy(false);
    }
  }, [pendingImportUndo, importUndoPreview, undoBusy, cancelImportUndo, showSnackbar, t, requestImportUndo]);

  const openHistory = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await cropAPI.projectHistory();
      setItems(response.data);
      setOpen(true);
    } catch (error) {
      console.error('Error loading project history:', error);
      showSnackbar(t('commandPalette.feedback.versionHistoryLoadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showSnackbar, t]);

  const closeHistory = useCallback((): void => {
    setOpen(false);
  }, []);

  useEffect(() => () => restoreRequest.current?.abort(), []);

  const clearRestore = useCallback((): void => {
    restoreRequest.current?.abort();
    setPendingRestoreEntry(null);
    setRestorePreview({ status: 'loading' });
  }, []);

  const requestRestore = useCallback(async (entry: CropHistoryEntry): Promise<void> => {
    if (restoring.current) return;
    restoreRequest.current?.abort();
    const request = new AbortController();
    restoreRequest.current = request;
    setPendingRestoreEntry(entry);
    setRestorePreview({ status: 'loading' });
    try {
      const { data } = await cropAPI.projectRestorePreview(entry.history_id, request.signal);
      if (!request.signal.aborted) {
        setRestorePreview(data.token && Array.isArray(data.impact)
          ? { status: 'ready', data }
          : { status: 'unavailable' });
      }
    } catch (error) {
      if (!request.signal.aborted) setRestorePreview({ status: restoreErrorStatus(error) });
    }
  }, []);

  const refreshRestorePreview = useCallback((): void => {
    if (pendingRestoreEntry) void requestRestore(pendingRestoreEntry);
  }, [pendingRestoreEntry, requestRestore]);

  const cancelRestore = useCallback((): void => {
    if (!restoring.current) clearRestore();
  }, [clearRestore]);

  const restoreVersion = useCallback(async (historyId: number): Promise<void> => {
    if (
      restoring.current || pendingRestoreEntry?.history_id !== historyId
      || restorePreview.status !== 'ready' || !restorePreview.data.token
    ) return;
    restoring.current = true;
    setRestoreBusy(true);
    try {
      await cropAPI.projectRestore(historyId, restorePreview.data.token);
      showSnackbar(t('commandPalette.feedback.versionRestoredWithBackup'), 'success');
      setOpen(false);
      clearRestore();
      window.location.reload();
    } catch (error) {
      setRestorePreview({ status: restoreErrorStatus(error) });
    } finally {
      restoring.current = false;
      setRestoreBusy(false);
    }
  }, [clearRestore, pendingRestoreEntry, restorePreview, showSnackbar, t]);

  const revertBatch = useCallback(async (batchId: number): Promise<void> => {
    try {
      await cropAPI.revertBatch(batchId);
      showSnackbar(t('commandPalette.feedback.versionRestored'), 'success');
      setOpen(false);
      clearRestore();
      requestBatchRevert(null);
      window.location.reload();
    } catch (error) {
      console.error('Error reverting batch operation:', error);
      clearRestore();
      requestBatchRevert(null);
      showSnackbar(t('commandPalette.feedback.versionRestoreError'), 'error');
    }
  }, [clearRestore, showSnackbar, t]);

  return {
    open,
    items,
    loading,
    pendingRestoreEntry,
    restorePreview,
    restoreBusy,
    openHistory,
    closeHistory,
    requestRestore,
    refreshRestorePreview,
    cancelRestore,
    restoreVersion,
    revertBatch,
    pendingImportUndo, importUndoPreview, importUndoError, undoBusy,
    requestImportUndo, cancelImportUndo, confirmImportUndo,
    pendingBatchRevert, requestBatchRevert,
  };
}
