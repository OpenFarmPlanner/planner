import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_REQUEST_TIMEOUT_MS } from '../api/requestTimeout';
import { AuthApiError, startGuestDemo } from '../auth/authApi';

function jsonResponse(body: Record<string, unknown>, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function expectStartGuestDemoError(): Promise<AuthApiError> {
  try {
    await startGuestDemo();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthApiError);
    return error as AuthApiError;
  }
  throw new Error('Expected startGuestDemo to fail.');
}

describe('authApi guest demo errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads retry duration from the Retry-After header first', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ detail: 'CSRF cookie set' }))
      .mockResolvedValueOnce(jsonResponse(
        { detail: 'Request was throttled. Expected available in 30 seconds.', retry_after: 30 },
        { status: 429, headers: { 'Retry-After': '75' } },
      ));

    const error = await expectStartGuestDemoError();

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(75);
  });

  it('falls back to the retry_after response field', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ detail: 'CSRF cookie set' }))
      .mockResolvedValueOnce(jsonResponse(
        { detail: 'Request was throttled. Expected available in 30 seconds.', retry_after: 30 },
        { status: 429 },
      ));

    const error = await expectStartGuestDemoError();

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('uses the DRF detail text only as a last retry-duration fallback', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ detail: 'CSRF cookie set' }))
      .mockResolvedValueOnce(jsonResponse(
        { detail: 'Request was throttled. Expected available in 2395 seconds.' },
        { status: 429 },
      ));

    const error = await expectStartGuestDemoError();

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(2395);
  });
});

describe('authApi server failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([502, 503, 504])('explains an HTML %i page from the proxy instead of a generic failure', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<!DOCTYPE html><html><body>Gateway time-out</body></html>', { status }),
    );

    const error = await expectStartGuestDemoError();

    expect(error.status).toBe(status);
    expect(error.message).toMatch(/nicht erreichbar|can't be reached/);
    expect(error.message).not.toContain('Gateway');
  });

  it('reports a request the server never answers as unavailable once it times out', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return controller.signal;
    });

    const pending = expectStartGuestDemoError();
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    const error = await pending;

    expect(error.isNetworkError).toBe(true);
    expect(error.message).toMatch(/nicht erreichbar|can't be reached/);
  });

  it('keeps the network message when the request could not be sent at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await expectStartGuestDemoError();

    expect(error.isNetworkError).toBe(true);
    expect(error.message).not.toMatch(/nicht erreichbar|can't be reached/);
  });
});
