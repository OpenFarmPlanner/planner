/**
 * Resolves a public page's `<title>` and meta description in a given language
 * straight from the locale bundles.
 *
 * The build (sitemap/prerender head tags) runs outside React and i18next, so
 * this reads the same `home` namespace JSON the runtime uses instead of
 * keeping a second copy of the texts in `seoConfig.ts`.
 */

import homeDE from '../i18n/locales/de/home.json' with { type: 'json' };
import homeEN from '../i18n/locales/en/home.json' with { type: 'json' };
import homeES from '../i18n/locales/es/home.json' with { type: 'json' };
import homeFR from '../i18n/locales/fr/home.json' with { type: 'json' };
import type { PublicPage, SeoLanguage } from './seoConfig.ts';

const HOME_BUNDLES: Readonly<Record<SeoLanguage, unknown>> = {
  de: homeDE,
  en: homeEN,
  fr: homeFR,
  es: homeES,
};

function lookupKey(bundle: unknown, key: string): string | null {
  let node: unknown = bundle;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(segment in node)) {
      return null;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' && node.trim().length > 0 ? node : null;
}

/** Look up a `home` namespace key; throws when it is missing so a broken registry fails the build. */
export function resolveHomeText(language: SeoLanguage, key: string): string {
  const value = lookupKey(HOME_BUNDLES[language], key);
  if (value === null) {
    throw new Error(`Missing "${language}" translation for home:${key}`);
  }
  return value;
}

export interface PublicPageMeta {
  title: string;
  description: string;
}

export function resolvePublicPageMeta(page: PublicPage, language: SeoLanguage): PublicPageMeta {
  return {
    title: resolveHomeText(language, page.titleKey),
    description: resolveHomeText(language, page.descriptionKey),
  };
}
