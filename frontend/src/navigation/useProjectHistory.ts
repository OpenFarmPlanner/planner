import { useCallback, useRef, useState } from 'react';
import { cropAPI } from '../api/api';
import type { CropHistoryEntry } from '../api/types';
import { useTranslation } from '../i18n';

type ShowSnackbar = (message: string, severity: 'success' | 'error' | 'info') => void;

export interface ProjectHistory {
  open: boolean;
  items: CropHistoryEntry[];
  loading: boolean;
  /** The entry the user picked, awaiting confirmation in the restore dialog. */
  pendingRestoreEntry: CropHistoryEntry | null;
  openHistory: () => Promise<void>;
  closeHistory: () => void;
  requestRestore: (entry: CropHistoryEntry) => void;
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

  const requestRestore = useCallback((entry: CropHistoryEntry): void => {
    setPendingRestoreEntry(entry);
  }, []);

  const cancelRestore = useCallback((): void => {
    setPendingRestoreEntry(null);
  }, []);

  const restoreVersion = useCallback(async (historyId: number): Promise<void> => {
    try {
      await cropAPI.projectRestore(historyId);
      showSnackbar(t('commandPalette.feedback.versionRestoredWithBackup'), 'success');
      setOpen(false);
      setPendingRestoreEntry(null);
      window.location.reload();
    } catch (error) {
      console.error('Error restoring project version:', error);
      setPendingRestoreEntry(null);
      const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
      showSnackbar(t(code === 'project_restore_conflict'
        ? 'commandPalette.feedback.versionRestoreConflict'
        : 'commandPalette.feedback.versionRestoreError'), 'error');
    }
  }, [showSnackbar, t]);

  const revertBatch = useCallback(async (batchId: number): Promise<void> => {
    try {
      await cropAPI.revertBatch(batchId);
      showSnackbar(t('commandPalette.feedback.versionRestored'), 'success');
      setOpen(false);
      setPendingRestoreEntry(null);
      requestBatchRevert(null);
      window.location.reload();
    } catch (error) {
      console.error('Error reverting batch operation:', error);
      setPendingRestoreEntry(null);
      requestBatchRevert(null);
      showSnackbar(t('commandPalette.feedback.versionRestoreError'), 'error');
    }
  }, [showSnackbar, t]);

  return {
    open,
    items,
    loading,
    pendingRestoreEntry,
    openHistory,
    closeHistory,
    requestRestore,
    cancelRestore,
    restoreVersion,
    revertBatch,
    pendingImportUndo, importUndoPreview, importUndoError, undoBusy,
    requestImportUndo, cancelImportUndo, confirmImportUndo,
    pendingBatchRevert, requestBatchRevert,
  };
}
