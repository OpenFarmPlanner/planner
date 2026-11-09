/**
 * Runtime, route-aware SEO metadata for the SPA.
 *
 * The build injects static canonical/robots tags for the initial HTML and
 * prerenders the full head of every public page. This component keeps them
 * correct as the user (or a JavaScript-rendering crawler such as Googlebot)
 * navigates client-side:
 *
 *   - public pages (`PUBLIC_PAGES`) keep `robots: index, follow` and get a
 *     slashless self-canonical, reciprocal hreflang alternates and the
 *     registry's title/description in the URL's language;
 *   - every private/auth/app route switches to `robots: noindex, nofollow`.
 *
 * It renders nothing and only mutates the document <head>. It complements — does
 * not replace — robots.txt: robots.txt stops crawling of private paths, while
 * this guards crawlers that render JS and ignore robots.txt.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  OG_LOCALES,
  buildCanonicalUrl,
  buildHreflangAlternates,
  findPublicPageVariant,
  isPathIndexable,
  resolveIndexable,
  resolveSiteUrl,
  type HreflangAlternate,
} from './seoConfig';
import { loadLanguages } from '../i18n/config';
import { FALLBACK_LANGUAGE, normalizeLanguageTag } from '../i18n/languages';

/**
 * Page-title keys (in the `home` namespace) for the non-public routes that
 * have a meaningful, stable title. Public pages take theirs from the
 * `PUBLIC_PAGES` registry instead; everything else keeps the app-wide title.
 */
const NON_PUBLIC_ROUTE_TITLE_KEYS: Record<string, string> = {
  '/demo': 'seo.titles.demo',
  '/login': 'seo.titles.login',
  '/register': 'seo.titles.register',
};

const SITE_URL = resolveSiteUrl(import.meta.env);
const DEPLOYMENT_INDEXABLE = resolveIndexable(import.meta.env);

function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  );
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertCanonical(href: string): void {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

function replaceHreflangAlternates(alternates: readonly HreflangAlternate[]): void {
  document.head
    .querySelectorAll('link[rel="alternate"][hreflang]')
    .forEach((element) => element.remove());
  for (const alternate of alternates) {
    const element = document.createElement('link');
    element.setAttribute('rel', 'alternate');
    element.setAttribute('hreflang', alternate.hreflang);
    element.setAttribute('href', alternate.href);
    document.head.appendChild(element);
  }
}

/**
 * Side-effect-only component. Mount once near the router root so it runs on
 * every navigation.
 */
export default function RouteSeo(): null {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation('home');
  const language = normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;

  useEffect(() => {
    const indexable = isPathIndexable(pathname, DEPLOYMENT_INDEXABLE);
    const canonical = buildCanonicalUrl(SITE_URL, pathname);
    upsertMeta('name', 'robots', indexable ? 'index, follow' : 'noindex, nofollow');
    upsertCanonical(canonical);

    const variant = findPublicPageVariant(pathname);
    replaceHreflangAlternates(variant ? buildHreflangAlternates(SITE_URL, variant.page) : []);
    if (!variant) {
      return;
    }
    upsertMeta('property', 'og:url', canonical);
    upsertMeta('property', 'og:locale', OG_LOCALES[variant.language]);
    // Mirrors what build/prerenderSeo.ts bakes into the prerendered file, so
    // client-side navigation between public pages leaves the same head. The
    // texts come through i18next (not publicPageMeta.ts, which would put every
    // language's bundle into the main chunk); the page's language may still be
    // loading right after a switch.
    let cancelled = false;
    void loadLanguages([variant.language]).catch(() => undefined).then(() => {
      if (cancelled) return;
      const translate = i18n.getFixedT(variant.language, 'home');
      const title = translate(variant.page.titleKey);
      const description = translate(variant.page.descriptionKey);
      document.title = title;
      upsertMeta('name', 'description', description);
      upsertMeta('property', 'og:title', title);
      upsertMeta('property', 'og:description', description);
    });
    return () => {
      cancelled = true;
    };
  }, [i18n, pathname]);

  useEffect(() => {
    if (findPublicPageVariant(pathname)) {
      return;
    }
    document.documentElement.lang = language;
    const titleKey = NON_PUBLIC_ROUTE_TITLE_KEYS[pathname.replace(/\/+$/, '') || '/'];
    if (titleKey) {
      document.title = t(titleKey);
    }
  }, [language, pathname, t]);

  return null;
}
