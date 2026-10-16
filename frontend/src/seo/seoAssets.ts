/**
 * Pure builders for SEO artifacts served at the site root:
 *   - robots.txt
 *   - sitemap.xml
 *   - the canonical / Open Graph / Twitter / robots <head> tags injected into
 *     the built index.html.
 *
 * Kept side-effect free and DOM-free so the Vite build and unit tests can call
 * them directly. The canonical domain and route lists come exclusively from
 * `seoConfig.ts`.
 */

import {
  DEFAULT_SEO_LANGUAGE,
  NON_INDEXABLE_PATH_PREFIXES,
  OG_LOCALES,
  PUBLIC_PAGE_VARIANTS,
  buildCanonicalUrl,
  buildHreflangAlternates,
  type HreflangAlternate,
  type PublicPageVariant,
  type SeoLanguage,
} from './seoConfig.ts';

export interface RobotsOptions {
  siteUrl: string;
  indexable: boolean;
}

/**
 * Build robots.txt.
 *
 * When indexable: allow all user agents, explicitly disallow the private
 * app/auth prefixes, and advertise the sitemap. When not indexable
 * (preview/staging/test): block everything with `Disallow: /`.
 */
export function buildRobotsTxt({ siteUrl, indexable }: RobotsOptions): string {
  if (!indexable) {
    return [
      '# This deployment is intentionally excluded from search engines',
      '# (VITE_SEO_INDEXABLE=false). Production sets it to true.',
      'User-agent: *',
      'Disallow: /',
      '',
    ].join('\n');
  }

  const disallowLines = NON_INDEXABLE_PATH_PREFIXES.map(
    (prefix) => `Disallow: ${prefix}`,
  );

  return [
    '# OpenFarmPlanner robots.txt — generated at build time from seoConfig.ts',
    'User-agent: *',
    ...disallowLines,
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

export interface SitemapOptions {
  siteUrl: string;
  variants?: readonly PublicPageVariant[];
  /** ISO date (YYYY-MM-DD) used for `<lastmod>`. Defaults to today (UTC). */
  lastmod?: string;
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build a valid urlset sitemap.xml: one `<url>` per language version of every
 * public page, each listing the page's full set of reciprocal hreflang
 * alternates (`xhtml:link`) including `x-default`.
 */
export function buildSitemapXml({
  siteUrl,
  variants = PUBLIC_PAGE_VARIANTS,
  lastmod = todayIsoUtc(),
}: SitemapOptions): string {
  const urlEntries = variants
    .map((variant) => {
      const loc = buildCanonicalUrl(siteUrl, variant.path);
      const alternates = buildHreflangAlternates(siteUrl, variant.page).map(
        (alternate) =>
          `    <xhtml:link rel="alternate" hreflang="${alternate.hreflang}" href="${alternate.href}" />`,
      );
      return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        ...alternates,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${variant.page.changefreq}</changefreq>`,
        `    <priority>${variant.page.priority.toFixed(1)}</priority>`,
        '  </url>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urlEntries,
    '</urlset>',
    '',
  ].join('\n');
}

export interface HeadTagsOptions {
  siteUrl: string;
  indexable: boolean;
  title?: string;
  description?: string;
  /** Canonical path for the initially served document (the landing page). */
  path?: string;
  /** Document language; drives `og:locale`. */
  language?: SeoLanguage;
  /** Reciprocal hreflang alternates; only public pages carry them. */
  alternates?: readonly HreflangAlternate[];
  /** Absolute or root-relative path to the social preview image. */
  imagePath?: string;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the list of <head> tags injected into index.html at build time.
 *
 * These give crawlers a canonical URL, Open Graph / Twitter preview metadata and
 * an explicit robots directive from the very first (pre-JavaScript) HTML
 * response, which is what a static SPA otherwise lacks.
 */
export function buildHeadTags(options: HeadTagsOptions): string[] {
  const {
    siteUrl,
    indexable,
    title = 'OpenFarmPlanner',
    description = 'OpenFarmPlanner ist ein Open-Source-Anbauplaner für den Gemüsebau. Plane Kulturen, Anbauflächen und Anbauzeiträume an einem Ort.',
    path = '/',
    language = DEFAULT_SEO_LANGUAGE,
    alternates = [],
    imagePath = '/landing/hero-field.webp',
  } = options;

  const canonical = buildCanonicalUrl(siteUrl, path);
  const imageUrl = imagePath.startsWith('http')
    ? imagePath
    : `${siteUrl}${imagePath.startsWith('/') ? '' : '/'}${imagePath}`;

  const t = escapeHtmlAttribute(title);
  const d = escapeHtmlAttribute(description);

  const tags = [
    `<link rel="canonical" href="${canonical}" />`,
    ...alternates.map(
      (alternate) => `<link rel="alternate" hreflang="${alternate.hreflang}" href="${alternate.href}" />`,
    ),
    `<meta name="robots" content="${indexable ? 'index, follow' : 'noindex, nofollow'}" />`,
    `<meta name="description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="OpenFarmPlanner" />`,
    `<meta property="og:locale" content="${OG_LOCALES[language]}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${imageUrl}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${imageUrl}" />`,
  ];

  return tags;
}

export interface SoftwareApplicationJsonLdOptions {
  /** Canonical URL of the landing page this markup is embedded in. */
  url: string;
  description: string;
  language: SeoLanguage;
}

/**
 * JSON-LD `SoftwareApplication` structured data for the landing page only
 * (see `build/prerenderSeo.ts`, gated the same way as the hero image
 * preload). Every claim here must stay true to what the page itself states
 * (free to use, AGPL-3.0, no account required for the demo) - search
 * engines penalize structured data that disagrees with the visible page.
 */
export function buildSoftwareApplicationJsonLd({ url, description, language }: SoftwareApplicationJsonLdOptions): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenFarmPlanner',
    url,
    description,
    inLanguage: language,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Any (web-based)',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    },
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  };

  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
