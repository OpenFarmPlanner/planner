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
 * A language the user picked that is not yet saved to their account.
 *
 * Set by every switch and cleared only once the account holds the value, so a
 * choice made while the app did not know about the account (signed out, or on
 * a public page, which skips the `/auth/me/` probe) or whose save failed is
 * saved on the next signed-in load instead of being overwritten by the old
 * account value. Kept in `localStorage`, unlike `LANGUAGE_STORAGE_KEY` it
 * never caches the account value, so it may override an explicit account
 * preference (see `useLanguagePreference`).
 */
export const PENDING_LANGUAGE_CHOICE_KEY = 'ui.language.pendingChoice';

/**
 * @deprecated Tab-scoped `sessionStorage` key of the same marker, written by
 * builds before it moved to `localStorage`. Still read (and migrated) so a
 * choice made in a tab that was open across the deploy is not lost; remove
 * once no open tab can still carry it, i.e. one release after the move.
 */
export const LEGACY_SIGNED_OUT_LANGUAGE_CHOICE_KEY = 'ui.language.signedOutChoice';

function readLegacySignedOutLanguageChoice(): string | null {
  try {
    const legacy = window.sessionStorage.getItem(LEGACY_SIGNED_OUT_LANGUAGE_CHOICE_KEY);
    if (legacy !== null) {
      window.sessionStorage.removeItem(LEGACY_SIGNED_OUT_LANGUAGE_CHOICE_KEY);
      window.localStorage.setItem(PENDING_LANGUAGE_CHOICE_KEY, legacy);
    }
    return legacy;
  } catch {
    return null;
  }
}

export function readPendingLanguageChoice(): LanguagePreference | null {
  try {
    const stored = window.localStorage.getItem(PENDING_LANGUAGE_CHOICE_KEY) ?? readLegacySignedOutLanguageChoice();
    return stored === null ? null : normalizeLanguagePreference(stored);
  } catch {
    return null;
  }
}

export function writePendingLanguageChoice(choice: LanguagePreference | null): void {
  try {
    window.sessionStorage.removeItem(LEGACY_SIGNED_OUT_LANGUAGE_CHOICE_KEY);
    if (choice === null) {
      window.localStorage.removeItem(PENDING_LANGUAGE_CHOICE_KEY);
      return;
    }
    window.localStorage.setItem(PENDING_LANGUAGE_CHOICE_KEY, choice);
  } catch {
    // Without storage the account preference simply wins on the next load.
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
