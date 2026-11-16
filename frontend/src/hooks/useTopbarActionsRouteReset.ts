import { useLayoutEffect, type ReactNode } from 'react';
import type { TopbarContextAction } from '../navigation/topbarTypes';

// Must run as a layout effect: passive effects fire child-before-parent, so a
// plain useEffect here would run after a newly routed page's own
// useTopbarContextActions effect and wipe out the actions it just registered
// whenever the page mounts in the same commit as the route change (e.g. once
// its lazy chunk is already cached). A layout effect always completes before
// any passive effect in the same commit, so the reset can never race the
// child's registration.
export function useTopbarActionsRouteReset(
  pathname: string,
  setTopbarContextActions: (actions: TopbarContextAction[]) => void,
  setTopbarTitleActions: (actions: TopbarContextAction[]) => void,
  setTopbarWorkspaceControls?: (controls: ReactNode) => void,
): void {
  useLayoutEffect(() => {
    setTopbarContextActions([]);
    setTopbarTitleActions([]);
    setTopbarWorkspaceControls?.(null);
  }, [pathname, setTopbarContextActions, setTopbarTitleActions, setTopbarWorkspaceControls]);
}
