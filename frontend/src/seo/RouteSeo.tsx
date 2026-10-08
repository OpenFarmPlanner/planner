/**
 * Runtime, route-aware SEO metadata for the SPA.
 *
 * The build injects static canonical/robots tags for the initial HTML (the
 * landing page). This component keeps them correct as the user (or a
 * JavaScript-rendering crawler such as Googlebot) navigates client-side:
 *
 *   - public info pages keep `robots: index, follow` and get a per-path canonical;
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
  buildCanonicalUrl,
  isPathIndexable,
  resolveIndexable,
  resolveSiteUrl,
} from './seoConfig';
import { FALLBACK_LANGUAGE, normalizeLanguageTag } from '../i18n/languages';

/**
 * Page-title keys per route, in the `home` namespace.
 *
 * Only routes with a meaningful, stable title are listed; everything else
 * keeps the app-wide title. Build-time SEO metadata (canonical, robots,
 * prerendered `<title>`) stays in the site's canonical language — see
 * `seoConfig.SITE_LANGUAGE` and docs/i18n.md; this only keeps the *runtime*
 * title and `<html lang>` in step with what the user is actually reading.
 */
const ROUTE_TITLE_KEYS: Record<string, string> = {
  '/': 'seo.titles.landing',
  '/ueber': 'seo.titles.about',
  '/demo': 'seo.titles.demo',
  '/impressum': 'seo.titles.imprint',
  '/datenschutz': 'seo.titles.privacy',
  '/nutzungsbedingungen': 'seo.titles.terms',
  '/login': 'seo.titles.login',
  '/register': 'seo.titles.register',
};

const SITE_URL = resolveSiteUrl(import.meta.env);
const DEPLOYMENT_INDEXABLE = resolveIndexable(import.meta.env);

function upsertMeta(name: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[name="${name}"]`,
  );
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('name', name);
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
    upsertMeta('robots', indexable ? 'index, follow' : 'noindex, nofollow');
    upsertCanonical(buildCanonicalUrl(SITE_URL, pathname));
  }, [pathname]);

  useEffect(() => {
    document.documentElement.lang = language;
    const titleKey = ROUTE_TITLE_KEYS[pathname.replace(/\/+$/, '') || '/'];
    if (titleKey) {
      document.title = t(titleKey);
    }
  }, [language, pathname, t]);

  return null;
}
