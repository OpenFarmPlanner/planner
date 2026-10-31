import { useCallback, useEffect, useState } from 'react';

import { cropCompanionAPI } from '../api/api';
import type { CropCompanion } from '../api/types';

export interface CropCompanionsState {
  relations: CropCompanion[];
  loaded: boolean;
  failed: boolean;
  reload: () => Promise<void>;
  create: (relation: Omit<CropCompanion, 'id'>) => Promise<CropCompanion>;
  update: (id: number, relation: Partial<CropCompanion>) => Promise<CropCompanion>;
  remove: (id: number) => Promise<void>;
}

/**
 * The project's neighbour relations, loaded once and kept in sync with every
 * change made through this hook. `reloadKey` reloads them, e.g. after an
 * import changed the crop list.
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

  const create = useCallback(async (relation: Omit<CropCompanion, 'id'>): Promise<CropCompanion> => {
    const response = await cropCompanionAPI.create(relation);
    setRelations((current) => [...current, response.data]);
    return response.data;
  }, []);

  const update = useCallback(async (id: number, relation: Partial<CropCompanion>): Promise<CropCompanion> => {
    const response = await cropCompanionAPI.update(id, relation);
    setRelations((current) => current.map((entry) => (entry.id === id ? response.data : entry)));
    return response.data;
  }, []);

  const remove = useCallback(async (id: number): Promise<void> => {
    await cropCompanionAPI.delete(id);
    setRelations((current) => current.filter((entry) => entry.id !== id));
  }, []);

  return { relations, loaded, failed, reload, create, update, remove };
}
