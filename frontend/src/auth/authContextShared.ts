import { createContext } from "react";
import type { AuthUser } from "./types";

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
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
  ) => Promise<string>;
  acceptConsent: (document: string) => Promise<AuthUser>;
  activate: (uid: string, token: string) => Promise<AuthUser>;
  resendActivation: (email: string) => Promise<string>;
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
