import { useCallback, useEffect, useState } from 'react';
import { cropAPI } from '../api/api';
import type { CropPublicSyncPreview } from '../api/types';
import { useTranslation } from '../i18n';
import {
  buildDefaultSyncChoices,
  splitSyncChoices,
  type PublicCropSyncChoices,
  type PublicCropSyncSelection,
} from './publicCropSync';

export interface PublicCropSyncPreviewState {
  /** Null while loading (or when disabled). */
  preview: CropPublicSyncPreview | null;
  choices: PublicCropSyncChoices;
  setChoices: (choices: PublicCropSyncChoices) => void;
  selection: PublicCropSyncSelection;
  loadError: string;
  reload: () => void;
}

/**
 * Loads the field-by-field differences between `cropId` and `publicCropId`
 * and keeps the user's per-field choices, starting from the preselection.
 */
export function usePublicCropSyncPreview(
  cropId: number | undefined,
  publicCropId: number | null | undefined,
  enabled: boolean,
): PublicCropSyncPreviewState {
  const { t } = useTranslation('crops');
  const [preview, setPreview] = useState<CropPublicSyncPreview | null>(null);
  const [choices, setChoices] = useState<PublicCropSyncChoices>({});
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    queueMicrotask(() => {
      setPreview(null);
      setChoices({});
      setLoadError('');
    });
    if (!enabled || !cropId || !publicCropId) return undefined;
    let cancelled = false;
    cropAPI.publicSyncPreview(cropId, publicCropId)
      .then((response) => {
        if (cancelled) return;
        setPreview(response.data);
        setChoices(buildDefaultSyncChoices(response.data.changes));
      })
      .catch(() => {
        if (!cancelled) setLoadError(t('library.sync.loadError'));
      });
    return () => {
      cancelled = true;
    };
  }, [cropId, enabled, publicCropId, reloadToken, t]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    preview,
    choices,
    setChoices,
    selection: splitSyncChoices(preview?.changes ?? [], choices),
    loadError,
    reload,
  };
}
