import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/config';
import {
  AuthApiError,
  acceptConsent,
  activate,
  changePassword,
  confirmEmailChange,
  confirmPasswordReset,
  csrfHeader,
  endGuestDemo,
  ensureCsrfCookie,
  getAccountDataExport,
  getMe,
  login,
  logout,
  parsePositiveSeconds,
  register,
  request,
  requestAccountDeletion,
  requestEmailChange,
  requestPasswordReset,
  resendActivation,
  restoreAccount,
  startGuestDemo,
  switchActiveProject,
  updateProfile,
  updatePublicDisplayName,
  updateUiLanguage,
} from './authApi';

type MockResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

function installFetchMock(responses: MockResponse[]): void {
  const queue = [...responses];
  vi.stubGlobal('fetch', vi.fn(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error('Unexpected fetch call');
    }
    const bodyText = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return {
      ok: next.ok,
      status: next.status,
      headers: new Headers(),
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText),
    } as Response;
  }));
}

describe('authApi error mapping', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'csrftoken=test-token',
      writable: true,
    });
  });

  it('does not send an accept_terms field during registration', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ detail: 'ok' }),
      json: async () => ({ detail: 'ok' }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await register('new@example.com', 'new-safe-password-123', 'new-safe-password-123', '');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const registerInit = fetchMock.mock.calls[1]?.[1];
    if (!registerInit?.body) {
      throw new Error('Expected registration request body');
    }
    const body = JSON.parse(String(registerInit.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('accept_terms');
  });

  it('sends the current UI language when starting the guest demo', async () => {
    await i18n.changeLanguage('en');
    const fetchMock = vi.fn<typeof fetch>(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 1 }),
      json: async () => ({ id: 1 }),
      headers: new Headers(),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await startGuestDemo();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const demoInit = fetchMock.mock.calls[1]?.[1];
    expect(demoInit?.headers).toMatchObject({ 'Accept-Language': 'en' });
  });

  it('does not expose non_field_errors and translates typical login messages', async () => {
    installFetchMock([
      { ok: true, status: 200, body: { detail: 'ok' } },
      {
        ok: false,
        status: 400,
        body: {
          non_field_errors: ['Unable to log in with provided credentials.'],
          password: ['This field is required.'],
        },
      },
    ]);

    try {
      await login('demo@example.com', '');
      throw new Error('Expected login to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AuthApiError);
      const authError = error as AuthApiError;
      expect(authError.message).toContain('Anmeldung mit den eingegebenen Zugangsdaten ist fehlgeschlagen.');
      expect(authError.message).toContain('Passwort: Dieses Feld ist erforderlich.');
      expect(authError.message).not.toContain('non_field_errors');
    }
  });

  it('translates common Django password and email validation messages to German', async () => {
    installFetchMock([
      { ok: true, status: 200, body: { detail: 'ok' } },
      {
        ok: false,
        status: 400,
        body: {
          email: ['Enter a valid email address.'],
          password: ['This password is too common.', 'This password is too short.'],
        },
      },
    ]);

    try {
      await register('bad-email', '123', '123');
      throw new Error('Expected register to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AuthApiError);
      const authError = error as AuthApiError;
      expect(authError.message).toContain('E-Mail: Bitte gib eine gültige E-Mail-Adresse ein.');
      expect(authError.message).toContain('Passwort: Dieses Passwort ist zu häufig.');
      expect(authError.message).toContain('Passwort: Dieses Passwort ist zu kurz.');
    }
  });

  it('uses structured message field for email_send_failed responses', async () => {
    installFetchMock([
      { ok: true, status: 200, body: { detail: 'ok' } },
      {
        ok: false,
        status: 503,
        body: {
          code: 'email_send_failed',
          message: 'Dein Konto wurde erstellt, aber die Aktivierungs-E-Mail konnte nicht gesendet werden.',
        },
      },
    ]);

    await expect(register('bad-email', '123', '123')).rejects.toMatchObject({
      message: 'Dein Konto wurde erstellt, aber die Aktivierungs-E-Mail konnte nicht gesendet werden.',
      code: 'email_send_failed',
    });
  });

  it('does not expose raw HTML error responses', async () => {
    installFetchMock([
      { ok: true, status: 200, body: { detail: 'ok' } },
      {
        ok: false,
        status: 500,
        body: '<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><pre>SMTP stack</pre></body></html>',
      },
    ]);

    await expect(login('demo@example.com', 'secret')).rejects.toMatchObject({
      message: 'Anfrage fehlgeschlagen.',
    });
  });
});

/**
 * The API base the module resolved at import time, recovered by making one
 * request whose path is known. Asserting against `base + path` catches a
 * wrongly prefixed endpoint, which a substring or suffix match would not.
 */
async function resolveApiBase(): Promise<string> {
  const fetchMock = installOkFetch();
  await ensureCsrfCookie();
  const url = String(fetchMock.mock.calls[0]?.[0]);
  vi.unstubAllGlobals();
  return url.slice(0, url.length - '/auth/csrf/'.length);
}

/** A fetch mock that always succeeds, for asserting what was *sent*. */
function installOkFetch(body: unknown = { detail: 'ok' }, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => ({
    ok: true,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('parsePositiveSeconds', () => {
  it('rounds up, so a caller never advertises a shorter wait than asked for', () => {
    expect(parsePositiveSeconds(1.1)).toBe(2);
    expect(parsePositiveSeconds('30.4')).toBe(31);
    expect(parsePositiveSeconds(30)).toBe(30);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['missing', undefined],
    ['null', null],
    ['unparseable', 'bald'],
    ['infinite', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('treats %s as no duration at all', (_label, value) => {
    expect(parsePositiveSeconds(value)).toBeUndefined();
  });

  it('reads an empty string as no duration, not as zero seconds', () => {
    // `Number('')` is 0, which the positivity check rejects — worth pinning,
    // since an absent Retry-After header reaches here as an empty value.
    expect(parsePositiveSeconds('')).toBeUndefined();
  });
});

describe('AuthApiError', () => {
  it('accepts the option bag form', () => {
    const error = new AuthApiError('kaputt', {
      code: 'x', status: 429, retryAfterSeconds: 30, isNetworkError: true,
    });
    expect(error).toMatchObject({
      message: 'kaputt', code: 'x', status: 429, retryAfterSeconds: 30, isNetworkError: true,
    });
  });

  it('still accepts the older positional code/date form', () => {
    // Kept for callers that construct the error with two trailing strings.
    const error = new AuthApiError('weg', 'account_deleted', '2026-01-01');
    expect(error.code).toBe('account_deleted');
    expect(error.scheduledDeletionAt).toBe('2026-01-01');
    expect(error.status).toBeUndefined();
  });
});

describe('csrfHeader', () => {
  it('reads the token from the cookie', () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true, writable: true, value: 'csrftoken=abc123',
    });
    expect(csrfHeader()).toEqual({ 'X-CSRFToken': 'abc123' });
  });

  it('sends an empty token rather than omitting the header when no cookie is set', () => {
    // Omitting the header entirely would make Django reject the request with a
    // different, less diagnosable error than "CSRF token missing".
    Object.defineProperty(document, 'cookie', {
      configurable: true, writable: true, value: '',
    });
    expect(csrfHeader()).toEqual({ 'X-CSRFToken': '' });
  });
});

describe('request', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, 'cookie', {
      configurable: true, writable: true, value: 'csrftoken=test-token',
    });
  });

  it('sends cookies, since the session is cookie-based', async () => {
    const fetchMock = installOkFetch();
    await getMe();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('lets a caller override the default Content-Type', async () => {
    const fetchMock = installOkFetch();
    await login('a@b.de', 'pw');
    // csrfHeader is spread after the defaults, so per-call headers win.
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRFToken': 'test-token',
    });
  });

  it('lets a caller override the default Accept-Language', async () => {
    // No endpoint wrapper passes this header today, so the ordering of the
    // spread against the default is only observable through `request` itself —
    // which is exported, and is where the guarantee belongs.
    const fetchMock = installOkFetch();

    await request('/auth/me/', { method: 'GET', headers: { 'Accept-Language': 'fr' } });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Accept-Language': 'fr' });
  });

  it('reports a failed connection as a network error, not a server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await expect(getMe()).rejects.toMatchObject({
      isNetworkError: true,
      status: undefined,
    });
  });

  it('returns nothing for a 204, rather than failing to parse an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => '',
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    } as unknown as Response)));

    await expect(getMe()).resolves.toBeUndefined();
  });

  it('reports an unreadable success body as unexpected_response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'nonsense',
      json: async () => { throw new SyntaxError('Unexpected token'); },
    } as unknown as Response)));

    await expect(getMe()).rejects.toMatchObject({
      code: 'unexpected_response',
      status: 200,
    });
  });
});

describe('request — retry-after resolution', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, 'cookie', {
      configurable: true, writable: true, value: 'csrftoken=test-token',
    });
  });

  const throttled = (headers: Headers, body: Record<string, unknown>) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      headers,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response)));
  };

  it('prefers the Retry-After header over anything in the body', async () => {
    throttled(new Headers({ 'Retry-After': '12' }), { retry_after: 99, detail: 'available in 77 seconds' });
    await expect(getMe()).rejects.toMatchObject({ retryAfterSeconds: 12 });
  });

  it('falls back to the payload field when the header is absent', async () => {
    throttled(new Headers(), { retry_after: 99, detail: 'available in 77 seconds' });
    await expect(getMe()).rejects.toMatchObject({ retryAfterSeconds: 99 });
  });

  it('last of all, digs the seconds out of the detail sentence', async () => {
    throttled(new Headers(), { detail: 'Request was throttled. Expected available in 77.3 seconds.' });
    await expect(getMe()).rejects.toMatchObject({ retryAfterSeconds: 78 });
  });

  it('reports no wait at all when the detail names no seconds', async () => {
    throttled(new Headers(), { detail: 'Zu viele Anfragen.' });
    await expect(getMe()).rejects.toMatchObject({ retryAfterSeconds: undefined });
  });
});

describe('auth endpoints', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, 'cookie', {
      configurable: true, writable: true, value: 'csrftoken=test-token',
    });
  });

  // Path, method and payload shape are the whole contract of these wrappers,
  // and a typo in any of them is invisible until the endpoint is called for
  // real. Each row pins all three.
  const cases: [string, () => Promise<unknown>, string, string, unknown][] = [
    ['acceptConsent', () => acceptConsent('privacy'), '/auth/consent/accept/', 'POST',
      { document: 'privacy' }],
    ['activate', () => activate('u1', 'tok'), '/auth/activate/', 'POST',
      { uid: 'u1', token: 'tok' }],
    ['login', () => login('a@b.de', 'pw'), '/auth/login/', 'POST',
      { email: 'a@b.de', password: 'pw' }],
    ['startGuestDemo', () => startGuestDemo(), '/auth/guest-demo/start/', 'POST', {}],
    ['endGuestDemo', () => endGuestDemo(), '/auth/guest-demo/end/', 'POST', {}],
    ['logout', () => logout(), '/auth/logout/', 'POST', {}],
    ['requestAccountDeletion', () => requestAccountDeletion('pw'),
      '/auth/account/delete-request/', 'POST', { password: 'pw' }],
    ['updateProfile', () => updateProfile('Martina'), '/auth/account/profile/', 'PATCH',
      { display_name: 'Martina' }],
    ['updateUiLanguage', () => updateUiLanguage('de'), '/auth/account/language/', 'PUT',
      { ui_language: 'de' }],
    ['updatePublicDisplayName', () => updatePublicDisplayName('Hof Nord'),
      '/auth/account/public-profile/', 'PATCH', { public_display_name: 'Hof Nord' }],
    ['requestEmailChange', () => requestEmailChange('neu@b.de', 'pw'),
      '/auth/account/change-email/', 'POST', { new_email: 'neu@b.de', current_password: 'pw' }],
    ['confirmEmailChange', () => confirmEmailChange('u1', 'tok', 'req1'),
      '/auth/account/confirm-email-change/', 'POST', { uid: 'u1', token: 'tok', request_id: 'req1' }],
    ['changePassword', () => changePassword('alt', 'neu', 'neu'),
      '/auth/account/change-password/', 'POST',
      { current_password: 'alt', new_password: 'neu', new_password_confirm: 'neu' }],
    ['restoreAccount', () => restoreAccount('a@b.de', 'pw'), '/auth/account/restore/', 'POST',
      { email: 'a@b.de', password: 'pw' }],
    ['resendActivation', () => resendActivation('a@b.de'), '/auth/resend-activation/', 'POST',
      { email: 'a@b.de' }],
    ['requestPasswordReset', () => requestPasswordReset('a@b.de'), '/auth/password-reset/', 'POST',
      { email: 'a@b.de' }],
    ['confirmPasswordReset', () => confirmPasswordReset('u1', 'tok', 'neu', 'neu'),
      '/auth/password-reset-confirm/', 'POST',
      { uid: 'u1', token: 'tok', password: 'neu', password_confirm: 'neu' }],
    ['switchActiveProject', () => switchActiveProject(7), '/projects-switch/', 'POST',
      { project_id: 7 }],
  ];

  it.each(cases)('%s posts the right path, method and payload', async (_name, call, path, method, body) => {
    const fetchMock = installOkFetch();

    await call();

    // Compared against the full URL, not by substring: `/projects-switch/` is
    // a substring of `/auth/projects-switch/`, so `toContain` would accept a
    // wrongly prefixed path. The base is recovered from the CSRF call, whose
    // path is known, rather than re-deriving it from the Vite env.
    const csrfUrl = String(fetchMock.mock.calls[0]?.[0]);
    const base = csrfUrl.slice(0, csrfUrl.length - '/auth/csrf/'.length);
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(String(url)).toBe(`${base}${path}`);
    expect(init?.method).toBe(method);
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it.each(cases)('%s fetches the CSRF cookie before writing', async (_name, call) => {
    // Every one of these mutates, so Django rejects it without a fresh token.
    const fetchMock = installOkFetch();

    await call();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/auth/csrf/');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'X-CSRFToken': 'test-token' });
  });

  it.each([
    ['getMe', () => getMe(), '/auth/me/'],
    ['getAccountDataExport', () => getAccountDataExport(), '/auth/account/data-export/'],
    ['ensureCsrfCookie', () => ensureCsrfCookie(), '/auth/csrf/'],
  ] as [string, () => Promise<unknown>, string][])(
    '%s is a plain GET with no CSRF round trip',
    async (_name, call, path) => {
      const base = await resolveApiBase();
      const fetchMock = installOkFetch();

      await call();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${base}${path}`);
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    },
  );

  it('sends an empty display name by default rather than omitting the field', async () => {
    const fetchMock = installOkFetch();

    await register('a@b.de', 'pw', 'pw');

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      email: 'a@b.de', password: 'pw', password_confirm: 'pw', display_name: '',
    });
  });
});
