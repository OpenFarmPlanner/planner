/**
 * The single place the effective UI language is decided and changed.
 *
 * On public SEO pages the URL alone decides the rendered language
 * (`routeLanguage.ts`); the preference below is neither consulted nor changed
 * by visiting one. Everywhere else the resolution order is:
 *  1. the signed-in user's stored server-side preference (unless it is `auto`),
 *  2. the locally stored choice of a guest / not-yet-loaded session,
 *  3. the detected browser language,
 *  4. English.
 *
 * The browser language is only ever an *initial* value. Once someone picks a
 * language it is written to `localStorage` (and, when signed in, to their
 * account), so it survives reloads and new sessions and is never silently
 * overwritten on the next page load.
 *
 * **Guest chose a language, then signs in:** the local choice is promoted to
 * the account when the account still has no explicit preference (`auto`) —
 * the user made that choice moments ago and losing it would be surprising. If
 * the account *does* carry an explicit preference, the account wins, because
 * that is a deliberate per-account setting made on some device and the local
 * value may be a leftover from a shared browser.
 */

import { useCallback, useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthContext } from '../auth/authContextShared';
import { updateUiLanguage } from '../auth/authApi';
import { useRouteLanguage } from './routeLanguage';
import {
  AUTO_LANGUAGE,
  type LanguagePreference,
  type SupportedLanguage,
  detectBrowserLanguage,
  normalizeLanguagePreference,
  readStoredLanguagePreference,
  resolveLanguage,
  writeStoredLanguagePreference,
} from './languages';

export interface LanguagePreferenceState {
  /** The language currently rendered: the URL's on public pages, otherwise the preference's. */
  language: SupportedLanguage;
  /** The stored preference, which may be `auto`. */
  preference: LanguagePreference;
  /** Whether the preference is persisted to the account (vs. local only). */
  isPersistedToAccount: boolean;
  /** Apply and persist a new preference; takes effect immediately. */
  setPreference: (next: LanguagePreference) => void;
}

export function useLanguagePreference(): LanguagePreferenceState {
  const { i18n } = useTranslation();
  // Read the context directly instead of via `useAuth`: the switcher also
  // renders on standalone public pages (imprint, privacy, terms) that are not
  // wrapped in an AuthProvider, and a language switcher must never be the
  // reason such a page fails to render. Without a provider it simply behaves
  // like a signed-out visitor: local storage only.
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;
  const refreshUser = auth?.refreshUser;
  const promotedForUserRef = useRef<number | null>(null);

  const accountPreference = user ? normalizeLanguagePreference(user.ui_language) : null;
  const storedPreference = readStoredLanguagePreference();
  const preference: LanguagePreference =
    accountPreference && accountPreference !== AUTO_LANGUAGE
      ? accountPreference
      : storedPreference ?? accountPreference ?? AUTO_LANGUAGE;
  // Public pages render the language their URL names; the preference stays
  // untouched and applies again on the next non-public route.
  const routeLanguage = useRouteLanguage();
  const language = routeLanguage ?? resolveLanguage(preference);

  // Keep i18next in step with the resolved preference. Guarded so an
  // unchanged language never triggers a re-render loop.
  useEffect(() => {
    if (i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [i18n, language]);

  // Promote a guest's choice to a freshly signed-in account that has none.
  useEffect(() => {
    if (!user || promotedForUserRef.current === user.id) {
      return;
    }
    promotedForUserRef.current = user.id;
    const localChoice = readStoredLanguagePreference();
    const shouldPromote =
      localChoice !== null &&
      localChoice !== AUTO_LANGUAGE &&
      normalizeLanguagePreference(user.ui_language) === AUTO_LANGUAGE;
    if (!shouldPromote) {
      return;
    }
    void (async () => {
      try {
        await updateUiLanguage(localChoice);
        await refreshUser?.();
      } catch {
        // A failed sync must not break sign-in; the local choice still
        // applies and the next explicit switch will retry.
      }
    })();
  }, [refreshUser, user]);

  // Mirror the account preference into local storage so the *next* page load
  // starts in the right language immediately.
  //
  // Without this, every refresh renders once in the browser/stored language and
  // then flips as soon as `/auth/me/` resolves — a visible flash of the wrong
  // language across the whole UI. `resolveInitialLanguage()` reads this cache
  // synchronously at boot, before the first paint, so the flip disappears.
  //
  // Ordering matters: this effect is declared after the promotion effect, so
  // on the first commit for a user the promotion check still sees the guest's
  // own choice rather than the value written here.
  useEffect(() => {
    if (!accountPreference) {
      return;
    }
    if (readStoredLanguagePreference() !== accountPreference) {
      writeStoredLanguagePreference(accountPreference);
    }
  }, [accountPreference]);

  const setPreference = useCallback(
    (next: LanguagePreference) => {
      const normalized = normalizeLanguagePreference(next);
      // Always store locally: it keeps the choice working when signed out and
      // makes it available immediately, before the API round trip returns.
      writeStoredLanguagePreference(normalized);
      // On a public page the switcher also navigates to the counterpart URL,
      // which then fixes the language; don't flip the current page's text
      // ahead of that navigation.
      if (!routeLanguage) {
        void i18n.changeLanguage(resolveLanguage(normalized, detectBrowserLanguage()));
      }
      if (!user) {
        return;
      }
      void (async () => {
        try {
          await updateUiLanguage(normalized);
          await refreshUser?.();
        } catch {
          // Keep the switch applied locally even if persisting failed.
        }
      })();
    },
    [i18n, refreshUser, routeLanguage, user],
  );

  return {
    language,
    preference,
    isPersistedToAccount: Boolean(user),
    setPreference,
  };
}
