import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  acceptConsent as acceptConsentRequest,
  activate as activateRequest,
  getMe,
  login as loginRequest,
  startGuestDemo as startGuestDemoRequest,
  endGuestDemo as endGuestDemoRequest,
  logout as logoutRequest,
  register as registerRequest,
  resendActivation as resendActivationRequest,
  requestPasswordReset as requestPasswordResetRequest,
  confirmPasswordReset as confirmPasswordResetRequest,
  requestAccountDeletion as requestAccountDeletionRequest,
  restoreAccount as restoreAccountRequest,
  switchActiveProject as switchActiveProjectRequest,
} from "./authApi";
import {
  AUTHENTICATION_EXPIRED_EVENT,
  type AuthenticationExpiredEventDetail,
} from "./authEvents";
import type { AuthUser } from "./types";
import { AuthContext, type AuthContextValue } from "./authContextShared";

const GUEST_DEMO_SESSION_KEY = 'guestDemoSessionId';
const PUBLIC_PATHS_WITHOUT_AUTH_PROBE = new Set([
  '/',
  '/impressum',
  '/datenschutz',
  '/nutzungsbedingungen',
]);

function currentRelativePathname(): string {
  const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const pathname = window.location.pathname;
  const relativePath = basePath && pathname.startsWith(basePath)
    ? pathname.slice(basePath.length) || '/'
    : pathname;
  return relativePath.replace(/\/+$/, '') || '/';
}

function shouldSkipStartupAuthProbe(): boolean {
  return PUBLIC_PATHS_WITHOUT_AUTH_PROBE.has(currentRelativePathname());
}

function clearGuestDemoSession(): void {
  window.sessionStorage.removeItem(GUEST_DEMO_SESSION_KEY);
}

function clearStoredProjectId(): void {
  window.localStorage.removeItem("activeProjectId");
}

function applyResolvedProjectId(me: AuthUser): number | null {
  if (me.resolved_project_id) {
    window.localStorage.setItem(
      "activeProjectId",
      String(me.resolved_project_id),
    );
    return me.resolved_project_id;
  }
  clearStoredProjectId();
  return null;
}

function mergeProjectSelection(
  user: AuthUser,
  projectState: {
    resolved_project_id?: number | null;
    last_project_id?: number | null;
    default_project_id?: number | null;
  },
): AuthUser {
  return {
    ...user,
    resolved_project_id: projectState.resolved_project_id ?? null,
    last_project_id: projectState.last_project_id ?? null,
    default_project_id: projectState.default_project_id ?? null,
  };
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const authGenerationRef = useRef(0);
  const lastAuthenticatedAtRef = useRef(0);

  const beginAuthMutation = useCallback((): number => {
    authGenerationRef.current += 1;
    return authGenerationRef.current;
  }, []);

  const clearAuthenticatedUser = useCallback((): void => {
    lastAuthenticatedAtRef.current = 0;
    setUser(null);
    setActiveProjectId(null);
    clearStoredProjectId();
    clearGuestDemoSession();
  }, []);

  const applyAuthenticatedUser = useCallback((me: AuthUser): void => {
    lastAuthenticatedAtRef.current = Date.now();
    setUser(me);
    setActiveProjectId(applyResolvedProjectId(me));
  }, []);

  const applyAuthenticatedUserBeforeNavigation = useCallback((me: AuthUser): void => {
    flushSync(() => {
      applyAuthenticatedUser(me);
    });
  }, [applyAuthenticatedUser]);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    const requestGeneration = authGenerationRef.current;
    try {
      const me = await getMe();
      if (requestGeneration !== authGenerationRef.current) {
        return null;
      }
      if (me.is_guest_demo && String(me.guest_demo_session_id) !== window.sessionStorage.getItem(GUEST_DEMO_SESSION_KEY)) {
        // The session cookie now belongs to a guest demo this tab didn't start
        // (sessionStorage, unlike the cookie, isn't shared across tabs — e.g. a
        // stale tab reloaded after another tab started a fresh demo). Only drop
        // this tab's own view of it; a real server-side logout would end the
        // *shared* session and sign the other, perfectly valid tab out too.
        clearAuthenticatedUser();
        return null;
      }
      applyAuthenticatedUser(me);
      return me;
    } catch {
      if (requestGeneration === authGenerationRef.current) {
        clearAuthenticatedUser();
      }
      return null;
    }
  }, [applyAuthenticatedUser, clearAuthenticatedUser]);

  useEffect(() => {
    void (async () => {
      if (shouldSkipStartupAuthProbe()) {
        setIsLoading(false);
        return;
      }
      try {
        await refreshUser();
      } catch {
        clearAuthenticatedUser();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [clearAuthenticatedUser, refreshUser]);

  useEffect(() => {
    function handleAuthenticationExpired(event: Event): void {
      const detail = 'detail' in event
        ? event.detail as Partial<AuthenticationExpiredEventDetail> | undefined
        : undefined;
      const requestStartedAt = typeof detail?.requestStartedAt === 'number'
        ? detail.requestStartedAt
        : null;
      if (requestStartedAt !== null && requestStartedAt <= lastAuthenticatedAtRef.current) {
        return;
      }
      clearAuthenticatedUser();
    }
    window.addEventListener(AUTHENTICATION_EXPIRED_EVENT, handleAuthenticationExpired);
    return () => window.removeEventListener(AUTHENTICATION_EXPIRED_EVENT, handleAuthenticationExpired);
  }, [clearAuthenticatedUser]);

  // localStorage is shared across tabs, but React state and the API's X-Project-Id
  // header (read fresh from localStorage per request, see httpClient.ts) are not: if
  // another tab switches the active project, this tab would keep showing stale data
  // while its own requests silently target the new project. Reload to resync.
  //
  // Guest demo sessions are excluded: the browser's session cookie is shared
  // across tabs, so two tabs each running their own demo can't stay
  // independently authenticated — starting a second demo silently replaces
  // the first tab's session. Without this guard, that project-id change
  // makes the first tab reload, which then resolves to the second tab's
  // project, which makes *that* tab reload in turn, forever.
  const isGuestDemo = Boolean(user?.is_guest_demo);
  useEffect(() => {
    if (isGuestDemo) {
      return undefined;
    }
    function handleStorageChange(event: StorageEvent): void {
      if (event.key !== "activeProjectId" || event.newValue === event.oldValue) {
        return;
      }
      window.location.reload();
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [isGuestDemo]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      activeProjectId,
      startGuestDemo: async () => {
        const generation = beginAuthMutation();
        const me = await startGuestDemoRequest();
        if (generation === authGenerationRef.current) {
          window.sessionStorage.setItem(GUEST_DEMO_SESSION_KEY, String(me.guest_demo_session_id));
          applyAuthenticatedUserBeforeNavigation(me);
        }
        return me;
      },
      endGuestDemo: async () => {
        const generation = beginAuthMutation();
        await endGuestDemoRequest();
        if (generation === authGenerationRef.current) {
          clearAuthenticatedUser();
        }
      },
      login: async (email, password) => {
        const generation = beginAuthMutation();
        const me = await loginRequest(email, password);
        if (generation === authGenerationRef.current) {
          applyAuthenticatedUserBeforeNavigation(me);
        }
        return me;
      },
      logout: async () => {
        const generation = beginAuthMutation();
        await logoutRequest();
        if (generation === authGenerationRef.current) {
          clearAuthenticatedUser();
        }
      },
      register: async (email, password, passwordConfirm, displayName = "", website = "") => {
        const response = await registerRequest(email, password, passwordConfirm, displayName, website);
        return response.detail;
      },
      acceptConsent: async (document) => {
        const generation = beginAuthMutation();
        const me = await acceptConsentRequest(document);
        if (generation === authGenerationRef.current) {
          applyAuthenticatedUserBeforeNavigation(me);
        }
        return me;
      },
      activate: async (uid, token) => {
        const generation = beginAuthMutation();
        const me = await activateRequest(uid, token);
        if (generation === authGenerationRef.current) {
          applyAuthenticatedUserBeforeNavigation(me);
        }
        return me;
      },
      resendActivation: async (email) => {
        const response = await resendActivationRequest(email);
        return response.detail;
      },
      requestPasswordReset: async (email) => {
        const response = await requestPasswordResetRequest(email);
        return response.detail;
      },
      confirmPasswordReset: async (uid, token, password, passwordConfirm) => {
        const response = await confirmPasswordResetRequest(
          uid,
          token,
          password,
          passwordConfirm,
        );
        return response.detail;
      },
      requestAccountDeletion: async (password) => {
        const generation = beginAuthMutation();
        const response = await requestAccountDeletionRequest(password);
        if (generation === authGenerationRef.current) {
          clearAuthenticatedUser();
        }
        return response;
      },
      restoreAccount: async (email, password) => {
        const generation = beginAuthMutation();
        const me = await restoreAccountRequest(email, password);
        if (generation === authGenerationRef.current) {
          applyAuthenticatedUserBeforeNavigation(me);
        }
        return me;
      },
      switchActiveProject: async (projectId: number) => {
        const switchResult = await switchActiveProjectRequest(projectId);
        const resolvedId = switchResult.resolved_project_id ?? projectId;
        window.localStorage.setItem("activeProjectId", String(resolvedId));
        setActiveProjectId(resolvedId);
        const refreshed = await refreshUser();
        if (!refreshed && user) {
          setUser(mergeProjectSelection(user, switchResult));
        }
      },
      refreshUser,
    }),
    [
      activeProjectId,
      applyAuthenticatedUserBeforeNavigation,
      beginAuthMutation,
      clearAuthenticatedUser,
      isLoading,
      refreshUser,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
