import { useCallback, useEffect, useState } from 'react';
import { projectAPI } from '../api/api';
import type { AuthUser } from '../auth/types';

/** Dispatched by the project trash page when it restores or purges a project. */
const PROJECT_TRASH_CHANGED_EVENT = 'ofp:project-trash-changed';

export interface DeletedProjectsCount {
  deletedProjectsCount: number;
  /** Re-read the count, for the moment the project menu opens. */
  refresh: () => Promise<void>;
}

/**
 * How many deleted projects the user has, for the trash entry's badge.
 *
 * Any failure counts as zero rather than surfacing an error: this only decides
 * whether a badge appears, and a broken badge is worse than an absent one.
 */
export function useDeletedProjectsCount(user: AuthUser | null): DeletedProjectsCount {
  const [deletedProjectsCount, setDeletedProjectsCount] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!user) {
      setDeletedProjectsCount(0);
      return;
    }
    try {
      const response = await projectAPI.listDeleted();
      const payload = response.data;
      const deletedProjects = Array.isArray(payload) ? payload : payload.results;
      setDeletedProjectsCount(deletedProjects.length);
    } catch {
      setDeletedProjectsCount(0);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void refresh();
  }, [refresh, user]);

  useEffect(() => {
    const handleProjectTrashChanged = (): void => {
      void refresh();
    };
    window.addEventListener(PROJECT_TRASH_CHANGED_EVENT, handleProjectTrashChanged);
    return () => window.removeEventListener(PROJECT_TRASH_CHANGED_EVENT, handleProjectTrashChanged);
  }, [refresh]);

  return { deletedProjectsCount, refresh };
}
