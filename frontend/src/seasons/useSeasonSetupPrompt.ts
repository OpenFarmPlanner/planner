import { useCallback, useEffect, useState } from 'react';

import { seasonSetupAPI } from '../api/api';
import type { SeasonSetupStatus } from '../api/types';
import { isProjectIndependentRoute } from '../navigation/mainNavigation';
import { dismissSeasonSetup, isSeasonSetupDismissed } from './seasonSetupDismissal';

interface SeasonSetupPrompt {
  /** The status to hand `SeasonSetupDialog`, or null while it should stay closed. */
  status: SeasonSetupStatus | null;
  /** Remember the dismissal for this project and stop prompting. */
  dismiss: () => void;
}

/**
 * Whether the first-run season setup dialog should be shown for the active
 * project, and the status it needs.
 *
 * The dismissal is per project and persisted, so declining it once does not
 * re-prompt on every navigation. Project-independent routes (account settings,
 * the public library, …) never prompt: there is no project there to set up.
 */
export function useSeasonSetupPrompt(
  activeProjectId: number | null | undefined,
  pathname: string,
): SeasonSetupPrompt {
  const [status, setStatus] = useState<SeasonSetupStatus | null>(null);
  const [dismissed, setDismissed] = useState(
    () => (activeProjectId ? isSeasonSetupDismissed(activeProjectId) : false),
  );

  useEffect(() => {
    setDismissed(activeProjectId ? isSeasonSetupDismissed(activeProjectId) : false);
    if (!activeProjectId) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    void seasonSetupAPI.status().then((response) => {
      if (!cancelled) {
        setStatus(response.data);
      }
    }).catch((error: unknown) => {
      console.error('Error loading season setup status:', error);
    });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const dismiss = useCallback((): void => {
    if (activeProjectId) {
      dismissSeasonSetup(activeProjectId);
    }
    setDismissed(true);
  }, [activeProjectId]);

  const shouldPrompt = Boolean(status?.needs_setup) && !dismissed && !isProjectIndependentRoute(pathname);

  return { status: shouldPrompt ? status : null, dismiss };
}
