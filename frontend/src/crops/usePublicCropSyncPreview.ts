import { useCallback, useEffect, useRef, useState } from 'react';
import { cropAPI } from '../api/api';
import type { CropPublicSyncPreview, StagedPlantHealthMapping } from '../api/types';
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
 * and keeps the user's per-field choices, starting from the default
 * preselection. `allowLocal` offers "Nur lokal" for linking or synchronization;
 * `keepPrivateValuesLocally` pins private-only defaults during initial linking.
 */
export function usePublicCropSyncPreview(
  cropId: number | undefined,
  publicCropId: number | null | undefined,
  enabled: boolean,
  allowLocal = false,
  healthMappings?: StagedPlantHealthMapping[],
  expectedUpdatedAt?: string,
  keepPrivateValuesLocally = false,
  retainUnchangedChoices = false,
): PublicCropSyncPreviewState {
  const { t } = useTranslation('crops');
  const [preview, setPreview] = useState<CropPublicSyncPreview | null>(null);
  const [choices, setChoices] = useState<PublicCropSyncChoices>({});
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const retained = useRef<{
    target: string;
    changes: CropPublicSyncPreview['changes'];
    choices: PublicCropSyncChoices;
  } | undefined>(undefined);
  const target = `${cropId}:${publicCropId}`;
  const mappingKey = JSON.stringify(healthMappings ?? []);
  const requestKey = `${cropId}:${publicCropId}:${reloadToken}:${mappingKey}:${expectedUpdatedAt}:${keepPrivateValuesLocally}`;
  const [loadedKey, setLoadedKey] = useState('');

  useEffect(() => {
    if (!retainUnchangedChoices) retained.current = undefined;
    queueMicrotask(() => {
      setPreview(null);
      setChoices({});
      setLoadError('');
    });
    if (!enabled || !cropId || !publicCropId) return undefined;
    let cancelled = false;
    const mappings = JSON.parse(mappingKey) as StagedPlantHealthMapping[];
    const request = mappings.length
      ? cropAPI.publicSyncPreview(cropId, publicCropId, mappings, expectedUpdatedAt)
      : cropAPI.publicSyncPreview(cropId, publicCropId);
    request
      .then((response) => {
        if (cancelled) return;
        setPreview(response.data);
        setLoadedKey(requestKey);
        const defaults = buildDefaultSyncChoices(response.data.changes, { allowLocal, keepPrivateValuesLocally });
        const previous = retained.current;
        if (retainUnchangedChoices && previous?.target === target) {
          const previousChanges = new Map(previous.changes.map(change => [change.field, change]));
          for (const change of response.data.changes) {
            const choice = previous.choices[change.field];
            if (choice && JSON.stringify(change) === JSON.stringify(previousChanges.get(change.field))) {
              defaults[change.field] = choice;
            }
          }
        }
        setChoices(defaults);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t('library.sync.loadError'));
      });
    return () => {
      cancelled = true;
    };
  }, [allowLocal, keepPrivateValuesLocally, cropId, enabled, publicCropId, reloadToken, requestKey, mappingKey,
    expectedUpdatedAt, retainUnchangedChoices, t, target]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    preview: enabled && loadedKey === requestKey ? preview : null,
    choices,
    setChoices: (next) => {
      if (retainUnchangedChoices && preview) retained.current = { target, changes: preview.changes, choices: next };
      setChoices(next);
    },
    selection: splitSyncChoices(preview?.changes ?? [], choices, { allowLocal }),
    loadError,
    reload,
  };
}
