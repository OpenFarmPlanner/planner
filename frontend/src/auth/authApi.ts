import type {
  AccountActionResponse,
  AccountDeleteResponse,
  AuthUser,
  MeResponse,
  ProjectSwitchResponse,
  TableEditHintEvent,
  TableEditHintState,
} from './types';
import i18n, { getCurrentUiLanguage } from '../i18n';
import { computeBaseURL } from '../api/httpClient';
import { GUEST_DEMO_RESTRICTED_CODE } from '../api/errors';
import { readCookie } from '../utils/cookies';
import { API_REQUEST_TIMEOUT_MS } from '../api/requestTimeout';
import { clearApiResponseCache } from '../api/responseCache';

const API_BASE = computeBaseURL(import.meta.env.PROD, import.meta.env.VITE_API_BASE_URL, import.meta.env.BASE_URL);

export class AuthApiError extends Error {
  code?: string;
  scheduledDeletionAt?: string;
  status?: number;
  retryAfterSeconds?: number;
  payload?: Record<string, unknown>;
  isNetworkError?: boolean;

  constructor(
    message: string,
    options: {
      code?: string;
      scheduledDeletionAt?: string;
      status?: number;
      retryAfterSeconds?: number;
      payload?: Record<string, unknown>;
      isNetworkError?: boolean;
    } | string = {},
    scheduledDeletionAt?: string,
  ) {
    super(message);
    if (typeof options === 'string') {
      this.code = options;
      this.scheduledDeletionAt = scheduledDeletionAt;
      return;
    }
    this.code = options.code;
    this.scheduledDeletionAt = options.scheduledDeletionAt;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.payload = options.payload;
    this.isNetworkError = options.isNetworkError;
  }
}

/**
 * A retry-after style duration: a positive, finite number of seconds, rounded
 * up so a caller never advertises a shorter wait than the server asked for.
 * Anything else (missing, zero, negative, unparseable) is `undefined`.
 */
export function parsePositiveSeconds(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.ceil(parsed);
}

export function getGuestDemoRetryAfterSeconds(error: AuthApiError): number | undefined {
  const structuredWait = parsePositiveSeconds(error.retryAfterSeconds) ?? parsePositiveSeconds(error.payload?.retry_after);
  if (structuredWait !== undefined) return structuredWait;

  // Older demo servers only include the wait duration in the DRF response text.
  const detail = error.payload?.detail;
  const match = typeof detail === 'string' ? /available in (\d+(?:\.\d+)?) seconds/i.exec(detail) : null;
  return match ? parsePositiveSeconds(match[1]) : undefined;
}

function resolveRetryAfterSeconds(
  response: Response,
  payload?: Record<string, unknown>,
): number | undefined {
  return parsePositiveSeconds(response.headers.get('Retry-After')) ?? parsePositiveSeconds(payload?.retry_after);
}

function statusErrorMessage(status: number, retryAfterSeconds?: number): string {
  if (status === 429) {
    return retryAfterSeconds === undefined
      ? i18n.t('auth:error.rateLimited')
      : i18n.t('auth:error.rateLimitedWithWait', { seconds: retryAfterSeconds });
  }
  return i18n.t(status >= 500 ? 'auth:error.serverUnavailable' : 'auth:error.requestFailed');
}

function extractError(response: Response, raw: string): AuthApiError {
  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(raw));
  } catch {
    payload = {};
  }
  const code = typeof payload.code === 'string' ? payload.code : undefined;
  const messageKey = code ? authErrorMessageKeys.get(code) : undefined;
  const retryAfterSeconds = resolveRetryAfterSeconds(response, payload);
  const message = messageKey
    ? i18n.t(messageKey)
    : formatFieldErrors(payload.field_errors) || statusErrorMessage(response.status, retryAfterSeconds);
  return new AuthApiError(message, {
    code,
    scheduledDeletionAt: typeof payload.scheduled_deletion_at === 'string' ? payload.scheduled_deletion_at : undefined,
    status: response.status,
    retryAfterSeconds,
    payload,
  });
}

const authErrorMessageKeys = new Map([
  [GUEST_DEMO_RESTRICTED_CODE, 'common:guestDemo.restricted'],
  ['invalid_credentials', 'auth:error.messages.invalidCredentials'],
  ['invalid_restore_credentials', 'auth:error.messages.invalidCredentials'],
  ['account_not_activated', 'auth:login.accountNotActivated'],
  ['account_pending_deletion', 'auth:error.messages.accountPendingDeletion'],
  ['invalid_password', 'auth:error.messages.invalidCurrentPassword'],
  ['deletion_grace_period_expired', 'auth:error.messages.deletionGracePeriodExpired'],
  ['invalid_activation_link', 'auth:activate.invalidLink'],
  ['invalid_activation_token', 'auth:activate.invalidLink'],
  ['invalid_password_reset_link', 'auth:resetPassword.invalidLink'],
  ['invalid_password_reset_token', 'auth:resetPassword.invalidLink'],
  ['invalid_email_change_link', 'account:emailConfirm.invalid'],
  ['email_already_exists', 'auth:error.messages.emailAlreadyExists'],
  ['email_send_failed', 'auth:error.messages.emailSendFailed'],
  ['turnstile_failed', 'auth:register.turnstile.rejected'],
  ['turnstile_unavailable', 'auth:register.turnstile.unavailable'],
  ['activation_resend_limit_reached', 'auth:activationEmail.limitReached'],
]);

const validationMessageKeys = new Map([
  ['required', 'auth:error.messages.required'],
  ['blank', 'auth:error.messages.required'],
  ['null', 'auth:error.messages.required'],
  ['min_length', 'auth:error.messages.tooShort'],
  ['max_length', 'auth:error.messages.tooLong'],
  ['password_mismatch', 'auth:register.passwordMismatch'],
  ['password_too_short', 'auth:error.messages.passwordTooShort'],
  ['password_too_common', 'auth:error.messages.passwordTooCommon'],
  ['password_too_similar', 'auth:error.messages.passwordTooSimilar'],
  ['password_entirely_numeric', 'auth:error.messages.passwordEntirelyNumeric'],
  ['email_already_exists', 'auth:error.messages.emailAlreadyExists'],
  ['disposable_email', 'auth:error.messages.disposableEmail'],
  ['email_unchanged', 'auth:error.messages.emailUnchanged'],
  ['public_display_name_taken', 'auth:error.messages.publicDisplayNameTaken'],
  ['public_display_name_reserved', 'auth:error.messages.publicDisplayNameReserved'],
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function localizeFieldErrors(field: string, value: unknown): string[] {
  const entries: unknown[] = Array.isArray(value) ? value : [];
  return entries.flatMap((entry) => {
    const { code, limit } = asRecord(entry);
    if (typeof code !== 'string') return [];
    if (typeof limit === 'number' && Number.isInteger(limit) && limit >= 0) {
      if (code === 'min_length') return [i18n.t('auth:error.messages.minLength', { count: limit })];
      if (code === 'max_length') return [i18n.t('auth:error.messages.maxLength', { count: limit })];
    }
    const key = code === 'invalid' && (field === 'email' || field === 'new_email')
      ? 'auth:error.messages.invalidEmail'
      : validationMessageKeys.get(code) ?? 'auth:error.messages.invalid';
    return [i18n.t(key)];
  });
}

/** Localized validation messages the backend returned for one field, if any. */
export function getLocalizedFieldError(error: unknown, field: string): string | null {
  if (!(error instanceof AuthApiError)) {
    return null;
  }
  const errors = asRecord(error.payload?.field_errors);
  return localizeFieldErrors(field, errors[field]).join(' ') || null;
}

function formatFieldErrors(value: unknown): string {
  return Object.entries(asRecord(value)).flatMap(([field, entries]) => {
    const label = field === 'non_field_errors' ? '' : i18n.t(`auth:error.fields.${field}`, { defaultValue: '' });
    return localizeFieldErrors(field, entries).map((message) => label ? `${label}: ${message}` : message);
  }).join('\n');
}

/** AuthApiError contains UI text selected by the auth client. */
export function getAuthErrorMessage(error: unknown, fallback: string): string {
  return error instanceof AuthApiError ? error.message : fallback;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Login, logout, consent and project switches change what the lists contain.
  if ((options.method ?? 'GET').toUpperCase() !== 'GET') {
    clearApiResponseCache();
  }
  let response: Response;
  let raw = '';
  try {
    response = await fetch(`${API_BASE}${path}`, {
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': i18n.resolvedLanguage ?? i18n.language ?? 'en',
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) {
      raw = await response.text();
    }
  } catch (error) {
    throw new AuthApiError(
      error instanceof DOMException && error.name === 'TimeoutError'
        ? i18n.t('auth:error.serverUnavailable')
        : i18n.t('auth:error.network'),
      { isNetworkError: true },
    );
  }

  if (!response.ok) {
    throw extractError(response, raw);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return await response.json() as T;
  } catch {
    throw new AuthApiError(
      i18n.t('auth:error.unexpectedResponse'),
      { status: response.status, code: 'unexpected_response' },
    );
  }
}

export async function ensureCsrfCookie(): Promise<void> {
  await request<{ detail: string }>('/auth/csrf/', { method: 'GET' });
}

export function csrfHeader(): Record<string, string> {
  return { 'X-CSRFToken': readCookie('csrftoken') ?? '' };
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>('/auth/me/', { method: 'GET' });
}

export interface RegisterResponse {
  detail: string;
  /** Set when the account was created but the activation email could not be sent. */
  code?: string;
  sender_email?: string;
}

/**
 * Append the current UI language to an endpoint that sends an email, so the
 * backend can write it in the language the user sees (docs/i18n.md, "E-Mails").
 */
function withEmailLanguage(path: string): string {
  return `${path}?language=${encodeURIComponent(getCurrentUiLanguage())}`;
}

export async function register(
  email: string,
  password: string,
  passwordConfirm: string,
  displayName = '',
  // Honeypot: always empty for real users, filled only by automated clients
  // that autofill every form field. Forwarded as-is to the backend, which
  // discards the submission silently when it is non-empty.
  website = '',
  // Cloudflare Turnstile token; empty when the build has no Turnstile site key.
  turnstileToken = '',
): Promise<RegisterResponse> {
  await ensureCsrfCookie();
  return request<RegisterResponse>(withEmailLanguage('/auth/register/'), {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({
      email,
      password,
      password_confirm: passwordConfirm,
      display_name: displayName,
      website,
      turnstile_token: turnstileToken,
    }),
  });
}

export interface TurnstileClientErrorReport {
  errorCode: string;
  pagePath: string;
  hostname: string;
  siteKey: string;
}

/** Tell the operators the Turnstile widget is misconfigured. Carries no user input. */
export async function reportTurnstileClientError(report: TurnstileClientErrorReport): Promise<void> {
  await ensureCsrfCookie();
  await request<void>('/client-errors/turnstile/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({
      error_code: report.errorCode,
      page_path: report.pagePath,
      hostname: report.hostname,
      site_key: report.siteKey,
    }),
  });
}

export async function acceptConsent(document: string): Promise<AuthUser> {
  await ensureCsrfCookie();
  return request<AuthUser>('/auth/consent/accept/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ document }),
  });
}

export async function activate(uid: string, token: string): Promise<AuthUser> {
  await ensureCsrfCookie();
  return request<AuthUser>('/auth/activate/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ uid, token }),
  });
}

export async function login(email: string, password: string): Promise<AuthUser> {
  await ensureCsrfCookie();
  return request<AuthUser>('/auth/login/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ email, password }),
  });
}

export async function startGuestDemo(): Promise<AuthUser> {
  await ensureCsrfCookie();
  try {
    return await request<AuthUser>('/auth/guest-demo/start/', { method: 'POST', headers: csrfHeader(), body: JSON.stringify({}) });
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 429) {
      error.retryAfterSeconds = getGuestDemoRetryAfterSeconds(error);
    }
    throw error;
  }
}

export async function endGuestDemo(): Promise<void> {
  await ensureCsrfCookie();
  await request('/auth/guest-demo/end/', { method: 'POST', headers: csrfHeader(), body: JSON.stringify({}) });
}

export async function logout(): Promise<void> {
  await ensureCsrfCookie();
  await request('/auth/logout/', { method: 'POST', headers: csrfHeader(), body: JSON.stringify({}) });
}

export async function requestAccountDeletion(password: string): Promise<AccountDeleteResponse> {
  await ensureCsrfCookie();
  return request<AccountDeleteResponse>('/auth/account/delete-request/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ password }),
  });
}

export function getAccountDataExport(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/auth/account/data-export/', { method: 'GET' });
}

export async function updateProfile(displayName: string): Promise<{ detail: string; user: AuthUser }> {
  await ensureCsrfCookie();
  return request<{ detail: string; user: AuthUser }>('/auth/account/profile/', {
    method: 'PATCH',
    headers: csrfHeader(),
    body: JSON.stringify({ display_name: displayName }),
  });
}

/**
 * Persist the signed-in user's UI language preference ('auto' or a supported code).
 *
 * The setting belongs to the user, not to a project, so two members of the
 * same project can use different interface languages at the same time.
 */
export async function updateUiLanguage(uiLanguage: string): Promise<{ ui_language: string; user: AuthUser }> {
  await ensureCsrfCookie();
  return request<{ ui_language: string; user: AuthUser }>('/auth/account/language/', {
    method: 'PUT',
    headers: csrfHeader(),
    body: JSON.stringify({ ui_language: uiLanguage }),
  });
}

/** Report one event of the inline table edit hint; returns the stored state. */
export async function recordTableEditHintEvent(event: TableEditHintEvent): Promise<TableEditHintState> {
  await ensureCsrfCookie();
  return request<TableEditHintState>('/auth/account/table-edit-hint/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ event }),
  });
}

export async function updatePublicDisplayName(publicDisplayName: string): Promise<{ detail: string; user: AuthUser }> {
  await ensureCsrfCookie();
  return request<{ detail: string; user: AuthUser }>('/auth/account/public-profile/', {
    method: 'PATCH',
    headers: csrfHeader(),
    body: JSON.stringify({ public_display_name: publicDisplayName }),
  });
}

export async function requestEmailChange(newEmail: string, currentPassword: string): Promise<AccountActionResponse> {
  await ensureCsrfCookie();
  return request<AccountActionResponse>('/auth/account/change-email/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ new_email: newEmail, current_password: currentPassword }),
  });
}

export async function confirmEmailChange(uid: string, token: string, requestId: string): Promise<AccountActionResponse> {
  await ensureCsrfCookie();
  return request<AccountActionResponse>('/auth/account/confirm-email-change/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ uid, token, request_id: requestId }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string, newPasswordConfirm: string): Promise<AccountActionResponse> {
  await ensureCsrfCookie();
  return request<AccountActionResponse>('/auth/account/change-password/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      new_password_confirm: newPasswordConfirm,
    }),
  });
}

export async function restoreAccount(email: string, password: string): Promise<AuthUser> {
  await ensureCsrfCookie();
  return request<AuthUser>('/auth/account/restore/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ email, password }),
  });
}

export interface ResendActivationResponse {
  detail: string;
  sender_email?: string;
  cooldown_seconds?: number;
}

export async function resendActivation(email: string): Promise<ResendActivationResponse> {
  await ensureCsrfCookie();
  return request<ResendActivationResponse>(withEmailLanguage('/auth/resend-activation/'), {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ email }),
  });
}

export async function requestPasswordReset(email: string): Promise<{ detail: string }> {
  await ensureCsrfCookie();
  return request<{ detail: string }>(withEmailLanguage('/auth/password-reset/'), {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ email }),
  });
}

export async function confirmPasswordReset(uid: string, token: string, password: string, passwordConfirm: string): Promise<{ detail: string }> {
  await ensureCsrfCookie();
  return request<{ detail: string }>('/auth/password-reset-confirm/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ uid, token, password, password_confirm: passwordConfirm }),
  });
}

export async function switchActiveProject(projectId: number): Promise<ProjectSwitchResponse> {
  await ensureCsrfCookie();
  return request<ProjectSwitchResponse>('/projects-switch/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ project_id: projectId }),
  });
}


export async function retireTaskDragHint(event: 'moved' | 'dismissed'): Promise<{ done: boolean }> {
  await ensureCsrfCookie();
  return request<{ done: boolean }>('/auth/account/task-drag-hint/', {
    method: 'POST', headers: csrfHeader(), body: JSON.stringify({ event }),
  });
}
