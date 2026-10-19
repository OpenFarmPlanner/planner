/**
 * Central SEO configuration for OpenFarmPlanner.
 *
 * This module is the single source of truth for:
 *   - the canonical public site URL (used for canonical/OG tags, robots.txt and
 *     sitemap.xml),
 *   - the registry of public pages with their paths in every language
 *     (`PUBLIC_PAGES`), and
 *   - which routes must be kept out of search-engine indexes.
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

/** Languages every public page is published in, in hreflang order. */
export const SEO_LANGUAGES = ['de', 'en', 'fr', 'es'] as const;
export type SeoLanguage = (typeof SEO_LANGUAGES)[number];

/**
 * The site's default language: served at the root without a path prefix and
 * used as the `x-default` hreflang target.
 */
export const DEFAULT_SEO_LANGUAGE: SeoLanguage = 'de';

/** Open Graph `og:locale` value per language. */
export const OG_LOCALES: Readonly<Record<SeoLanguage, string>> = {
  de: 'de_DE',
  en: 'en_US',
  fr: 'fr_FR',
  es: 'es_ES',
};

export type PublicPageId = 'home' | 'about' | 'imprint' | 'privacy' | 'terms';

export interface PublicPage {
  id: PublicPageId;
  /**
   * Canonical path per language: absolute, slashless (except the German root
   * `/`), and German without a language prefix while every other language
   * lives under `/<lang>`.
   */
  paths: Readonly<Record<SeoLanguage, string>>;
  /** Sitemap `<changefreq>` hint. */
  changefreq: ChangeFrequency;
  /** Sitemap `<priority>` in the range [0.0, 1.0]. */
  priority: number;
  /**
   * `home` namespace keys of the `<title>`/`og:title` and the meta/OG
   * description. The texts themselves live in the locale bundles
   * (`src/i18n/locales/<lang>/home.json`) like every other UI string.
   */
  titleKey: string;
  descriptionKey: string;
}

/**
 * The single registry of public, indexable marketing pages.
 *
 * Everything public-page related derives from this list: the router entries
 * (`App.tsx`), build-time prerendering (`build/prerender.ts`), sitemap.xml,
 * canonical + hreflang tags (build time and runtime), the language switcher's
 * counterpart links and the startup auth-probe skip list. Never duplicate a
 * public path anywhere else.
 *
 * ONLY genuinely public information pages belong here — never login,
 * registration, password reset, invitations, demo-start or in-app (`/app/*`)
 * routes. Adding a page: see "Public pages and SEO" in CLAUDE.md and
 * docs/seo-and-indexing.md.
 */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    id: 'home',
    paths: { de: '/', en: '/en', fr: '/fr', es: '/es' },
    changefreq: 'weekly',
    priority: 1.0,
    titleKey: 'seo.titles.landing',
    descriptionKey: 'seo.descriptions.landing',
  },
  {
    id: 'about',
    paths: { de: '/ueber', en: '/en/about', fr: '/fr/a-propos', es: '/es/acerca-de' },
    changefreq: 'monthly',
    priority: 0.5,
    titleKey: 'seo.titles.about',
    descriptionKey: 'seo.descriptions.about',
  },
  {
    id: 'imprint',
    paths: { de: '/impressum', en: '/en/legal-notice', fr: '/fr/mentions-legales', es: '/es/aviso-legal' },
    changefreq: 'yearly',
    priority: 0.3,
    titleKey: 'seo.titles.imprint',
    descriptionKey: 'seo.descriptions.imprint',
  },
  {
    id: 'privacy',
    paths: { de: '/datenschutz', en: '/en/privacy', fr: '/fr/confidentialite', es: '/es/privacidad' },
    changefreq: 'yearly',
    priority: 0.3,
    titleKey: 'seo.titles.privacy',
    descriptionKey: 'seo.descriptions.privacy',
  },
  {
    id: 'terms',
    paths: { de: '/nutzungsbedingungen', en: '/en/terms', fr: '/fr/conditions-utilisation', es: '/es/terminos' },
    changefreq: 'yearly',
    priority: 0.3,
    titleKey: 'seo.titles.terms',
    descriptionKey: 'seo.descriptions.terms',
  },
];

/** One language version of a public page — the unit that is served, prerendered and listed in the sitemap. */
export interface PublicPageVariant {
  page: PublicPage;
  language: SeoLanguage;
  path: string;
}

/** Every served public URL path: each registered page in each language. */
export const PUBLIC_PAGE_VARIANTS: readonly PublicPageVariant[] = PUBLIC_PAGES.flatMap((page) =>
  SEO_LANGUAGES.map((language) => ({ page, language, path: page.paths[language] })),
);

/** Look up the public page variant served at a pathname (trailing slash tolerated). */
export function findPublicPageVariant(pathname: string): PublicPageVariant | null {
  const normalized = normalizePathname(pathname);
  return PUBLIC_PAGE_VARIANTS.find((variant) => variant.path === normalized) ?? null;
}

/** The registry path of a public page in a language. */
export function publicPagePath(id: PublicPageId, language: SeoLanguage): string {
  const page = PUBLIC_PAGES.find((candidate) => candidate.id === id);
  if (!page) {
    throw new Error(`Unknown public page: ${id}`);
  }
  return page.paths[language];
}

/** Narrow an arbitrary language code to a public-page language, falling back to the default. */
export function toSeoLanguage(language: string | null | undefined): SeoLanguage {
  return (SEO_LANGUAGES as readonly string[]).includes(language ?? '')
    ? (language as SeoLanguage)
    : DEFAULT_SEO_LANGUAGE;
}

export interface HreflangAlternate {
  /** A language code (`de`, `en`, `fr`, `es`) or `x-default`. */
  hreflang: string;
  href: string;
}

/**
 * Reciprocal hreflang alternates of a page: one per language plus
 * `x-default` pointing at the default-language version. Every language
 * version of the page carries this identical set.
 */
export function buildHreflangAlternates(siteUrl: string, page: PublicPage): HreflangAlternate[] {
  return [
    ...SEO_LANGUAGES.map((language) => ({
      hreflang: language,
      href: buildCanonicalUrl(siteUrl, page.paths[language]),
    })),
    { hreflang: 'x-default', href: buildCanonicalUrl(siteUrl, page.paths[DEFAULT_SEO_LANGUAGE]) },
  ];
}

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
  return findPublicPageVariant(normalized) !== null;
}

/**
 * Build an absolute canonical URL for a given pathname: always slashless
 * (only the site root keeps its `/`), on the configured canonical host.
 */
export function buildCanonicalUrl(siteUrl: string, pathname: string): string {
  const normalized = normalizePathname(pathname);
  return normalized === '/' ? `${siteUrl}/` : `${siteUrl}${normalized}`;
}
