import { createContext } from "react";
import type { RegisterResponse, ResendActivationResponse } from "./authApi";
import type { AuthUser } from "./types";

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  /** The session could not be checked because the server failed; says nothing about the session. */
  isAuthUnavailable: boolean;
  retryAuthCheck: () => Promise<void>;
  /**
   * The session has not been checked yet: public pages skip the startup
   * `/auth/me/` probe, so a signed-in visitor looks signed out there until
   * something calls `retryAuthCheck` (the login page does).
   */
  isSessionUnchecked: boolean;
  activeProjectId: number | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  startGuestDemo: () => Promise<AuthUser>;
  endGuestDemo: () => Promise<void>;
  logout: () => Promise<void>;
  register: (
    email: string,
    password: string,
    passwordConfirm: string,
    displayName?: string,
    website?: string,
    turnstileToken?: string,
  ) => Promise<RegisterResponse>;
  acceptConsent: (document: string) => Promise<AuthUser>;
  activate: (uid: string, token: string) => Promise<AuthUser>;
  resendActivation: (email: string) => Promise<ResendActivationResponse>;
  requestPasswordReset: (email: string) => Promise<string>;
  confirmPasswordReset: (
    uid: string,
    token: string,
    password: string,
    passwordConfirm: string,
  ) => Promise<string>;
  requestAccountDeletion: (
    password: string,
  ) => Promise<{ detail: string; scheduled_deletion_at: string }>;
  restoreAccount: (email: string, password: string) => Promise<AuthUser>;
  switchActiveProject: (projectId: number) => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
