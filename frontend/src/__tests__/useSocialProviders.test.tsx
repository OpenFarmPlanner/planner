import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialProvider } from '../auth/socialAuth';
import { useSocialProviders } from '../auth/useSocialProviders';

const { getSocialProvidersMock, languageRef } = vi.hoisted(() => ({
  getSocialProvidersMock: vi.fn(),
  languageRef: { current: 'de' as string | null },
}));

vi.mock('../auth/socialAuth', () => ({ getSocialProviders: getSocialProvidersMock }));
vi.mock('../i18n', () => ({
  // `null` stands for i18n not being ready yet, which the hook guards against
  // with an optional chain and a German default.
  useTranslation: () => ({
    i18n: languageRef.current === null ? undefined : { language: languageRef.current },
  }),
}));

const provider = (id: string, name: string): SocialProvider => ({
  id: id as SocialProvider['id'],
  name,
  login_url: `/auth/${id}/`,
});

const GOOGLE = provider('google', 'Google');
const MICROSOFT = provider('microsoft', 'Microsoft');
const APPLE = provider('apple', 'Apple');

const setup = () => renderHook(() => useSocialProviders());

beforeEach(() => {
  vi.clearAllMocks();
  languageRef.current = 'de';
  getSocialProvidersMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading the providers', () => {
  it('starts with none, so no buttons flash before the answer', () => {
    const { result } = setup();

    expect(result.current.providers).toEqual([]);
    expect(result.current.providerNamesText).toBe('');
  });

  it('publishes what the deployment has configured', async () => {
    getSocialProvidersMock.mockResolvedValue([GOOGLE, MICROSOFT]);
    const { result } = setup();

    await waitFor(() => expect(result.current.providers).toEqual([GOOGLE, MICROSOFT]));
  });

  it('asks the backend once', async () => {
    getSocialProvidersMock.mockResolvedValue([GOOGLE]);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.providers).toHaveLength(1));

    rerender();

    expect(getSocialProvidersMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the order the backend gave', async () => {
    // The buttons render in this order, and the deployment decides which
    // provider it wants offered first.
    getSocialProvidersMock.mockResolvedValue([MICROSOFT, GOOGLE]);
    const { result } = setup();

    await waitFor(() => expect(result.current.providers.map((entry) => entry.id))
      .toEqual(['microsoft', 'google']));
  });

  it('treats a failure as no providers rather than an error', async () => {
    // Social login is optional; a failed lookup should hide the buttons, not
    // break the login page.
    //
    // The catch clearing the list is belt and braces: the lookup runs once,
    // so there is never a previous list for a failure to replace. It keeps
    // the empty state explicit rather than implied by the initial value.
    getSocialProvidersMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await waitFor(() => expect(getSocialProvidersMock).toHaveBeenCalled());
    expect(result.current.providers).toEqual([]);
    expect(result.current.providerNamesText).toBe('');
  });

  // The two tests below cover the cancelled flag the effect carries. React no
  // longer warns about a state update on an unmounted component, so neither
  // the flag nor the cleanup that sets it can be observed from outside -- what
  // is asserted is that nothing is logged and nothing throws, which is the
  // whole of the visible contract.
  it('ignores an answer that arrives after the page is gone', async () => {
    let settle!: (value: SocialProvider[]) => void;
    getSocialProvidersMock.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    const { unmount } = setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    unmount();
    settle([GOOGLE]);
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('ignores a failure that arrives after the page is gone', async () => {
    let fail!: (reason: unknown) => void;
    const pending = new Promise<SocialProvider[]>((_resolve, reject) => { fail = reject; });
    getSocialProvidersMock.mockReturnValue(pending);
    const { unmount } = setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    unmount();
    fail(new Error('offline'));
    await pending.catch(() => {});

    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('the joined provider names', () => {
  it('is empty while there are none', () => {
    // The explicit empty-list branch cannot be told apart from letting the
    // formatter run: it returns an empty string for an empty list too. The
    // branch states the intent and skips building a formatter for nothing.
    const { result } = setup();

    expect(result.current.providerNamesText).toBe('');
  });

  it('is just the name for a single provider', async () => {
    getSocialProvidersMock.mockResolvedValue([GOOGLE]);
    const { result } = setup();

    await waitFor(() => expect(result.current.providerNamesText).toBe('Google'));
  });

  it('joins two with the German "oder"', async () => {
    // The legal notice reads "... mit Google oder Microsoft anmelden", so the
    // list is a disjunction rather than a conjunction.
    getSocialProvidersMock.mockResolvedValue([GOOGLE, MICROSOFT]);
    const { result } = setup();

    await waitFor(() => expect(result.current.providerNamesText).toBe('Google oder Microsoft'));
  });

  it('joins three with commas and a final "oder"', async () => {
    getSocialProvidersMock.mockResolvedValue([GOOGLE, MICROSOFT, APPLE]);
    const { result } = setup();

    await waitFor(() => expect(result.current.providerNamesText)
      .toBe('Google, Microsoft oder Apple'));
  });

  it('joins in the active UI language', async () => {
    // The joining word is part of a sentence, so it has to follow the page
    // rather than a fixed locale.
    languageRef.current = 'en';
    getSocialProvidersMock.mockResolvedValue([GOOGLE, MICROSOFT]);
    const { result } = setup();

    await waitFor(() => expect(result.current.providerNamesText).toBe('Google or Microsoft'));
  });

  it('follows a language change without refetching', async () => {
    getSocialProvidersMock.mockResolvedValue([GOOGLE, MICROSOFT]);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.providerNamesText).toBe('Google oder Microsoft'));

    languageRef.current = 'en';
    rerender();

    expect(result.current.providerNamesText).toBe('Google or Microsoft');
    expect(getSocialProvidersMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to German before i18n is ready', async () => {
    // The hook is used on the login page, which can render before i18n has
    // initialised. Without the explicit default the list formatter falls back
    // to the runtime's own locale, which is whatever the environment happens
    // to be rather than the app's language.
    languageRef.current = null;
    getSocialProvidersMock.mockResolvedValue([GOOGLE, MICROSOFT]);
    const { result } = setup();

    await waitFor(() => expect(result.current.providerNamesText).toBe('Google oder Microsoft'));
  });

  it('keeps the same string while nothing changes', async () => {
    // It is rendered into a translated sentence; rebuilding it per render
    // would re-run the list formatter on every keystroke on the login form.
    getSocialProvidersMock.mockResolvedValue([GOOGLE, MICROSOFT]);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.providerNamesText).toBe('Google oder Microsoft'));
    const before = result.current.providerNamesText;

    rerender();

    expect(result.current.providerNamesText).toBe(before);
  });
});
