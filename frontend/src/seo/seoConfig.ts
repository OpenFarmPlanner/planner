/**
 * Central SEO configuration for OpenFarmPlanner.
 *
 * This module is the single source of truth for:
 *   - the canonical public site URL (used for canonical/OG tags, robots.txt and
 *     sitemap.xml), and
 *   - which routes are publicly indexable versus which must be kept out of
 *     search-engine indexes.
 *
 * It is intentionally free of DOM/React/Vite imports so it can be consumed both
 * by the Vite build (to emit robots.txt / sitemap.xml and inject <head> tags)
 * and by runtime React components, and unit-tested in isolation.
 *
 * The canonical domain is NOT hardcoded across the codebase — deployments set
 * `VITE_PUBLIC_SITE_URL`; everything else derives from `resolveSiteUrl()`.
 */

/** Fallback canonical site URL when `VITE_PUBLIC_SITE_URL` is not provided. */
export const DEFAULT_SITE_URL = 'https://openfarmplanner.org';

/** Default document language of the public site (matches index.html `lang`). */
export const SITE_LANGUAGE = 'de';

/**
 * A subset of `import.meta.env` / `process.env` this module reads. The index
 * signature keeps it structurally compatible with both `ImportMetaEnv` and
 * Node's `ProcessEnv` so callers can pass either directly.
 */
export interface SeoEnv {
  VITE_PUBLIC_SITE_URL?: string;
  VITE_SEO_INDEXABLE?: string;
  [key: string]: string | undefined;
}

/**
 * Normalize a configured site URL: trim, require an absolute http(s) origin and
 * drop any trailing slash so callers can safely concatenate `${siteUrl}${path}`.
 * Falls back to {@link DEFAULT_SITE_URL} for empty/invalid input.
 */
export function resolveSiteUrl(env: SeoEnv = {}): string {
  const raw = (env.VITE_PUBLIC_SITE_URL ?? '').trim();
  const candidate = raw.length > 0 ? raw : DEFAULT_SITE_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    parsed = new URL(DEFAULT_SITE_URL);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    parsed = new URL(DEFAULT_SITE_URL);
  }
  // Keep only the origin (scheme + host + optional port); strip trailing slash.
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Whether this deployment may be indexed by search engines.
 *
 * Defaults to `true` (production intent). Preview/staging/test hosts can opt out
 * deliberately by setting `VITE_SEO_INDEXABLE=false` (also accepts `0`/`no`/`off`),
 * which flips robots.txt to `Disallow: /` and adds a `noindex` meta tag — an
 * explicit, environment-dependent block rather than an accidental one.
 */
export function resolveIndexable(env: SeoEnv = {}): boolean {
  const raw = (env.VITE_SEO_INDEXABLE ?? '').trim().toLowerCase();
  if (raw === '') {
    return true;
  }
  return !['false', '0', 'no', 'off'].includes(raw);
}

export type ChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface PublicRoute {
  /** Absolute path from the site root, always starting with `/`. */
  path: string;
  /** Sitemap `<changefreq>` hint. */
  changefreq: ChangeFrequency;
  /** Sitemap `<priority>` in the range [0.0, 1.0]. */
  priority: number;
  /**
   * Route-specific `<title>` / `og:title` / `twitter:title`. Falls back to the
   * site default (see `buildHeadTags`) when omitted, which only the landing
   * page (`/`) should rely on.
   */
  title?: string;
  /**
   * Route-specific meta/OG/Twitter description. Falls back to the site
   * default when omitted.
   */
  description?: string;
}

/**
 * Publicly reachable, canonical, indexable routes.
 *
 * ONLY genuinely public information pages belong here — never login,
 * registration, password reset, invitations, demo-start or in-app (`/app/*`)
 * routes.
 * When a new public route is added (e.g. the planned public crop library under
 * `/crops`), add it here and it flows automatically into the sitemap and,
 * via `build/prerender.ts`, into build-time prerendered HTML.
 */
export const PUBLIC_INDEXABLE_ROUTES: readonly PublicRoute[] = [
  { path: '/', changefreq: 'weekly', priority: 1.0 },
  {
    path: '/ueber',
    changefreq: 'monthly',
    priority: 0.5,
    title: 'Über OpenFarmPlanner',
    description: 'Wie und warum OpenFarmPlanner entstanden ist: der Open-Source-Ansatz, die Finanzierung über Spenden, und wie du mitmachen kannst.',
  },
  {
    path: '/impressum',
    changefreq: 'yearly',
    priority: 0.3,
    title: 'Impressum – OpenFarmPlanner',
    description: 'Impressum von OpenFarmPlanner: Anbieterkennzeichnung, Kontaktangaben und verantwortliche Person gemäß § 5 ECG.',
  },
  {
    path: '/datenschutz',
    changefreq: 'yearly',
    priority: 0.3,
    title: 'Datenschutzerklärung – OpenFarmPlanner',
    description: 'Datenschutzerklärung von OpenFarmPlanner: Informationen zu Hosting, Registrierung, Projektdaten, Cookies und Ihren Rechten nach der DSGVO.',
  },
  {
    path: '/nutzungsbedingungen',
    changefreq: 'yearly',
    priority: 0.3,
    title: 'Nutzungsbedingungen – OpenFarmPlanner',
    description: 'Nutzungsbedingungen von OpenFarmPlanner: Regeln zu Accounts, Inhalten, der öffentlichen Kulturbibliothek und Haftung.',
  },
];

/**
 * Path prefixes that must never be indexed and are disallowed in robots.txt.
 *
 * These cover the authenticated application shell, the shareable demo-start
 * page and all authentication / account-management flows. They intentionally
 * do NOT include public info pages.
 */
export const NON_INDEXABLE_PATH_PREFIXES: readonly string[] = [
  '/app',
  '/demo',
  '/login',
  '/register',
  '/activate',
  '/forgot-password',
  '/reset-password',
  '/confirm-email-change',
  '/invite',
  '/invitation',
];

/** Normalize a pathname for comparison: ensure a leading slash and drop a
 * trailing slash (except for the root path). Query/hash are ignored. */
export function normalizePathname(pathname: string): string {
  const [pathOnly] = pathname.split(/[?#]/, 1);
  const withLeading = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  if (withLeading.length > 1 && withLeading.endsWith('/')) {
    return withLeading.replace(/\/+$/, '');
  }
  return withLeading;
}

/**
 * Decide whether a concrete pathname should be indexable.
 *
 * A path is indexable only when the deployment is indexable AND the path is one
 * of the known public routes AND it does not fall under a non-indexable prefix.
 */
export function isPathIndexable(pathname: string, indexable = true): boolean {
  if (!indexable) {
    return false;
  }
  const normalized = normalizePathname(pathname);
  if (
    NON_INDEXABLE_PATH_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    )
  ) {
    return false;
  }
  return PUBLIC_INDEXABLE_ROUTES.some((route) => route.path === normalized);
}

/** Build an absolute canonical URL for a given pathname. */
export function buildCanonicalUrl(siteUrl: string, pathname: string): string {
  const normalized = normalizePathname(pathname);
  return normalized === '/' ? `${siteUrl}/` : `${siteUrl}${normalized}`;
}
