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
  NON_INDEXABLE_PATH_PREFIXES,
  PUBLIC_INDEXABLE_ROUTES,
  SITE_LANGUAGE,
  buildCanonicalUrl,
  type PublicRoute,
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
  routes?: readonly PublicRoute[];
  /** ISO date (YYYY-MM-DD) used for `<lastmod>`. Defaults to today (UTC). */
  lastmod?: string;
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build a valid urlset sitemap.xml containing only public, canonical URLs. */
export function buildSitemapXml({
  siteUrl,
  routes = PUBLIC_INDEXABLE_ROUTES,
  lastmod = todayIsoUtc(),
}: SitemapOptions): string {
  const urlEntries = routes
    .map((route) => {
      const loc = buildCanonicalUrl(siteUrl, route.path);
      return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${route.changefreq}</changefreq>`,
        `    <priority>${route.priority.toFixed(1)}</priority>`,
        '  </url>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
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
    `<meta name="robots" content="${indexable ? 'index, follow' : 'noindex, nofollow'}" />`,
    `<meta name="description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="OpenFarmPlanner" />`,
    `<meta property="og:locale" content="${SITE_LANGUAGE === 'de' ? 'de_DE' : SITE_LANGUAGE}" />`,
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
  siteUrl: string;
  description: string;
}

/**
 * JSON-LD `SoftwareApplication` structured data for the landing page only
 * (see `build/prerenderSeo.ts`, gated the same way as the hero image
 * preload). Every claim here must stay true to what the page itself states
 * (free to use, AGPL-3.0, no account required for the demo) - search
 * engines penalize structured data that disagrees with the visible page.
 */
export function buildSoftwareApplicationJsonLd({ siteUrl, description }: SoftwareApplicationJsonLdOptions): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenFarmPlanner',
    url: `${siteUrl}/`,
    description,
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
