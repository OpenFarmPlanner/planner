export interface ProjectMembershipInfo {
  project_id: number;
  project_name: string;
  project_region?: ProjectRegion;
  role: 'admin' | 'member';
  is_demo_project?: boolean;
}

export type ProjectRegion = 'germany' | 'austria' | 'switzerland';

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  display_label: string;
  public_display_name: string;
  is_active: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  default_project_id: number | null;
  last_project_id: number | null;
  resolved_project_id: number | null;
  needs_project_selection: boolean;
  memberships: ProjectMembershipInfo[];
  account_pending_deletion: boolean;
  scheduled_deletion_at: string | null;
  /** Document keys (e.g. "terms") whose current version this user has not yet accepted. */
  pending_consents: string[];
  /** Whether the user accepted the current public-library contribution terms. */
  public_library_terms_accepted: boolean;
  /** Whether the user may review public crop library moderation queues. */
  is_public_library_moderator?: boolean;
  is_guest_demo: boolean;
  guest_demo_session_id: number | null;
  /** False for accounts that sign in only through Google/Microsoft. */
  has_password: boolean;
  /** Personal UI language: 'auto' (follow the browser), 'de' or 'en'. */
  ui_language?: string;
}

export interface AuthenticatedMeResponse extends AuthUser {
  authenticated: true;
}

export interface AnonymousMeResponse {
  authenticated: false;
}

export type MeResponse = AuthenticatedMeResponse | AnonymousMeResponse;

export interface ProjectSwitchResponse {
  detail: string;
  project_id: number;
  resolved_project_id: number | null;
  last_project_id: number | null;
  default_project_id: number | null;
}

export interface AccountDeleteResponse {
  detail: string;
  scheduled_deletion_at: string;
}

export interface AccountActionResponse {
  detail: string;
}
