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
 * **A choice not yet saved to the account** (`readPendingLanguageChoice`)
 * wins over the account value and is saved on the next signed-in load. That
 * covers a switch made while signed out, one made on a public page (which
 * skips the `/auth/me/` probe, so a signed-in user looks signed out there),
 * and one whose save failed. It is cleared only once the account holds it.
 * Otherwise the locally stored value is only promoted when the account has no
 * explicit preference (`auto`); an explicit account preference wins over it,
 * because that value may just be the cache of another account's preference.
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
  readPendingLanguageChoice,
  readStoredLanguagePreference,
  resolveLanguage,
  writePendingLanguageChoice,
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
  // An unsaved choice already decides the rendered language, so the account's
  // old value never flashes in between (or wins after a failed save).
  const pendingChoice = user ? readPendingLanguageChoice() : null;
  const preference: LanguagePreference =
    pendingChoice
      ?? (accountPreference && accountPreference !== AUTO_LANGUAGE
        ? accountPreference
        : storedPreference ?? accountPreference ?? AUTO_LANGUAGE);
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

  /**
   * Save `choice` to the account. The pending marker is cleared only once the
   * account and the loaded user hold it, and only if no
   * newer switch replaced it meanwhile; on failure it stays, keeps deciding
   * the rendered language and is saved again on the next signed-in load.
   */
  const saveToAccount = useCallback(
    async (choice: LanguagePreference) => {
      try {
        await updateUiLanguage(choice);
      } catch {
        return;
      }
      // Until the loaded user carries the new value, the pending marker is
      // what keeps the stale in-memory account value from winning.
      const refreshed = await refreshUser?.().catch(() => null);
      if (
        refreshed
        && normalizeLanguagePreference(refreshed.ui_language) === choice
        && readPendingLanguageChoice() === choice
      ) {
        writePendingLanguageChoice(null);
      }
    },
    [refreshUser],
  );

  // Save a choice the account does not hold yet once a user is known.
  useEffect(() => {
    if (!user) {
      // Signing out re-arms the check, so signing back in after switching the
      // language on a public page promotes that choice too.
      promotedForUserRef.current = null;
      return;
    }
    if (promotedForUserRef.current === user.id) {
      return;
    }
    promotedForUserRef.current = user.id;
    const accountChoice = normalizeLanguagePreference(user.ui_language);
    const unsavedChoice = readPendingLanguageChoice();
    if (unsavedChoice !== null && unsavedChoice === accountChoice) {
      writePendingLanguageChoice(null);
      return;
    }
    const storedChoice = readStoredLanguagePreference();
    const choiceToPromote =
      unsavedChoice
      ?? (storedChoice !== null && storedChoice !== AUTO_LANGUAGE && accountChoice === AUTO_LANGUAGE
        ? storedChoice
        : null);
    if (choiceToPromote === null) {
      return;
    }
    // Not awaited: sign-in never waits on, or fails with, this save.
    void saveToAccount(choiceToPromote);
  }, [saveToAccount, user]);

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
    if (!accountPreference || pendingChoice) {
      return;
    }
    if (readStoredLanguagePreference() !== accountPreference) {
      writeStoredLanguagePreference(accountPreference);
    }
  }, [accountPreference, pendingChoice]);

  const setPreference = useCallback(
    (next: LanguagePreference) => {
      const normalized = normalizeLanguagePreference(next);
      // Always store locally: it keeps the choice working when signed out and
      // makes it available immediately, before the API round trip returns.
      writeStoredLanguagePreference(normalized);
      // Pending until the account holds it: saved right away when signed in,
      // otherwise (or if that save fails) on the next signed-in load.
      writePendingLanguageChoice(normalized);
      // On a public page the switcher also navigates to the counterpart URL,
      // which then fixes the language; don't flip the current page's text
      // ahead of that navigation.
      if (!routeLanguage) {
        void i18n.changeLanguage(resolveLanguage(normalized, detectBrowserLanguage()));
      }
      if (!user) {
        return;
      }
      void saveToAccount(normalized);
    },
    [i18n, routeLanguage, saveToAccount, user],
  );

  return {
    language,
    preference,
    isPersistedToAccount: Boolean(user),
    setPreference,
  };
}
