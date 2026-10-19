/**
 * Sends visitors of a public page to the language version they read.
 *
 * Every public page exists once per language (German, English, French,
 * Spanish), and each URL always renders its own language (`routeLanguage.ts`),
 * so search engines can index all of them. Visitors, however, should land in
 * their language: on the first load of a public page we replace the URL with
 * its counterpart when the visitor's language differs — their explicit choice
 * from the switcher if they made one, otherwise the browser language (German,
 * French and Spanish browsers get their language, everything else English).
 *
 * Crawlers are never redirected: they must see every URL in its own language,
 * otherwise the other language versions would fall out of the index again. Client-side
 * navigation is never redirected either; links already point at the current
 * language's URLs.
 *
 * `index.html` runs the same check before first paint on prerendered pages;
 * this module is the fallback for the dev server and the SPA shell. Keep the
 * crawler pattern in sync with the copy there.
 */

import { findPublicPageVariant } from '../seo/seoConfig';
import { resolveInitialLanguage, type SupportedLanguage } from './languages';
import { toAppRelativePathname } from './routeLanguage';

/** User agents of search engines, link previews and audit tools. */
export const CRAWLER_USER_AGENT_PATTERN =
  /bot\b|bot\/|crawl|spider|slurp|mediapartners|google-inspectiontool|facebookexternalhit|embedly|lighthouse|bingpreview|whatsapp|telegram|ia_archiver/i;

export function isCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  return CRAWLER_USER_AGENT_PATTERN.test(userAgent ?? '');
}

/**
 * The counterpart path a visitor of `pathname` should be sent to, or `null`
 * when the page is not public or already in `preferredLanguage`.
 */
export function preferredPublicPagePath(pathname: string, preferredLanguage: SupportedLanguage): string | null {
  const variant = findPublicPageVariant(pathname);
  if (!variant || variant.language === preferredLanguage) {
    return null;
  }
  return variant.page.paths[preferredLanguage];
}

/**
 * Replace the current public page URL with the visitor's language version.
 * Returns `true` when a redirect was started, so the caller can skip
 * rendering the page that is about to be left.
 */
export function redirectToPreferredLanguageVersion(): boolean {
  if (typeof window === 'undefined' || isCrawlerUserAgent(window.navigator.userAgent)) {
    return false;
  }
  const target = preferredPublicPagePath(
    toAppRelativePathname(window.location.pathname),
    resolveInitialLanguage(),
  );
  if (!target) {
    return false;
  }
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  window.location.replace(`${base}${target}${window.location.search}${window.location.hash}`);
  return true;
}
