import { useCallback, useState } from 'react';

import type { PlantingPlan } from '../../../api/types';
import type { RotationAcceptanceControls } from './RotationCheckPanel';

interface PersistedAcceptance {
  userLabel: string | null;
  acceptedAt: string | null;
}

interface AcceptanceDraftState {
  accepted: boolean;
  /** The crop/bed/date key the current `accepted` value was given for. */
  key: string | null;
  persisted: PersistedAcceptance | null;
  persistedKey: string | null;
}

const EMPTY_STATE: AcceptanceDraftState = { accepted: false, key: null, persisted: null, persistedKey: null };

/** Identity of a plan's place in the crop rotation: crop, bed and planting date. */
export const buildRotationKey = (crop: string, bed: string, plantingDate: string): string => (
  `${crop}|${bed}|${plantingDate}`
);

/**
 * The planting-plan dialog's "Bewusst so planen" state. An acceptance only
 * holds for the crop, bed and planting date it was given for — the same rule
 * the backend applies when it resets a stored acceptance on change.
 */
export function useRotationAcceptanceDraft() {
  const [state, setState] = useState<AcceptanceDraftState>(EMPTY_STATE);

  const resetFromPlan = useCallback((plan: Pick<PlantingPlan, 'rotation_conflict_accepted' | 'rotation_conflict_accepted_at' | 'rotation_conflict_accepted_by_user'> | null, key: string): void => {
    if (!plan?.rotation_conflict_accepted) {
      setState(EMPTY_STATE);
      return;
    }
    setState({
      accepted: true,
      key,
      persisted: {
        userLabel: plan.rotation_conflict_accepted_by_user?.display_name ?? null,
        acceptedAt: plan.rotation_conflict_accepted_at ?? null,
      },
      persistedKey: key,
    });
  }, []);

  const getControls = useCallback((currentKey: string): RotationAcceptanceControls => {
    const accepted = state.accepted && state.key === currentKey;
    const persistedApplies = state.persisted !== null && state.persistedKey === currentKey;
    return {
      accepted,
      persisted: accepted && persistedApplies ? state.persisted : null,
      onChange: (nextAccepted: boolean) => setState((previous) => ({
        ...previous,
        accepted: nextAccepted,
        key: currentKey,
        // Withdrawing a stored acceptance and ticking the box again makes it a
        // new acceptance, stamped with the current user on save.
        persisted: nextAccepted ? previous.persisted : null,
      })),
    };
  }, [state]);

  /** The `rotation_conflict_accepted` value to send, or nothing when unchanged. */
  const getPayload = useCallback((currentKey: string): Pick<PlantingPlan, 'rotation_conflict_accepted'> => {
    const accepted = state.accepted && state.key === currentKey;
    const storedStillApplies = state.persistedKey === currentKey;
    const wasStored = storedStillApplies && state.persisted !== null;
    if (accepted && !wasStored) {
      return { rotation_conflict_accepted: true };
    }
    if (!accepted && state.persistedKey !== null && storedStillApplies) {
      return { rotation_conflict_accepted: false };
    }
    return {};
  }, [state]);

  return { resetFromPlan, getControls, getPayload };
}
