import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '../../../auth/authApi';
import { useGuestDemoStart } from '../useGuestDemoStart';

const { navigateMock, startGuestDemoMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  startGuestDemoMock: vi.fn(),
}));

vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({ startGuestDemo: startGuestDemoMock }),
}));

/**
 * The real i18n bundle, not a stub: every branch below differs only in which
 * German string it produces, so a passthrough `t` would let any two of them
 * be swapped without a test noticing.
 */
vi.mock('../../../i18n', async (importOriginal) => await importOriginal<object>());

const rateLimited = (options: {
  retryAfterSeconds?: number;
  payload?: Record<string, unknown>;
} = {}) => new AuthApiError('Too many requests', { status: 429, ...options });

const setup = () => renderHook(() => useGuestDemoStart());

/** The wall clock the countdown is measured against. */
const NOW = new Date('2026-09-13T08:00:00Z').getTime();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(NOW);
  startGuestDemoMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('starting the demo', () => {
  it('sends the guest into the app once it is ready', async () => {
    const { result } = setup();

    await act(async () => { await result.current.startDemo(); });

    expect(startGuestDemoMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/app/fields-beds');
  });

  it('reports itself as busy while the demo is being created', async () => {
    // The landing page swaps the button label to "Demo wird gestartet…", so
    // the flag has to be true for the whole request rather than only after.
    let settle!: () => void;
    startGuestDemoMock.mockReturnValue(new Promise<void>((resolve) => { settle = resolve; }));
    const { result } = setup();

    // Asserted straight after the call rather than awaited: the flag is set
    // synchronously before the request is issued, which is the point -- the
    // button must be disabled from the press, not from the first response.
    act(() => { void result.current.startDemo(); });
    expect(result.current.isStartingDemo).toBe(true);
    expect(result.current.isDemoButtonDisabled).toBe(true);

    await act(async () => { settle(); });
    expect(result.current.isStartingDemo).toBe(false);
  });

  it('stops reporting itself busy after a failure', async () => {
    // Otherwise one failed attempt disables the button for the rest of the
    // visit and the guest cannot retry at all.
    startGuestDemoMock.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.isStartingDemo).toBe(false);
    expect(result.current.isDemoButtonDisabled).toBe(false);
  });

  it('does not navigate when the demo could not be created', async () => {
    startGuestDemoMock.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();

    await act(async () => { await result.current.startDemo(); });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('clears a previous error when trying again', async () => {
    // The old message must not sit under a request that is now in flight.
    startGuestDemoMock.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();
    await act(async () => { await result.current.startDemo(); });
    expect(result.current.demoStartError).not.toBeNull();
    startGuestDemoMock.mockResolvedValue(undefined);

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.demoStartError).toBeNull();
  });

  it('ignores a second press while the first is still running', async () => {
    // A double click would otherwise create two demo projects.
    let settle!: () => void;
    startGuestDemoMock.mockReturnValue(new Promise<void>((resolve) => { settle = resolve; }));
    const { result } = setup();

    act(() => { void result.current.startDemo(); });
    expect(result.current.isStartingDemo).toBe(true);
    await act(async () => { await result.current.startDemo(); });

    expect(startGuestDemoMock).toHaveBeenCalledTimes(1);
    await act(async () => { settle(); });
  });

  it('starts out ready rather than blocked', () => {
    const { result } = setup();

    expect(result.current.isDemoButtonDisabled).toBe(false);
    expect(result.current.isDemoRetryBlocked).toBe(false);
    expect(result.current.retryRemainingSeconds).toBe(0);
    expect(result.current.compactRetryTime).toBeNull();
    expect(result.current.demoStartError).toBeNull();
  });
});

describe('the error messages', () => {
  const cases: [string, unknown, string][] = [
    [
      'a network failure',
      new AuthApiError('offline', { isNetworkError: true }),
      'Die Demo ist derzeit nicht erreichbar. Bitte prüfe deine Internetverbindung und versuche es später erneut.',
    ],
    [
      'a server error',
      new AuthApiError('boom', { status: 500 }),
      'Die Demo konnte wegen eines Serverfehlers nicht gestartet werden. Bitte versuche es später erneut.',
    ],
    [
      'an unreadable response',
      new AuthApiError('huh', { code: 'unexpected_response' }),
      'Die Demo konnte nicht gestartet werden, weil die Serverantwort unerwartet war. Bitte versuche es erneut.',
    ],
    [
      'anything else',
      new Error('boom'),
      'Demo konnte nicht gestartet werden. Bitte versuche es erneut.',
    ],
  ];

  it.each(cases)('explains %s', async (_label, error, expected) => {
    // Each branch is pinned to its exact German text: they are all non-empty
    // strings, so anything looser cannot tell one branch from another.
    startGuestDemoMock.mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.demoStartError).toBe(expected);
  });

  it('treats a 503 as a server error too', async () => {
    // The branch is a range, not a single status. Its explicit
    // `status !== undefined` check is belt and braces rather than a
    // behaviour: an absent status compares false against the range either
    // way, so the two spellings cannot be told apart.
    startGuestDemoMock.mockRejectedValue(new AuthApiError('boom', { status: 503 }));
    const { result } = setup();

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.demoStartError).toContain('Serverfehler');
  });

  it('does not treat a 404 as a server error', async () => {
    // Below the range, so it falls through to the generic message.
    startGuestDemoMock.mockRejectedValue(new AuthApiError('nope', { status: 404 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.demoStartError).toBe(
      'Demo konnte nicht gestartet werden. Bitte versuche es erneut.',
    );
  });

  it('logs only the failures it cannot explain', async () => {
    // A rate limit or an outage is expected and already reported to the user;
    // logging those would bury the ones worth looking at.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    startGuestDemoMock.mockRejectedValue(new AuthApiError('offline', { isNetworkError: true }));
    const { result } = setup();
    await act(async () => { await result.current.startDemo(); });
    expect(consoleError).not.toHaveBeenCalled();

    startGuestDemoMock.mockRejectedValue(new Error('boom'));
    await act(async () => { await result.current.startDemo(); });

    expect(consoleError).toHaveBeenCalled();
  });

  it('does not block retrying for a failure that is not a rate limit', async () => {
    startGuestDemoMock.mockRejectedValue(new AuthApiError('offline', { isNetworkError: true }));
    const { result } = setup();

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.isDemoRetryBlocked).toBe(false);
  });
});

describe('where the retry delay is read from', () => {
  it('prefers the Retry-After header', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({
      retryAfterSeconds: 120,
      payload: { retry_after: 30, detail: 'available in 45 seconds' },
    }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.retryRemainingSeconds).toBe(120);
  });

  it('falls back to the payload field', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({
      payload: { retry_after: 30, detail: 'available in 45 seconds' },
    }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.retryRemainingSeconds).toBe(30);
  });

  it('falls back to the number written into the message', async () => {
    // The throttle's own wording, which is the only place the delay appears
    // when neither the header nor a structured field is sent.
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({
      payload: { detail: 'Request was throttled. Expected available in 45 seconds.' },
    }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.retryRemainingSeconds).toBe(45);
  });

  it('rounds a fractional delay up', async () => {
    // Rounding down would offer a retry the server still refuses.
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({
      payload: { detail: 'Expected available in 45.2 seconds.' },
    }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.retryRemainingSeconds).toBe(46);
  });

  it('ignores a delay of zero and keeps looking', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({
      retryAfterSeconds: 0,
      payload: { retry_after: 30 },
    }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.retryRemainingSeconds).toBe(30);
  });

  it('ignores a delay that is not a number', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({
      payload: { retry_after: 'soon', detail: 'available in 45 seconds' },
    }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.retryRemainingSeconds).toBe(45);
  });

  it('reads the delay from the phrase, not the first number it finds', async () => {
    // The throttle's message can carry other numbers before the delay. A
    // pattern that just grabbed the first one would take the wrong figure and
    // unblock the button far too early.
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({
      payload: { detail: 'Request 3 was throttled. Expected available in 45 seconds.' },
    }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.retryRemainingSeconds).toBe(45);
  });

  it('ignores a message that carries no number', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({
      payload: { detail: 'Request was throttled.' },
    }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.isDemoRetryBlocked).toBe(false);
  });

  it('ignores a non-string message', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ payload: { detail: 42 } }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.isDemoRetryBlocked).toBe(false);
  });
});

describe('being rate limited', () => {
  it('blocks the button and says when to come back', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 300 }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.isDemoRetryBlocked).toBe(true);
    expect(result.current.isDemoButtonDisabled).toBe(true);
    expect(result.current.demoStartError).toBe(
      'Die Demo wurde vor Kurzem bereits gestartet. Bitte versuche es in etwa 5 Minuten erneut.',
    );
  });

  it('falls back to the timeless message when it cannot tell how long', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited());

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.demoStartError).toBe(
      'Die Demo wurde vor Kurzem bereits gestartet. Bitte versuche es später erneut.',
    );
    expect(result.current.isDemoRetryBlocked).toBe(false);
  });

  it('refuses to start while the block is in force', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 300 }));
    await act(async () => { await result.current.startDemo(); });
    startGuestDemoMock.mockClear();

    await act(async () => { await result.current.startDemo(); });

    expect(startGuestDemoMock).not.toHaveBeenCalled();
  });

  it('counts down as the wait passes', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 10 }));
    await act(async () => { await result.current.startDemo(); });
    expect(result.current.retryRemainingSeconds).toBe(10);

    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });

    expect(result.current.retryRemainingSeconds).toBe(6);
  });

  it('lets the guest try again once the wait is over', async () => {
    // The zero floor and the effect's already-elapsed guard both keep the
    // countdown from going negative here, and neither is separable: the
    // interval clears the deadline on the same tick that it passes, so no
    // render ever sees an elapsed deadline still in place.

    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 3 }));
    await act(async () => { await result.current.startDemo(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(result.current.isDemoRetryBlocked).toBe(false);
    expect(result.current.isDemoButtonDisabled).toBe(false);
    expect(result.current.compactRetryTime).toBeNull();
  });

  it('stops ticking once the wait is over', async () => {
    // The interval would otherwise re-render the landing page every second
    // for the rest of the visit.
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 2 }));
    await act(async () => { await result.current.startDemo(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops ticking when the page is left', async () => {
    const { result, unmount } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 300 }));
    await act(async () => { await result.current.startDemo(); });

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('rounds a part-second remainder up', async () => {
    // The countdown is what the button shows, and rounding down would display
    // a second that has not passed yet -- at the very end, a 0 while the block
    // is still in force.
    //
    // The remainder only exists because real intervals run late: the deadline
    // is a whole number of seconds from the first tick, so a perfectly regular
    // timer would land exactly on it and the rounding mode would never show.
    // The clock is therefore pushed past the tick to model that drift, which
    // is the only condition under which the two modes differ.
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 10 }));
    await act(async () => { await result.current.startDemo(); });

    const drifted = vi.spyOn(Date, 'now').mockImplementation(() => NOW + 4500);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(result.current.retryRemainingSeconds).toBe(6);
    drifted.mockRestore();
  });

  it('never counts below zero', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 2 }));
    await act(async () => { await result.current.startDemo(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });

    expect(result.current.retryRemainingSeconds).toBe(0);
  });

  it('measures the wait from when the refusal arrived', async () => {
    // Not from when the hook mounted: a guest who sat on the landing page for
    // a while before pressing the button would otherwise be told a wait that
    // had already elapsed.
    setup();
    const { result } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 30 }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.retryRemainingSeconds).toBe(30);
  });
});

describe('the compact countdown label', () => {
  const compactCases: [number, string][] = [
    [30, '< 1 Min.'],
    [59, '< 1 Min.'],
    [60, '1 Min.'],
    [90, '2 Min.'],
    [3540, '59 Min.'],
    [3541, '1 Std.'],
    [3660, '1 Std. 1 Min.'],
    [7200, '2 Std.'],
    [7260, '2 Std. 1 Min.'],
  ];

  it.each(compactCases)('shows %i seconds as "%s"', async (seconds, expected) => {
    // The button's own inline label, which has to stay short enough to fit.
    // The hour boundary is pinned from both sides, and it is not the round
    // hour: the threshold is on the rounded-up minute count, so 3540 seconds
    // is exactly 59 minutes and stays in minutes, while one second more
    // rounds to 60 and reads as a full hour. The label therefore never shows
    // a minute count of 60 or above.
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: seconds }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.compactRetryTime).toBe(expected);
  });

  it('is null while nothing is blocking', () => {
    const { result } = setup();

    expect(result.current.compactRetryTime).toBeNull();
  });

  it('shortens as the wait runs down', async () => {
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: 130 }));
    await act(async () => { await result.current.startDemo(); });
    expect(result.current.compactRetryTime).toBe('3 Min.');

    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });

    expect(result.current.compactRetryTime).toBe('1 Min.');
  });
});

describe('the long retry message', () => {
  const longCases: [number, string][] = [
    [30, 'in weniger als einer Minute'],
    [60, 'in etwa 1 Minute'],
    [120, 'in etwa 2 Minuten'],
    [3540, 'in etwa 59 Minuten'],
    [3541, 'in etwa 1 Stunde'],
    [3660, 'in etwa 1 Stunden und 1 Minuten'],
    [7200, 'in etwa 2 Stunden'],
  ];

  it.each(longCases)('describes %i seconds as "%s"', async (seconds, expected) => {
    // The sentence under the button. Both singular and plural forms are
    // covered, since i18next selects them by count and a wrong key shows the
    // raw key instead of a sentence.
    const { result } = setup();
    startGuestDemoMock.mockRejectedValue(rateLimited({ retryAfterSeconds: seconds }));

    await act(async () => { await result.current.startDemo(); });

    expect(result.current.demoStartError).toBe(
      `Die Demo wurde vor Kurzem bereits gestartet. Bitte versuche es ${expected} erneut.`,
    );
  });
});
