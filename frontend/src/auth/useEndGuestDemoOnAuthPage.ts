import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';

/**
 * Ends an active guest-demo session when the visitor opens the login or
 * registration page, so they reach the real form instead of being sent back
 * into the demo. Uses the same server-side cleanup as "Demo beenden"; real
 * accounts are untouched. `is_guest_demo` comes from the backend `/me` payload.
 *
 * Returns whether the current user is a guest demo (still being ended).
 */
export function useEndGuestDemoOnAuthPage(): boolean {
  const { user, endGuestDemo, logout } = useAuth();
  const isGuestDemo = Boolean(user?.is_guest_demo);
  const endingRef = useRef(false);

  useEffect(() => {
    if (!isGuestDemo || endingRef.current) {
      return;
    }
    endingRef.current = true;
    void endGuestDemo()
      .catch(() => logout())
      .catch(() => undefined)
      .finally(() => {
        endingRef.current = false;
      });
  }, [isGuestDemo, endGuestDemo, logout]);

  return isGuestDemo;
}
