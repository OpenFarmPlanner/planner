/**
 * Hook for blocking navigation when there are unsaved changes.
 * 
 * Uses React Router's blocker API to prevent route changes
 * when there are unsaved changes that would be lost.
 * Also handles browser navigation via beforeunload.
 * 
 * @param shouldBlock Whether navigation should be blocked
 * @param message Optional custom message for the confirmation dialog
 * 
 * @remarks
 * Used in conjunction with useAutosaveDraft to prevent data loss.
 * Shows a confirmation dialog when user tries to navigate away.
 * Works with data routers (createBrowserRouter).
 */

import { useEffect, useRef } from 'react';
import { useBlocker, type Location } from 'react-router';
import { confirmAction } from '../utils/confirmAction';
import { useBeforeUnloadProtection } from './useBeforeUnloadProtection';

type BeforeNavigation = (destination: Location) => Promise<void | boolean> | void | boolean;

/**
 * Run onProceed before navigating, for example to save an in-progress edit.
 * Returning false retains the current route after a failed save.
 */
export function useNavigationBlocker(
  shouldBlock: boolean,
  message = 'You have unsaved changes. Are you sure you want to leave?',
  onProceed?: BeforeNavigation,
  confirmBeforeProceed = true,
  { protectBeforeUnload = true }: { protectBeforeUnload?: boolean } = {},
): void {
  useBeforeUnloadProtection(shouldBlock && protectBeforeUnload, message);
  // Use React Router's blocker for in-app navigation
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    // Only block if we're actually navigating to a different location
    return shouldBlock && currentLocation.pathname !== nextLocation.pathname;
  });

  // Handle blocker state. `blocker` is a fresh object every render (its
  // `.state` just happens to still read 'blocked'), and onProceed (e.g.
  // saving dirty rows) triggers several of those re-renders itself while
  // it's in flight. Without this guard each one re-runs the effect and
  // re-shows the confirm dialog for what is still the same blocked
  // transition. Reset once the router has moved past 'blocked'.
  const isHandlingBlockRef = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      isHandlingBlockRef.current = false;
      return;
    }
    if (isHandlingBlockRef.current) {
      return;
    }
    isHandlingBlockRef.current = true;

    const proceed = confirmBeforeProceed ? confirmAction(message) : true;
    if (proceed) {
      if (onProceed) {
        void Promise.resolve(onProceed(blocker.location)).then(allowed => {
          if (allowed === false) blocker.reset();
          else blocker.proceed();
        }, () => blocker.proceed());
      } else {
        blocker.proceed();
        isHandlingBlockRef.current = false;
      }
    } else {
      blocker.reset();
      isHandlingBlockRef.current = false;
    }
  }, [blocker, confirmBeforeProceed, message, onProceed]);
}
