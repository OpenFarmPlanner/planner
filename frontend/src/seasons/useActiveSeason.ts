import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { seasonAPI } from '../api/api';
import type { Season, SeasonCreationOptions, SeasonDueSuggestion } from '../api/types';
import { extractApiErrorMessage } from '../api/errors';
import { useTranslation } from '../i18n';
import { useAuth } from '../auth/useAuth';
import { createTransientId } from '../utils/transientId';
import { DELETE_UNDO_DURATION_MS } from '../components/data-grid';
import { stashSeasonSwitchState } from './seasonSwitchState';
import {
  clearStoredActiveSeasonId,
  getStoredActiveSeasonId,
  setStoredActiveSeasonId,
} from './activeSeasonStorage';
import {
  readPendingSeasonDeletions,
  writePendingSeasonDeletions,
} from './pendingSeasonDeletionStorage';

export interface PendingSeasonDeletion {
  id: string;
  seasonId: number;
  message: string;
  visible: boolean;
  /** Epoch ms the undo window closes at — also used to persist across reload. */
  expiresAt: number;
  /** The deleted season was the active one, so undo must switch back to it. */
  restoreAsActive: boolean;
}

export function useActiveSeason() {
  const { t } = useTranslation(['navigation', 'common']);
  const { activeProjectId } = useAuth();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dueSuggestion, setDueSuggestion] = useState<SeasonDueSuggestion | null>(null);
  const [seasonCreationOptions, setSeasonCreationOptions] = useState<SeasonCreationOptions | null>(null);
  const [pendingDeletions, setPendingDeletions] = useState<PendingSeasonDeletion[]>(
    () => readPendingSeasonDeletions().map((entry) => ({ ...entry, visible: true })),
  );
  const pendingDeleteTimersRef = useRef<Map<string, number>>(new Map());

  const activeSeasonId = activeProjectId ? getStoredActiveSeasonId(activeProjectId) : null;

  const activeSeason = useMemo<Season | null>(() => {
    if (seasons.length === 0) {
      return null;
    }
    const stored = seasons.find((season) => season.id === activeSeasonId);
    // Newest season (seasons are ordered start_date desc) if the stored id is
    // missing, stale, or has never been set.
    return stored ?? seasons[0];
  }, [seasons, activeSeasonId]);

  // Keep the persisted id pointing at whatever season is actually active, so
  // the `X-Season-Id` request header (read straight from localStorage in
  // httpClient) never goes missing while the project has seasons — otherwise
  // planting-plan endpoints silently fall back to returning every season's
  // data. Covers a stored id that was cleared (active season deleted) or has
  // gone stale.
  useEffect(() => {
    if (activeProjectId && activeSeason && activeSeason.id !== activeSeasonId) {
      setStoredActiveSeasonId(activeProjectId, activeSeason.id);
    }
  }, [activeProjectId, activeSeason, activeSeasonId]);

  const reload = useCallback(async () => {
    if (!activeProjectId) {
      setSeasons([]);
      setDueSuggestion(null);
      setSeasonCreationOptions(null);
      setLoaded(true);
      return;
    }
    setLoading(true);
    setLoaded(false);
    setError(null);
    try {
      const [seasonsResponse, dueResponse, creationOptionsResponse] = await Promise.all([
        seasonAPI.list(),
        seasonAPI.dueSuggestion(),
        seasonAPI.creationOptions(),
      ]);
      setSeasons(seasonsResponse.data.results);
      setDueSuggestion(dueResponse.data);
      setSeasonCreationOptions(creationOptionsResponse.data);
    } catch (loadError) {
      setError(extractApiErrorMessage(loadError, t, t('navigation:seasonSwitcher.loadError')));
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [activeProjectId, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A season switch changes what every planting-plan-backed page shows —
  // reload the app the same deliberate way a project switch does (see
  // AuthContext.switchActiveProject) rather than trying to invalidate every
  // page's in-flight state individually.
  const switchSeason = useCallback((seasonId: number) => {
    if (!activeProjectId) {
      return;
    }
    setStoredActiveSeasonId(activeProjectId, seasonId);
    stashSeasonSwitchState(activeProjectId);
    window.location.reload();
  }, [activeProjectId]);

  const createSeason = useCallback(async (
    startDate: string,
    endDate: string,
    copyFromSeasonId?: number,
  ): Promise<Season> => {
    const response = await seasonAPI.create({ start_date: startDate, end_date: endDate });
    const created = response.data;
    if (copyFromSeasonId) {
      await seasonAPI.copyFrom(created.id, copyFromSeasonId);
    }
    await reload();
    return created;
  }, [reload]);

  const createTransitionSeasons = useCallback(async (copy: boolean) => {
    const response = await seasonAPI.createTransition({ copy });
    await reload();
    return response.data;
  }, [reload]);

  const renameSeason = useCallback(async (seasonId: number, customLabel: string): Promise<void> => {
    await seasonAPI.update(seasonId, { custom_label: customLabel });
    await reload();
  }, [reload]);

  const updateSeasonPeriod = useCallback(async (
    seasonId: number,
    period: { start_date: string; end_date: string },
  ): Promise<void> => {
    await seasonAPI.update(seasonId, period);
    await reload();
  }, [reload]);

  const copyDataInto = useCallback(async (targetSeasonId: number, sourceSeasonId: number) => {
    const response = await seasonAPI.copyFrom(targetSeasonId, sourceSeasonId);
    await reload();
    return response.data;
  }, [reload]);

  const removePendingDeletion = useCallback((deletionId: string) => {
    setPendingDeletions((current) => current.filter((deletion) => deletion.id !== deletionId));
  }, []);

  const expirePendingDeletion = useCallback((deletionId: string) => {
    pendingDeleteTimersRef.current.delete(deletionId);
    removePendingDeletion(deletionId);
  }, [removePendingDeletion]);

  const deleteSeason = useCallback(async (season: Season): Promise<void> => {
    const wasActive = activeSeason?.id === season.id;
    await seasonAPI.delete(season.id);

    const deletionId = createTransientId('season', season.id);
    const pending: PendingSeasonDeletion = {
      id: deletionId,
      seasonId: season.id,
      message: t('navigation:seasonSwitcher.deleted', { label: season.label }),
      visible: true,
      expiresAt: Date.now() + DELETE_UNDO_DURATION_MS,
      restoreAsActive: wasActive,
    };

    if (wasActive && activeProjectId) {
      // Deleting the active season changes the active-season context, which
      // the app only ever applies through a full reload (see switchSeason).
      // Point the stored id at the best remaining season first so the reloaded
      // app lands there, and stash the pending deletion so the undo snackbar
      // survives the reload.
      const fallback = seasons.find((candidate) => candidate.id !== season.id) ?? null;
      if (fallback) {
        setStoredActiveSeasonId(activeProjectId, fallback.id);
      } else {
        clearStoredActiveSeasonId(activeProjectId);
      }
      writePendingSeasonDeletions([
        ...readPendingSeasonDeletions(),
        {
          id: pending.id,
          seasonId: pending.seasonId,
          message: pending.message,
          expiresAt: pending.expiresAt,
          restoreAsActive: true,
        },
      ]);
      window.location.reload();
      return;
    }

    await reload();
    setPendingDeletions((current) => [...current, pending]);
  }, [activeProjectId, activeSeason, reload, seasons, t]);

  const undoPendingDeletion = useCallback(async (deletionId: string): Promise<void> => {
    const deletion = pendingDeletions.find((pending) => pending.id === deletionId);
    if (!deletion) {
      return;
    }
    const timerId = pendingDeleteTimersRef.current.get(deletionId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      pendingDeleteTimersRef.current.delete(deletionId);
    }
    await seasonAPI.undelete(deletion.seasonId);
    removePendingDeletion(deletionId);
    if (deletion.restoreAsActive && activeProjectId) {
      // We bounced off this season when it was deleted — go back to it. Clear
      // the stashed entry synchronously: the effect that mirrors state to
      // sessionStorage won't get to run before the reload, so without this the
      // snackbar would come back for an already-restored season.
      writePendingSeasonDeletions(
        readPendingSeasonDeletions().filter((entry) => entry.id !== deletionId),
      );
      setStoredActiveSeasonId(activeProjectId, deletion.seasonId);
      window.location.reload();
      return;
    }
    await reload();
  }, [activeProjectId, pendingDeletions, removePendingDeletion, reload]);

  const closePendingDeletionSnackbar = useCallback((deletionId: string) => {
    setPendingDeletions((current) => current.map((deletion) => (
      deletion.id === deletionId ? { ...deletion, visible: false } : deletion
    )));
  }, []);

  // Mirror pending deletions to sessionStorage so an in-flight undo survives a
  // reload, and (re)arm each entry's expiry timer — including for entries
  // rehydrated from storage after the reload that active-season deletion does.
  useEffect(() => {
    writePendingSeasonDeletions(pendingDeletions.map((deletion) => ({
      id: deletion.id,
      seasonId: deletion.seasonId,
      message: deletion.message,
      expiresAt: deletion.expiresAt,
      restoreAsActive: deletion.restoreAsActive,
    })));
    pendingDeletions.forEach((deletion) => {
      if (pendingDeleteTimersRef.current.has(deletion.id)) {
        return;
      }
      const remaining = Math.max(0, deletion.expiresAt - Date.now());
      const timerId = window.setTimeout(() => expirePendingDeletion(deletion.id), remaining);
      pendingDeleteTimersRef.current.set(deletion.id, timerId);
    });
  }, [pendingDeletions, expirePendingDeletion]);

  useEffect(() => {
    const timers = pendingDeleteTimersRef.current;
    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  return {
    seasons,
    activeSeason,
    loading,
    loaded,
    error,
    dueSuggestion,
    seasonCreationOptions,
    pendingDeletions,
    reload,
    switchSeason,
    createSeason,
    createTransitionSeasons,
    renameSeason,
    updateSeasonPeriod,
    copyDataInto,
    deleteSeason,
    undoPendingDeletion,
    closePendingDeletionSnackbar,
  };
}

export type UseActiveSeasonReturn = ReturnType<typeof useActiveSeason>;
