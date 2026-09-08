import { useCallback, useState } from 'react';
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
      showSnackbar(t('commandPalette.feedback.versionRestoreError'), 'error');
    }
  }, [showSnackbar, t]);

  const revertBatch = useCallback(async (batchId: number): Promise<void> => {
    try {
      await cropAPI.revertBatch(batchId);
      showSnackbar(t('commandPalette.feedback.versionRestored'), 'success');
      setOpen(false);
      setPendingRestoreEntry(null);
      window.location.reload();
    } catch (error) {
      console.error('Error reverting batch operation:', error);
      setPendingRestoreEntry(null);
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
  };
}
