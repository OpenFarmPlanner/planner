/**
 * Supported UI languages and the rules for picking one.
 *
 * Three things are deliberately kept apart across the app:
 *  1. the **UI language** (this module) — a user preference, never a project one;
 *  2. **public crop-library content**, which has real per-language translations
 *     on shared, language-independent records;
 *  3. **user project content** (project/location/bed names, notes, suppliers),
 *     which is shown exactly as typed and is never translated.
 *
 * Supported: German, English, French and Spanish. To add a language: extend
 * `SUPPORTED_LANGUAGES`, add a locale bundle under `src/i18n/locales/<code>/`,
 * register it in `config.ts`, add the code to `backend/config/languages.py`
 * and to the preboot resolver in `index.html`, and follow the checklist in
 * docs/i18n.md ("Adding a language").
 */

export const SUPPORTED_LANGUAGES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/** Last resort when nothing else resolves — matches the backend default. */
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

/** Stored preference: an explicit language, or "follow the browser". */
export const AUTO_LANGUAGE = 'auto';
export type LanguagePreference = SupportedLanguage | typeof AUTO_LANGUAGE;

export const LANGUAGE_STORAGE_KEY = 'ui.language';

const SUPPORTED_CODES: readonly string[] = SUPPORTED_LANGUAGES.map((entry) => entry.code);

/**
 * Reduce a BCP-47 tag to a supported language code.
 *
 * `de`, `de-AT`, `de-DE`, `de-CH` and `de_DE` all resolve to `de`; `en`,
 * `en-US`, `en-GB` to `en`; `fr-FR`, `fr-CA`, `fr-CH` to `fr`; `es-ES`,
 * `es-MX`, `es-419` to `es`; anything unsupported to `null` so callers decide
 * the fallback themselves.
 */
export function normalizeLanguageTag(value: string | null | undefined): SupportedLanguage | null {
  const normalized = (value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) {
    return null;
  }
  const base = normalized.split('-')[0];
  return SUPPORTED_CODES.includes(base) ? (base as SupportedLanguage) : null;
}

export function isSupportedLanguage(value: string | null | undefined): value is SupportedLanguage {
  return normalizeLanguageTag(value) === value;
}

/** Validate a stored/served preference value, defaulting to `auto`. */
export function normalizeLanguagePreference(value: string | null | undefined): LanguagePreference {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === AUTO_LANGUAGE) {
    return AUTO_LANGUAGE;
  }
  return normalizeLanguageTag(normalized) ?? AUTO_LANGUAGE;
}

/**
 * First supported language among the browser's preferences.
 *
 * Only ever used as an *initial* value: a deliberate choice by the user is
 * stored and takes precedence on every later visit, so switching to German on
 * an English-configured browser is not undone by the next page load.
 */
export function detectBrowserLanguage(
  navigatorLike: Pick<Navigator, 'languages' | 'language'> | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
): SupportedLanguage {
  const candidates = [
    ...(navigatorLike?.languages ?? []),
    navigatorLike?.language ?? '',
  ];
  for (const candidate of candidates) {
    const resolved = normalizeLanguageTag(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return FALLBACK_LANGUAGE;
}

/** The guest's stored choice, or `null` when they never made one. */
export function readStoredLanguagePreference(): LanguagePreference | null {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === null) {
      return null;
    }
    const normalized = (stored ?? '').trim().toLowerCase();
    if (normalized === AUTO_LANGUAGE) {
      return AUTO_LANGUAGE;
    }
    return normalizeLanguageTag(normalized);
  } catch {
    // Private mode / storage disabled: fall back to browser detection rather
    // than breaking the app.
    return null;
  }
}

export function writeStoredLanguagePreference(preference: LanguagePreference | null): void {
  try {
    if (preference === null) {
      window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Storage failures must not block a language switch; the choice still
    // applies for this session.
  }
}

/**
 * Session-scoped marker for a language picked while signed out.
 *
 * Unlike `LANGUAGE_STORAGE_KEY` — which also caches the account preference and
 * may be a leftover in a shared browser — this only exists in the tab where
 * someone deliberately switched just before signing in, so it may override an
 * explicit account preference (see `useLanguagePreference`).
 */
export const SIGNED_OUT_LANGUAGE_CHOICE_KEY = 'ui.language.signedOutChoice';

export function readSignedOutLanguageChoice(): LanguagePreference | null {
  try {
    const stored = window.sessionStorage.getItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY);
    return stored === null ? null : normalizeLanguagePreference(stored);
  } catch {
    return null;
  }
}

export function writeSignedOutLanguageChoice(choice: LanguagePreference | null): void {
  try {
    if (choice === null) {
      window.sessionStorage.removeItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY);
      return;
    }
    window.sessionStorage.setItem(SIGNED_OUT_LANGUAGE_CHOICE_KEY, choice);
  } catch {
    // Without session storage the account preference simply wins on sign-in.
  }
}

/**
 * Turn a preference into the language to actually render.
 *
 * `auto` (and "no preference stored") means: follow the browser, falling back
 * to English. An explicit preference always wins over the browser.
 */
export function resolveLanguage(
  preference: LanguagePreference | null | undefined,
  browserLanguage: SupportedLanguage = detectBrowserLanguage(),
): SupportedLanguage {
  if (preference && preference !== AUTO_LANGUAGE) {
    return preference;
  }
  return browserLanguage;
}

/**
 * The language to start the app in, before any user data has loaded.
 *
 * Priority: stored choice (guest or last signed-in session) → browser
 * language → English. The signed-in user's server-side preference is applied
 * on top of this once `/auth/me/` resolves — see `useLanguagePreference`.
 */
export function resolveInitialLanguage(): SupportedLanguage {
  return resolveLanguage(readStoredLanguagePreference());
}

/** Human-readable label for a language, in that language. */
export function getLanguageLabel(code: SupportedLanguage): string {
  return SUPPORTED_LANGUAGES.find((entry) => entry.code === code)?.label ?? code;
}

/**
 * Human-readable name for an arbitrary ISO 639-1 language code (not just
 * `SUPPORTED_LANGUAGES` — e.g. a crop's `original_language_code`), localized
 * into `displayLanguage` (typically the current UI language). "German" in the
 * English UI, "Deutsch" in the German UI, regardless of which language is
 * being named.
 *
 * Falls back to the raw code if `Intl.DisplayNames` is unavailable or the
 * code isn't a language it recognizes, rather than showing nothing.
 */
export function getLanguageDisplayName(code: string | null | undefined, displayLanguage: string): string {
  if (!code) {
    return '';
  }
  try {
    const displayNames = new Intl.DisplayNames([displayLanguage], { type: 'language' });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}
