/**
 * i18n configuration for OpenFarmPlanner.
 *
 * On public SEO pages the URL fixes the language (`routeLanguage.ts`).
 * Elsewhere the startup language comes from `resolveInitialLanguage()`: the
 * user's stored choice, otherwise the browser language, otherwise English. A
 * signed-in user's server-side preference is applied on top once their
 * profile loads (`useLanguagePreference`), so a deliberate choice survives
 * reloads and new sessions and is never silently re-overridden by the browser
 * language.
 *
 * Translation keys are grouped into namespaces by functional area; every
 * locale bundle (de, en, fr, es) must define the same keys, with each
 * language's own plural forms (enforced by
 * `src/__tests__/i18nKeyParity.test.ts`).
 */

import i18n, { type BackendModule, type ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  FALLBACK_LANGUAGE,
  normalizeLanguageTag,
  resolveInitialLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from './languages';
import { getRouteLanguage } from './routeLanguage';

type LanguageBundle = Record<string, Record<string, unknown>>;

/**
 * Every namespace, in every language (see `locales/<code>/index.ts`). Keys must
 * match across languages (`src/__tests__/i18nKeyParity.test.ts`), which is why
 * no fallback language is needed at runtime.
 */
export const I18N_NAMESPACES = [
  'common', 'navigation', 'home', 'dashboard', 'locations', 'crops', 'plantingPlans', 'fields', 'beds',
  'hierarchy', 'ganttChart', 'yieldOverview', 'suppliers', 'help', 'auth', 'account', 'projectInvitations',
  'notifications', 'feedback',
] as const;

/**
 * One chunk per language, downloaded only when that language is needed, so a
 * first visit carries the active language's translations and no others.
 * Adding a language means adding its `locales/<code>/index.ts` here.
 */
const LANGUAGE_BUNDLES: Record<SupportedLanguage, () => Promise<{ default: LanguageBundle }>> = {
  de: () => import('./locales/de/index'),
  en: () => import('./locales/en/index'),
  fr: () => import('./locales/fr/index'),
  es: () => import('./locales/es/index'),
};

const bundleRequests = new Map<string, Promise<LanguageBundle>>();

function loadBundle(language: string): Promise<LanguageBundle> {
  const code = normalizeLanguageTag(language);
  if (!code) {
    return Promise.reject(new Error(`Unsupported language: ${language}`));
  }
  let request = bundleRequests.get(code);
  if (!request) {
    request = LANGUAGE_BUNDLES[code]().then((module) => module.default);
    // A failed download must be retryable, not cached forever.
    request.catch(() => bundleRequests.delete(code));
    bundleRequests.set(code, request);
  }
  return request;
}

/** i18next backend that reads a namespace from its language's lazily imported bundle. */
const lazyLanguageBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(language, namespace, callback) {
    loadBundle(language).then(
      (bundle) => callback(null, (bundle[namespace] ?? {}) as ResourceKey),
      (error: unknown) => callback(error as Error, null),
    );
  },
};

/** Whether every namespace of `language` is loaded, i.e. it can be shown without raw keys. */
export function isLanguageLoaded(language: string): boolean {
  return I18N_NAMESPACES.every((namespace) => i18n.hasResourceBundle(language, namespace));
}

/**
 * Loads `languages` (all supported ones by default) without switching to
 * them, for features that read several languages at once: the spreadsheet
 * import's header recognition and the command palette's English aliases.
 */
export async function loadLanguages(
  languages: readonly string[] = SUPPORTED_LANGUAGES.map(({ code }) => code),
): Promise<void> {
  await i18n.loadLanguages([...languages]);
}

/**
 * Switches the UI language once its bundle is loaded. If the download fails,
 * the current language stays (no screen of raw keys) and `false` is returned.
 */
export async function switchLanguage(language: string): Promise<boolean> {
  await loadLanguages([language]).catch(() => undefined);
  if (!isLanguageLoaded(language)) {
    return false;
  }
  await i18n.changeLanguage(language);
  return true;
}

const initialLanguage = getRouteLanguage() ?? resolveInitialLanguage();

/**
 * Resolves once the startup language is loaded; `main.tsx` renders after it.
 * Rejects only when neither that language nor English could be downloaded.
 */
export const i18nReady: Promise<void> = i18n
  .use(lazyLanguageBackend)
  .use(initReactI18next)
  .init({
    // A public page's URL fixes its language (routeLanguage.ts); everywhere
    // else it is resolved from the stored choice / browser language.
    lng: initialLanguage,
    // No runtime fallback: every bundle has every key (key-parity test), and a
    // fallback language would be downloaded on every first visit.
    fallbackLng: false,
    supportedLngs: SUPPORTED_LANGUAGES.map(({ code }) => code),
    load: 'currentOnly',

    // Enable debug mode in development
    debug: import.meta.env.DEV && import.meta.env.MODE !== 'test',

    ns: [...I18N_NAMESPACES],
    defaultNS: 'common',

    interpolation: {
      escapeValue: false, // React already escapes values
    },

    react: {
      useSuspense: false,
      // Re-render when another language's bundle arrives (e.g. the English
      // command aliases), not only when the UI language changes.
      bindI18n: 'languageChanged loaded',
    },
  })
  .then(async () => {
    if (isLanguageLoaded(initialLanguage)) return;
    // The startup language could not be downloaded: English is the last resort.
    if (initialLanguage === FALLBACK_LANGUAGE || !(await switchLanguage(FALLBACK_LANGUAGE))) {
      throw new Error(`The "${initialLanguage}" translations could not be loaded.`);
    }
  });

// Keep <html lang> in step from the very first paint. index.html ships a
// static `lang`, so without this the document would claim the wrong language
// until a component mounted and corrected it.
function applyDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

applyDocumentLanguage(i18n.resolvedLanguage ?? i18n.language ?? FALLBACK_LANGUAGE);
i18n.on('languageChanged', applyDocumentLanguage);

/**
 * The UI language currently rendered. Requests that make the backend email
 * someone send it as `?language=`, so the email matches what the user sees
 * (docs/i18n.md, "E-Mails").
 */
export function getCurrentUiLanguage(): SupportedLanguage {
  return normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;
}

export default i18n;
