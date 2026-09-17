import type { AccountActionResponse, AccountDeleteResponse, AuthUser, ProjectSwitchResponse } from './types';
import i18n from '../i18n';
import { computeBaseURL } from '../api/httpClient';
import { readCookie } from '../utils/cookies';

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

function parseRetrySecondsFromDetail(detail: string): number | undefined {
  const match = /available in (\d+(?:\.\d+)?) seconds/i.exec(detail);
  return match ? parsePositiveSeconds(match[1]) : undefined;
}

function resolveRetryAfterSeconds(
  response: Response,
  payload?: Record<string, unknown>,
): number | undefined {
  const headerSeconds = parsePositiveSeconds(response.headers.get('Retry-After'));
  if (headerSeconds !== undefined) {
    return headerSeconds;
  }

  const payloadSeconds = parsePositiveSeconds(payload?.retry_after);
  if (payloadSeconds !== undefined) {
    return payloadSeconds;
  }

  return typeof payload?.detail === 'string' ? parseRetrySecondsFromDetail(payload.detail) : undefined;
}

function extractError(response: Response, raw: string): AuthApiError {
  const fallbackMessage = translateOrFallback('auth:error.requestFailed', 'Anfrage fehlgeschlagen.');
  const looksLikeHtml = /^\s*<!doctype html/i.test(raw) || /^\s*<html/i.test(raw) || /<body[\s>]/i.test(raw);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const detail = toUserFriendlyErrorMessage(parsed);
    const code = typeof parsed.code === 'string' ? parsed.code : undefined;
    const scheduledDeletionAt = typeof parsed.scheduled_deletion_at === 'string' ? parsed.scheduled_deletion_at : undefined;
    return new AuthApiError(detail || fallbackMessage, {
      code,
      scheduledDeletionAt,
      status: response.status,
      retryAfterSeconds: resolveRetryAfterSeconds(response, parsed),
      payload: parsed,
    });
  } catch {
    if (looksLikeHtml) {
      return new AuthApiError(fallbackMessage, { status: response.status });
    }
    return new AuthApiError(fallbackMessage, { status: response.status });
  }
}

const authFieldLabelFallbacks: Record<string, string> = {
  email: 'E-Mail',
  password: 'Passwort',
  password_confirm: 'Passwort bestätigen',
  uid: 'Benutzerkennung',
  token: 'Token',
  display_name: 'Anzeigename',
  public_display_name: 'Name bei Veröffentlichungen',
  document: 'Dokument',
  detail: 'Fehler',
  non_field_errors: 'Fehler',
};

const knownValidationMessageKeys: Record<string, string> = {
  'This field is required.': 'required',
  'Enter a valid email address.': 'invalidEmail',
  'This password is too common.': 'passwordTooCommon',
  'This password is too short.': 'passwordTooShort',
  'This password is entirely numeric.': 'passwordEntirelyNumeric',
  'Unable to log in with provided credentials.': 'invalidCredentials',
  'Die E-Mail konnte nicht gesendet werden. Bitte kontaktiere [info@openfarmplanner.org](mailto:info@openfarmplanner.org).': 'emailSendFailed',
  'Dein Konto wurde erstellt, aber die Aktivierungs-E-Mail konnte nicht gesendet werden. Bitte kontaktiere [info@openfarmplanner.org](mailto:info@openfarmplanner.org), damit wir dein Konto aktivieren oder dir den Link erneut senden können.': 'activationEmailSendFailed',
  'Dieser Name wird bereits verwendet.': 'publicDisplayNameTaken',
};

function translateOrFallback(key: string, fallback: string, options?: Record<string, unknown>): string {
  const translated = i18n.t(key, options);
  return translated === key ? fallback : translated;
}

function localizeBackendMessage(message: string): string {
  const trimmed = message.trim();
  const looksLikeHtml = /^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed) || /<body[\s>]/i.test(trimmed);
  if (looksLikeHtml) {
    return translateOrFallback('auth:error.requestFailed', 'Anfrage fehlgeschlagen.');
  }
  const mappedKey = knownValidationMessageKeys[trimmed];
  if (mappedKey) {
    return translateOrFallback(`auth:error.messages.${mappedKey}`, trimmed);
  }

  const minLengthMatch = /^Ensure this field has at least (\d+) characters\.$/.exec(trimmed);
  if (minLengthMatch) {
    return translateOrFallback('auth:error.messages.minLength', trimmed, { count: Number(minLengthMatch[1]) });
  }

  const maxLengthMatch = /^Ensure this field has no more than (\d+) characters\.$/.exec(trimmed);
  if (maxLengthMatch) {
    return translateOrFallback('auth:error.messages.maxLength', trimmed, { count: Number(maxLengthMatch[1]) });
  }

  return trimmed;
}

function flattenErrorStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenErrorStrings(entry));
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
    return [value.message];
  }
  return [];
}

function resolveFieldLabel(field: string): string {
  const translated = i18n.t(`auth:error.fields.${field}`);
  if (translated !== `auth:error.fields.${field}`) {
    return translated;
  }
  return authFieldLabelFallbacks[field] ?? field;
}

function toUserFriendlyErrorMessage(payload: Record<string, unknown>): string {
  const explicitMessage = typeof payload.message === 'string' ? localizeBackendMessage(payload.message) : '';
  const explicitDetail = typeof payload.detail === 'string' ? localizeBackendMessage(payload.detail) : '';
  const formattedErrors: string[] = [];

  for (const [field, value] of Object.entries(payload)) {
    if (field === 'code' || field === 'scheduled_deletion_at' || field === 'detail' || field === 'message') {
      continue;
    }
    const localizedMessages = flattenErrorStrings(value).map((message) => localizeBackendMessage(message));
    if (localizedMessages.length === 0) {
      continue;
    }

    if (field === 'non_field_errors') {
      formattedErrors.push(...localizedMessages);
      continue;
    }

    const fieldLabel = resolveFieldLabel(field);
    formattedErrors.push(...localizedMessages.map((message) => `${fieldLabel}: ${message}`));
  }

  if (formattedErrors.length > 0) {
    return formattedErrors.join('\n');
  }
  if (explicitMessage) {
    return explicitMessage;
  }
  if (explicitDetail) {
    return explicitDetail;
  }
  return translateOrFallback('auth:error.requestFailed', 'Anfrage fehlgeschlagen.');
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': i18n.resolvedLanguage ?? i18n.language ?? 'en',
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new AuthApiError(
      translateOrFallback('auth:error.network', 'Die Anfrage konnte nicht gesendet werden.'),
      { isNetworkError: true },
    );
  }

  if (!response.ok) {
    throw extractError(response, await response.text());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return await response.json() as T;
  } catch {
    throw new AuthApiError(
      translateOrFallback('auth:error.unexpectedResponse', 'Die Antwort des Servers konnte nicht gelesen werden.'),
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

export function getMe(): Promise<AuthUser> {
  return request<AuthUser>('/auth/me/', { method: 'GET' });
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
): Promise<{ detail: string }> {
  await ensureCsrfCookie();
  return request<{ detail: string }>('/auth/register/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({
      email,
      password,
      password_confirm: passwordConfirm,
      display_name: displayName,
      website,
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
  return request<AuthUser>('/auth/guest-demo/start/', { method: 'POST', headers: csrfHeader(), body: JSON.stringify({}) });
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
 * Persist the signed-in user's UI language preference ('auto' | 'de' | 'en').
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

export async function resendActivation(email: string): Promise<{ detail: string }> {
  await ensureCsrfCookie();
  return request<{ detail: string }>('/auth/resend-activation/', {
    method: 'POST',
    headers: csrfHeader(),
    body: JSON.stringify({ email }),
  });
}

export async function requestPasswordReset(email: string): Promise<{ detail: string }> {
  await ensureCsrfCookie();
  return request<{ detail: string }>('/auth/password-reset/', {
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
