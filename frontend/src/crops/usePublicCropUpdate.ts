/**
 * Shared state for the "Aktualisierung aus der Bibliothek" diff dialog.
 *
 * The dialog has two entry points on the same crop — the badge row's "Kultur
 * aktualisieren" button and, after a decline, its "Update abgelehnt" chip
 * (both `CropLibraryActionButton`) — so the loading/apply/reject state cannot
 * live inside either of them. The owning page holds this controller once and
 * hands it to the button and the dialog alike.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from '../i18n';
import { cropAPI, publicCropAPI } from '../api/api';
import type { Crop, CropPublicUpdate } from '../api/types';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { extractApiErrorCode } from '../api/errors';
import { readCropLibrarySyncFlags } from './cropLibraryAction';
import { describeLibraryPinError } from './libraryFieldPin';

export interface PublicCropUpdateDecision {
  unpinFields?: string[];
  pinFields?: string[];
}

export interface PublicCropUpdateController {
  /** The loaded diff while the dialog is open, `null` while it is closed. */
  update: CropPublicUpdate | null;
  /** An undecided library update exists — the notice should be shown. */
  hasOpenUpdate: boolean;
  /**
   * The pending library version was explicitly declined. The decision is
   * stored per public version, so this clears itself once the entry changes
   * again (see `Crop.rejected_public_version` on the backend).
   */
  isRejected: boolean;
  isLoading: boolean;
  isApplying: boolean;
  isRejecting: boolean;
  openDiff: () => void;
  closeDiff: () => void;
  /**
   * Takes the update over. `unpinFields` releases those locally pinned fields
   * so they take the new library value too; other pins keep the local value.
   * `pinFields` keeps those locally changed fields ("Nur lokal behalten").
   */
  applyUpdate: (decision?: PublicCropUpdateDecision) => void;
  rejectUpdate: () => void;
}

export function usePublicCropUpdate(
  crop: Crop | null | undefined,
  onUpdated?: () => void,
): PublicCropUpdateController {
  const { t } = useTranslation(['crops', 'common']);
  const [update, setUpdate] = useState<CropPublicUpdate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  const cropId = crop?.id;
  const { hasOpenUpdate, isRejected } = readCropLibrarySyncFlags(crop);

  const openDiff = useCallback((): void => {
    if (!cropId) {
      return;
    }
    setIsLoading(true);
    void cropAPI.publicUpdate(cropId)
      .then((response) => {
        if (!response.data.available) {
          // The entry moved on (or back) between the list load and this click.
          showGlobalSnackbar({ message: t('library.publicUpdate.gone'), severity: 'info' });
          onUpdated?.();
          return;
        }
        setUpdate(response.data);
      })
      .catch(() => {
        showGlobalSnackbar({ message: t('library.publicUpdate.loadError'), severity: 'error' });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [cropId, onUpdated, t]);

  const closeDiff = useCallback((): void => {
    if (isApplying || isRejecting) {
      return;
    }
    setUpdate(null);
  }, [isApplying, isRejecting]);

  const applyUpdate = useCallback((decision: PublicCropUpdateDecision = {}): void => {
    const publicCropId = update?.public_crop_id;
    if (!publicCropId) {
      return;
    }
    setIsApplying(true);
    void publicCropAPI.importToProject(publicCropId, 'update', {
      ...decision,
      baseVersion: update?.public_version,
    })
      .then(() => {
        showGlobalSnackbar({
          message: t('library.publicUpdate.applied', {
            name: update?.public_crop_name ?? crop?.name ?? '',
          }),
          severity: 'success',
        });
        setUpdate(null);
        onUpdated?.();
      })
      .catch((error: unknown) => {
        if (extractApiErrorCode(error) === 'stale_public_crop_version') {
          // The library moved on since the dialog loaded: nothing was applied,
          // so close it and let the user review the new version.
          showGlobalSnackbar({ message: t('library.publicUpdate.staleError'), severity: 'info' });
          setUpdate(null);
          onUpdated?.();
          return;
        }
        const code = extractApiErrorCode(error);
        showGlobalSnackbar({
          message: describeLibraryPinError(code, t) ?? t('library.publicUpdate.applyError'),
          severity: 'error',
        });
      })
      .finally(() => {
        setIsApplying(false);
      });
  }, [crop?.name, onUpdated, t, update]);

  const rejectUpdate = useCallback((): void => {
    if (!cropId) {
      return;
    }
    setIsRejecting(true);
    void cropAPI.rejectPublicUpdate(cropId)
      .then(() => {
        showGlobalSnackbar({
          message: t('library.publicUpdate.rejected', {
            name: update?.public_crop_name ?? crop?.name ?? '',
          }),
          severity: 'info',
        });
        setUpdate(null);
        onUpdated?.();
      })
      .catch(() => {
        showGlobalSnackbar({ message: t('library.publicUpdate.rejectError'), severity: 'error' });
      })
      .finally(() => {
        setIsRejecting(false);
      });
  }, [crop?.name, cropId, onUpdated, t, update]);

  return {
    update,
    hasOpenUpdate,
    isRejected,
    isLoading,
    isApplying,
    isRejecting,
    openDiff,
    closeDiff,
    applyUpdate,
    rejectUpdate,
  };
}
