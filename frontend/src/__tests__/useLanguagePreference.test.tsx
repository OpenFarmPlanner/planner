import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthContext } from '../auth/authContextShared';
import type { AuthContextValue } from '../auth/authContextShared';
import type { AuthUser } from '../auth/types';
import { LANGUAGE_STORAGE_KEY, SIGNED_OUT_LANGUAGE_CHOICE_KEY } from '../i18n/languages';
import { useLanguagePreference } from '../i18n/useLanguagePreference';
import { GLOBAL_SNACKBAR_EVENT, type GlobalSnackbarDetail } from '../utils/globalSnackbar';

const { updateUiLanguageMock, changeLanguageMock, tMock, i18nState } = vi.hoisted(() => ({
  updateUiLanguageMock: vi.fn(),
  changeLanguageMock: vi.fn(),
  tMock: vi.fn((key: string, options?: { lng?: string }) => `${options?.lng}:${key}`),
  i18nState: { resolvedLanguage: 'en' },
}));

vi.mock('../auth/authApi', () => ({ updateUiLanguage: updateUiLanguageMock }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      get resolvedLanguage() { return i18nState.resolvedLanguage; },
      changeLanguage: changeLanguageMock,
      t: tMock,
    },
  }),
}));

const user = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 1, email: 'u@example.com', ui_language: 'auto', ...overrides,
}) as AuthUser;

/** Renders the hook with (or deliberately without) an AuthProvider above it. */
const setup = ({
  authUser = null,
  withProvider = true,
  refreshUser = vi.fn().mockResolvedValue(undefined),
}: {
  authUser?: AuthUser | null;
  withProvider?: boolean;
  refreshUser?: () => Promise<void>;
} = {}) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    withProvider
      ? (
        <AuthContext.Provider value={{ user: authUser, refreshUser } as unknown as AuthContextValue}>
          {children}
        </AuthContext.Provider>
      )
      : <>{children}</>
  );
  return { ...renderHook(() => useLanguagePreference(), { wrapper }), refreshUser };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  i18nState.resolvedLanguage = 'en';
  updateUiLanguageMock.mockResolvedValue({ ui_language: 'de' });
  // A browser that asks for no supported language, so every test that does
  // not set one explicitly falls through to the English default.
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['it-IT']);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('it-IT');
});

/** Collects every global snackbar shown while the test runs. */
const captureSnackbars = (): GlobalSnackbarDetail[] => {
  const shown: GlobalSnackbarDetail[] = [];
  const listener = (event: Event) => shown.push((event as CustomEvent<GlobalSnackbarDetail>).detail);
  window.addEventListener(GLOBAL_SNACKBAR_EVENT, listener);
  removeSnackbarListeners.push(() => window.removeEventListener(GLOBAL_SNACKBAR_EVENT, listener));
  return shown;
};
const removeSnackbarListeners: Array<() => void> = [];

const SAVE_FAILED = 'common:language.saveFailed';

afterEach(() => {
  removeSnackbarListeners.splice(0).forEach((remove) => remove());
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('lang');
});

describe('useLanguagePreference — resolution order', () => {
  it('falls back to English when nothing is stored and the browser asks for no supported language', () => {
    const { result } = setup();
    expect(result.current.preference).toBe('auto');
    expect(result.current.language).toBe('en');
  });

  it('uses the browser language when nothing has been chosen', () => {
    // Only ever an initial value — never written back, so it cannot overwrite
    // a choice made later.
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-AT']);
    const { result } = setup();
    expect(result.current.language).toBe('de');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it('prefers the locally stored choice over the browser language', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-AT']);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    expect(setup().result.current.language).toBe('en');
  });

  it("prefers the account's explicit preference over the local one", () => {
    // A per-account setting made on some device beats a local value that may
    // be a leftover from a shared browser.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    const { result } = setup({ authUser: user({ ui_language: 'de' }) });
    expect(result.current.preference).toBe('de');
    expect(result.current.language).toBe('de');
  });

  it('falls through to the local choice when the account says auto', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const { result } = setup({ authUser: user({ ui_language: 'auto' }) });
    expect(result.current.language).toBe('de');
  });

  it('reports auto for a signed-in user with no preference anywhere', () => {
    const { result } = setup({ authUser: user({ ui_language: 'auto' }) });
    expect(result.current.preference).toBe('auto');
  });

  it('ignores an unsupported stored value rather than rendering in it', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-AT']);
    expect(setup().result.current.language).toBe('de');
  });

  it('normalizes an unsupported account preference to auto', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const { result } = setup({ authUser: user({ ui_language: 'klingon' }) });
    expect(result.current.language).toBe('de');
  });
});

describe('useLanguagePreference — keeping i18next and the document in step', () => {
  it('switches i18next to the resolved language', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    setup();
    expect(changeLanguageMock).toHaveBeenCalledWith('de');
  });

  it('does not re-issue a change for the language already rendered', () => {
    // The guard is what keeps this effect from looping on every render.
    i18nState.resolvedLanguage = 'de';
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    setup();
    expect(changeLanguageMock).not.toHaveBeenCalled();
  });

  it('sets the document language so screen readers announce it correctly', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    setup();
    expect(document.documentElement.lang).toBe('de');
  });

  it('sets the document language even when i18next needs no change', () => {
    i18nState.resolvedLanguage = 'de';
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    setup();
    expect(document.documentElement.lang).toBe('de');
  });
});

describe('useLanguagePreference — without an AuthProvider', () => {
  it('renders as a signed-out visitor rather than throwing', () => {
    // The switcher also renders on the imprint, privacy and terms pages, which
    // are not wrapped in a provider. It must never be why such a page fails.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const { result } = setup({ withProvider: false });
    expect(result.current.language).toBe('de');
    expect(result.current.isPersistedToAccount).toBe(false);
  });

  it('still applies and stores a switch', () => {
    const { result } = setup({ withProvider: false });
    act(() => result.current.setPreference('de'));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    expect(updateUiLanguageMock).not.toHaveBeenCalled();
  });
});

describe('useLanguagePreference — setPreference', () => {
  it('stores the choice locally so it survives a reload', () => {
    const { result } = setup();
    act(() => result.current.setPreference('de'));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
  });

  it('applies the switch immediately, before any API round trip', () => {
    const { result } = setup({ authUser: user() });
    act(() => result.current.setPreference('de'));
    expect(changeLanguageMock).toHaveBeenCalledWith('de');
  });

  it('resolves auto against the browser rather than storing a language', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-AT']);
    const { result } = setup();

    act(() => result.current.setPreference('auto'));

    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
    expect(changeLanguageMock).toHaveBeenLastCalledWith('de');
  });

  it('normalizes an unsupported value to auto instead of storing it', () => {
    const { result } = setup();
    act(() => result.current.setPreference('klingon' as never));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
  });

  it('persists to the account when signed in', async () => {
    const { result, refreshUser } = setup({ authUser: user() });

    await act(async () => { result.current.setPreference('de'); });

    expect(updateUiLanguageMock).toHaveBeenCalledWith('de');
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
  });

  it('does not call the account endpoint when signed out', () => {
    const { result } = setup();
    act(() => result.current.setPreference('de'));
    expect(updateUiLanguageMock).not.toHaveBeenCalled();
  });

  it('reverts to the account language and reports the error when persisting fails', async () => {
    // A reload would restore the account value anyway; showing the new
    // language until then would hide that the choice was lost.
    updateUiLanguageMock.mockRejectedValue(new Error('forbidden'));
    const snackbars = captureSnackbars();
    const { result } = setup({ authUser: user({ ui_language: 'de' }) });

    await act(async () => { result.current.setPreference('fr'); });

    expect(changeLanguageMock).toHaveBeenCalledWith('fr');
    await waitFor(() => expect(changeLanguageMock).toHaveBeenLastCalledWith('de'));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    expect(result.current.preference).toBe('de');
    expect(result.current.language).toBe('de');
    expect(snackbars).toEqual([{ message: `de:${SAVE_FAILED}`, severity: 'error' }]);
  });

  it('reverts an account on auto back to auto, so the select shows it again', async () => {
    updateUiLanguageMock.mockRejectedValue(new Error('offline'));
    const snackbars = captureSnackbars();
    const { result } = setup({ authUser: user({ ui_language: 'auto' }) });

    await act(async () => { result.current.setPreference('es'); });

    await waitFor(() => expect(result.current.preference).toBe('auto'));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
    expect(changeLanguageMock).toHaveBeenLastCalledWith('en');
    expect(result.current.language).toBe('en');
    expect(snackbars).toHaveLength(1);
  });

  it('shows no error when the save succeeds', async () => {
    const snackbars = captureSnackbars();
    const { result, refreshUser } = setup({ authUser: user({ ui_language: 'de' }) });

    await act(async () => { result.current.setPreference('fr'); });

    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(snackbars).toHaveLength(0);
  });

  it('does not let an older failed save undo a newer switch', async () => {
    let rejectFirst: (reason: unknown) => void = () => undefined;
    updateUiLanguageMock
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce({ ui_language: 'es' });
    const snackbars = captureSnackbars();
    const { result } = setup({ authUser: user({ ui_language: 'de' }) });

    await act(async () => { result.current.setPreference('fr'); });
    await act(async () => { result.current.setPreference('es'); });
    await act(async () => { rejectFirst(new Error('late')); });

    expect(changeLanguageMock).toHaveBeenLastCalledWith('es');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es');
    expect(snackbars).toHaveLength(0);
  });

  it('does not leave the failed sync as an unhandled rejection', async () => {
    updateUiLanguageMock.mockRejectedValue(new Error('offline'));
    const { result } = setup({ authUser: user() });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      await act(async () => { result.current.setPreference('de'); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(rejections).toHaveLength(0);
  });
});

describe('useLanguagePreference — promoting a guest choice on sign-in', () => {
  it('promotes the local choice to an account that has none', async () => {
    // The user picked it moments ago; losing it on sign-in would be surprising.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');

    const { refreshUser } = setup({ authUser: user({ ui_language: 'auto' }) });

    await waitFor(() => expect(updateUiLanguageMock).toHaveBeenCalledWith('de'));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
  });

  it('leaves an account that already carries a preference alone', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    setup({ authUser: user({ ui_language: 'de' }) });
    await waitFor(() => expect(document.documentElement.lang).toBe('de'));
    expect(updateUiLanguageMock).not.toHaveBeenCalled();
  });

  it('promotes nothing when the guest never chose', async () => {
    setup({ authUser: user({ ui_language: 'auto' }) });
    await waitFor(() => expect(document.documentElement.lang).toBeTruthy());
    expect(updateUiLanguageMock).not.toHaveBeenCalled();
  });

  it('does not promote a local value of auto, which is not a choice', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'auto');
    setup({ authUser: user({ ui_language: 'auto' }) });
    await waitFor(() => expect(document.documentElement.lang).toBeTruthy());
    expect(updateUiLanguageMock).not.toHaveBeenCalled();
  });

  it('promotes only once per user, even when the user object is replaced', async () => {
    // Note: the `promotedForUserRef` guard is redundant against the mirror
    // effect below it. That effect writes the account's `auto` over the
    // guest's stored choice on the same commit, so by the time the effect
    // could re-run, `localChoice` is already `auto` and fails the
    // "is an explicit choice" check anyway. Removing the ref leaves this file
    // green. Asserted as the outcome, not as proof the ref does the work.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const refreshUser = vi.fn().mockResolvedValue(undefined);
    let currentUser = user({ id: 1, ui_language: 'auto' });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider
        value={{ user: currentUser, refreshUser } as unknown as AuthContextValue}
      >
        {children}
      </AuthContext.Provider>
    );
    const { rerender } = renderHook(() => useLanguagePreference(), { wrapper });

    await waitFor(() => expect(updateUiLanguageMock).toHaveBeenCalledTimes(1));

    // A fresh object for the same account, exactly as refreshUser produces.
    currentUser = user({ id: 1, ui_language: 'auto' });
    rerender();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(updateUiLanguageMock).toHaveBeenCalledTimes(1);
  });

  it('does not leave the failed promotion as an unhandled rejection', async () => {
    // The catch is what keeps a failed sync from breaking sign-in. Without it
    // the rejection escapes the async IIFE, where nothing is waiting for it.
    updateUiLanguageMock.mockRejectedValue(new Error('offline'));
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      setup({ authUser: user({ ui_language: 'auto' }) });
      await waitFor(() => expect(updateUiLanguageMock).toHaveBeenCalled());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(rejections).toHaveLength(0);
  });

  it('falls back to the account value and reports it when the promotion fails', async () => {
    // The account still holds `auto`, which is what a reload would show, so
    // the UI shows it now too, and the user learns the choice was not saved.
    updateUiLanguageMock.mockRejectedValue(new Error('offline'));
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const snackbars = captureSnackbars();

    const { result } = setup({ authUser: user({ ui_language: 'auto' }) });

    await waitFor(() => expect(snackbars).toEqual([{ message: `en:${SAVE_FAILED}`, severity: 'error' }]));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
    expect(result.current.language).toBe('en');
  });

  it('replaces the guest choice with the account value even when it succeeds', async () => {
    // The same overwrite on the success path is harmless: refreshUser brings
    // the account back carrying the promoted language. Pinned alongside the
    // failure case so the difference between them is visible in one place.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');

    setup({ authUser: user({ ui_language: 'auto' }) });

    await waitFor(() => expect(updateUiLanguageMock).toHaveBeenCalledWith('de'));
    await waitFor(() => {
      expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
    });
  });

  it('sees the guest choice, not the value the mirror effect writes', async () => {
    // The two effects run in declaration order on the same commit. If the
    // mirror ran first it would write the account's `auto` over the guest's
    // choice, and the promotion check would then find nothing to promote.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');

    setup({ authUser: user({ ui_language: 'auto' }) });

    await waitFor(() => expect(updateUiLanguageMock).toHaveBeenCalledWith('de'));
  });
});

describe('useLanguagePreference — a choice made while signed out in this tab', () => {
  it('marks a switch made while signed out for the next sign-in', () => {
    const { result } = setup();
    act(() => result.current.setPreference('fr'));
    expect(window.sessionStorage.getItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY)).toBe('fr');
  });

  it('drops the mark when the switch is made while signed in', async () => {
    window.sessionStorage.setItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY, 'fr');
    const { result } = setup({ authUser: user({ ui_language: 'fr' }) });
    await act(async () => { result.current.setPreference('es'); });
    expect(window.sessionStorage.getItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY)).toBeNull();
  });

  it('wins over an explicit account preference and is saved to the account', async () => {
    // Picked French on the landing page, then signed in to an account that
    // stored German at registration: the fresh choice must survive.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    window.sessionStorage.setItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY, 'fr');

    const { result, refreshUser } = setup({ authUser: user({ ui_language: 'de' }) });

    // Rendered in French from the first signed-in render — no German flash.
    expect(result.current.language).toBe('fr');
    await waitFor(() => expect(updateUiLanguageMock).toHaveBeenCalledWith('fr'));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    await waitFor(() => {
      expect(window.sessionStorage.getItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY)).toBeNull();
    });
    // The mirror effect must not have cached the old account value meanwhile.
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
  });

  it('only clears the mark when the account already has that language', async () => {
    window.sessionStorage.setItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY, 'de');
    setup({ authUser: user({ ui_language: 'de' }) });
    await waitFor(() => {
      expect(window.sessionStorage.getItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY)).toBeNull();
    });
    expect(updateUiLanguageMock).not.toHaveBeenCalled();
  });

  it('returns to the account language and reports it when saving the choice fails', async () => {
    // Sign-in itself is unaffected; only the language falls back to what the
    // account holds, so the next reload shows no surprise.
    updateUiLanguageMock.mockRejectedValue(new Error('offline'));
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    window.sessionStorage.setItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY, 'fr');
    const snackbars = captureSnackbars();

    const { result } = setup({ authUser: user({ ui_language: 'de' }) });

    expect(result.current.language).toBe('fr');
    await waitFor(() => expect(result.current.language).toBe('de'));
    expect(changeLanguageMock).toHaveBeenLastCalledWith('de');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    expect(window.sessionStorage.getItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY)).toBeNull();
    expect(snackbars).toEqual([{ message: `de:${SAVE_FAILED}`, severity: 'error' }]);
  });

  it('promotes again after signing out and back in as the same user', async () => {
    let currentUser: AuthUser | null = user({ id: 1, ui_language: 'de' });
    const refreshUser = vi.fn().mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={{ user: currentUser, refreshUser } as unknown as AuthContextValue}>
        {children}
      </AuthContext.Provider>
    );
    const { result, rerender } = renderHook(() => useLanguagePreference(), { wrapper });

    currentUser = null;
    rerender();
    act(() => result.current.setPreference('fr'));

    currentUser = user({ id: 1, ui_language: 'de' });
    rerender();

    await waitFor(() => expect(updateUiLanguageMock).toHaveBeenCalledWith('fr'));
  });
});

describe('useLanguagePreference — mirroring the account preference locally', () => {
  it('caches the account preference so the next load starts in it', async () => {
    // Without this every refresh renders once in the stored language and flips
    // when /auth/me/ resolves — a visible flash of the wrong language.
    setup({ authUser: user({ ui_language: 'de' }) });
    await waitFor(() => {
      expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    });
  });

  it('overwrites a stale local value with the account one', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    setup({ authUser: user({ ui_language: 'de' }) });
    await waitFor(() => {
      expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    });
  });

  it('writes nothing for a signed-out visitor', async () => {
    setup();
    await waitFor(() => expect(document.documentElement.lang).toBeTruthy());
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it('does not clear a guest’s own choice when nobody is signed in', () => {
    // Without the account guard this effect would write `null`, which the
    // storage helper turns into removeItem — silently discarding the choice a
    // signed-out visitor just made.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');

    const { result } = setup();

    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    expect(result.current.language).toBe('de');
  });

  it('does not rewrite a value that already matches', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    setup({ authUser: user({ ui_language: 'de' }) });
    await waitFor(() => expect(document.documentElement.lang).toBe('de'));

    expect(setItem).not.toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'de');
  });
});

describe('useLanguagePreference — isPersistedToAccount', () => {
  it('is true only while someone is signed in', () => {
    expect(setup({ authUser: user() }).result.current.isPersistedToAccount).toBe(true);
    expect(setup().result.current.isPersistedToAccount).toBe(false);
  });
});

describe('useLanguagePreference — what survives a reload', () => {
  /**
   * A fake account endpoint plus a remountable hook: unmounting and rendering
   * again with the user `/auth/me/` would now return is a page reload.
   */
  const setupWithServer = (initial: string) => {
    let serverLanguage = initial;
    updateUiLanguageMock.mockImplementation(async (next: string) => {
      serverLanguage = next;
      return { ui_language: next };
    });
    let currentUser = user({ ui_language: serverLanguage });
    const refreshUser = vi.fn(async () => { currentUser = user({ ui_language: serverLanguage }); });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={{ user: currentUser, refreshUser } as unknown as AuthContextValue}>
        {children}
      </AuthContext.Provider>
    );
    const mount = () => renderHook(() => useLanguagePreference(), { wrapper });
    const reload = (view: ReturnType<typeof mount>) => {
      view.unmount();
      currentUser = user({ ui_language: serverLanguage });
      return mount();
    };
    return { mount, reload, refreshUser, serverLanguage: () => serverLanguage };
  };

  it('keeps a successfully saved language after a reload', async () => {
    const server = setupWithServer('de');
    const view = server.mount();

    await act(async () => { view.result.current.setPreference('fr'); });
    await waitFor(() => expect(server.refreshUser).toHaveBeenCalled());

    const reloaded = server.reload(view);
    expect(reloaded.result.current.preference).toBe('fr');
    expect(reloaded.result.current.language).toBe('fr');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
  });

  it('shows the same language before and after a reload when the save failed', async () => {
    const server = setupWithServer('de');
    updateUiLanguageMock.mockRejectedValue(new Error('offline'));
    const view = server.mount();

    await act(async () => { view.result.current.setPreference('fr'); });
    await waitFor(() => expect(view.result.current.language).toBe('de'));

    const reloaded = server.reload(view);
    expect(reloaded.result.current.language).toBe('de');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
  });

  it('saves and keeps every supported language in turn', async () => {
    const server = setupWithServer('auto');
    let view = server.mount();

    for (const code of ['de', 'en', 'fr', 'es'] as const) {
      await act(async () => { view.result.current.setPreference(code); });
      await waitFor(() => expect(server.serverLanguage()).toBe(code));
      view = server.reload(view);
      expect(view.result.current.language).toBe(code);
    }
  });
});
