import { useCallback, useEffect, useState } from 'react';

import { cropCompanionAPI } from '../api/api';
import type { CropCompanion } from '../api/types';

export interface CropCompanionsState {
  relations: CropCompanion[];
  loaded: boolean;
  failed: boolean;
  reload: () => Promise<void>;
}

/**
 * The project's neighbour relations, loaded once and again whenever
 * `reloadKey` changes, e.g. after the crop form or an import saved crops.
 */
export function useCropCompanions(reloadKey?: unknown): CropCompanionsState {
  const [relations, setRelations] = useState<CropCompanion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const response = await cropCompanionAPI.list();
      setRelations(response.data);
      setFailed(false);
    } catch (error) {
      console.error('Error loading crop companions:', error);
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, reloadKey]);

  return { relations, loaded, failed, reload };
}
