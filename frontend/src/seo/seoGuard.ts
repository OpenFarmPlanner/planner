/**
 * Consistency checks for the public-page SEO surface.
 *
 * Run by the build (`build/seoPlugin.ts` validates the registry and the
 * emitted sitemap, `build/prerender.ts` validates every prerendered `<head>`)
 * and by the unit tests, so a broken public page fails CI instead of
 * silently dropping out of Google. Each check returns a list of
 * human-readable problems; an empty list means the check passed.
 */

import {
  DEFAULT_SEO_LANGUAGE,
  NON_INDEXABLE_PATH_PREFIXES,
  OG_LOCALES,
  PUBLIC_PAGES,
  SEO_LANGUAGES,
  buildCanonicalUrl,
  buildHreflangAlternates,
  type HreflangAlternate,
  type PublicPage,
  type PublicPageVariant,
} from './seoConfig.ts';
import { resolvePublicPageMeta } from './publicPageMeta.ts';

/** Problems with a single absolute URL: non-root trailing slash or a `www.` host. */
export function checkCanonicalUrlShape(url: string): string[] {
  const problems: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [`${url} is not an absolute URL`];
  }
  if (parsed.hostname.toLowerCase().startsWith('www.')) {
    problems.push(`${url} uses a www host; the canonical host has no www`);
  }
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    problems.push(`${url} has a trailing slash; public URLs are slashless`);
  }
  return problems;
}

function expectedPathShape(page: PublicPage, language: string, path: string): string[] {
  const problems: string[] = [];
  if (!path.startsWith('/')) {
    problems.push(`${page.id}/${language}: path "${path}" must start with "/"`);
  }
  if (path !== '/' && path.endsWith('/')) {
    problems.push(`${page.id}/${language}: path "${path}" must not end with "/"`);
  }
  const prefix = `/${language}`;
  if (language === DEFAULT_SEO_LANGUAGE) {
    if (SEO_LANGUAGES.some((other) => other !== language && (path === `/${other}` || path.startsWith(`/${other}/`)))) {
      problems.push(`${page.id}/${language}: default-language path "${path}" must not carry a language prefix`);
    }
  } else if (path !== prefix && !path.startsWith(`${prefix}/`)) {
    problems.push(`${page.id}/${language}: path "${path}" must live under "${prefix}"`);
  }
  if (
    NON_INDEXABLE_PATH_PREFIXES.some((blocked) => path === blocked || path.startsWith(`${blocked}/`))
  ) {
    problems.push(`${page.id}/${language}: path "${path}" falls under a non-indexable prefix`);
  }
  return problems;
}

/**
 * Validate the registry itself: every page has a well-formed, unique path and
 * resolvable title/description in every language.
 */
export function validatePublicPageRegistry(pages: readonly PublicPage[] = PUBLIC_PAGES): string[] {
  const problems: string[] = [];
  const seenPaths = new Map<string, string>();
  const seenIds = new Set<string>();

  for (const page of pages) {
    if (seenIds.has(page.id)) {
      problems.push(`duplicate public page id "${page.id}"`);
    }
    seenIds.add(page.id);

    for (const language of SEO_LANGUAGES) {
      const path = page.paths[language];
      if (!path) {
        problems.push(`${page.id}: missing "${language}" path`);
        continue;
      }
      problems.push(...expectedPathShape(page, language, path));
      const owner = seenPaths.get(path);
      if (owner) {
        problems.push(`${page.id}/${language}: path "${path}" is already used by ${owner}`);
      }
      seenPaths.set(path, `${page.id}/${language}`);
      try {
        resolvePublicPageMeta(page, language);
      } catch (error) {
        problems.push(`${page.id}/${language}: ${(error as Error).message}`);
      }
    }
  }

  // No app-only route may get an /en/ twin that is accidentally indexable.
  for (const prefix of NON_INDEXABLE_PATH_PREFIXES) {
    for (const language of SEO_LANGUAGES) {
      if (language === DEFAULT_SEO_LANGUAGE) {
        continue;
      }
      if (seenPaths.has(`/${language}${prefix}`)) {
        problems.push(`/${language}${prefix} is registered as public but ${prefix} is app-only`);
      }
    }
  }
  return problems;
}

/**
 * Check that hreflang annotations are reciprocal: every page lists itself and
 * `x-default`, and every alternate it points to points back with the
 * identical set. `annotations` maps each page URL to its alternates.
 */
export function validateHreflangReciprocity(
  annotations: ReadonlyMap<string, readonly HreflangAlternate[]>,
): string[] {
  const problems: string[] = [];
  const serialize = (alternates: readonly HreflangAlternate[]): string =>
    alternates
      .map((alternate) => `${alternate.hreflang}=${alternate.href}`)
      .sort()
      .join('|');

  for (const [url, alternates] of annotations) {
    if (!alternates.some((alternate) => alternate.href === url && alternate.hreflang !== 'x-default')) {
      problems.push(`${url} does not list itself as an hreflang alternate`);
    }
    if (!alternates.some((alternate) => alternate.hreflang === 'x-default')) {
      problems.push(`${url} has no x-default hreflang alternate`);
    }
    for (const language of SEO_LANGUAGES) {
      if (!alternates.some((alternate) => alternate.hreflang === language)) {
        problems.push(`${url} has no "${language}" hreflang alternate`);
      }
    }
    for (const alternate of alternates) {
      const target = annotations.get(alternate.href);
      if (!target) {
        problems.push(`${url} points to ${alternate.href} (${alternate.hreflang}), which is not annotated`);
        continue;
      }
      if (serialize(target) !== serialize(alternates)) {
        problems.push(`${url} and ${alternate.href} do not carry the same hreflang set`);
      }
    }
    for (const alternate of alternates) {
      problems.push(...checkCanonicalUrlShape(alternate.href));
    }
  }
  return problems;
}

interface SitemapEntry {
  loc: string;
  alternates: HreflangAlternate[];
}

function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1]?.trim() ?? '';
    const alternates = [...block.matchAll(/<xhtml:link\b[^>]*>/g)].map(([tag]) => ({
      hreflang: /hreflang="([^"]+)"/.exec(tag)?.[1] ?? '',
      href: /href="([^"]+)"/.exec(tag)?.[1] ?? '',
    }));
    entries.push({ loc, alternates });
  }
  return entries;
}

/**
 * Validate an emitted sitemap.xml against the registry: every language
 * version of every page is listed, no URL has a trailing slash or a www host,
 * and the xhtml:link alternates are reciprocal.
 */
export function validateSitemapXml(
  xml: string,
  siteUrl: string,
  variants: readonly PublicPageVariant[],
): string[] {
  const problems: string[] = [];
  const entries = parseSitemap(xml);
  const locs = new Set(entries.map((entry) => entry.loc));

  for (const variant of variants) {
    const expected = buildCanonicalUrl(siteUrl, variant.path);
    if (!locs.has(expected)) {
      problems.push(`sitemap is missing ${expected} (${variant.page.id}/${variant.language})`);
    }
  }
  const expectedLocs = new Set(variants.map((variant) => buildCanonicalUrl(siteUrl, variant.path)));
  for (const entry of entries) {
    problems.push(...checkCanonicalUrlShape(entry.loc));
    if (!expectedLocs.has(entry.loc)) {
      problems.push(`sitemap lists ${entry.loc}, which is not a registered public page`);
    }
  }
  problems.push(
    ...validateHreflangReciprocity(new Map(entries.map((entry) => [entry.loc, entry.alternates]))),
  );
  return problems;
}

/**
 * Validate the `<head>` of one prerendered page: `<html lang>`, a single
 * self-referencing canonical equal to the URL the file is served at,
 * matching `og:url`/`og:locale`, and the registry's hreflang set.
 */
export function validatePrerenderedHead(
  document: Document,
  variant: PublicPageVariant,
  siteUrl: string,
): string[] {
  const problems: string[] = [];
  const label = variant.path;
  const expectedCanonical = buildCanonicalUrl(siteUrl, variant.path);

  const lang = document.documentElement.getAttribute('lang');
  if (lang !== variant.language) {
    problems.push(`${label}: <html lang="${lang}"> should be "${variant.language}"`);
  }

  const canonicals = [...document.querySelectorAll('link[rel="canonical"]')];
  if (canonicals.length !== 1) {
    problems.push(`${label}: expected exactly one canonical link, found ${canonicals.length}`);
  }
  const canonical = canonicals[0]?.getAttribute('href') ?? '';
  if (canonical !== expectedCanonical) {
    problems.push(`${label}: canonical "${canonical}" should be the served URL "${expectedCanonical}"`);
  }
  problems.push(...checkCanonicalUrlShape(canonical).map((problem) => `${label}: ${problem}`));

  const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
  if (ogUrl !== expectedCanonical) {
    problems.push(`${label}: og:url "${ogUrl}" should be "${expectedCanonical}"`);
  }
  const ogLocale = document.querySelector('meta[property="og:locale"]')?.getAttribute('content');
  if (ogLocale !== OG_LOCALES[variant.language]) {
    problems.push(`${label}: og:locale "${ogLocale}" should be "${OG_LOCALES[variant.language]}"`);
  }

  const actual = readHreflangAlternates(document)
    .map((alternate) => `${alternate.hreflang}=${alternate.href}`)
    .sort();
  const expected = buildHreflangAlternates(siteUrl, variant.page)
    .map((alternate) => `${alternate.hreflang}=${alternate.href}`)
    .sort();
  if (actual.join('|') !== expected.join('|')) {
    problems.push(`${label}: hreflang alternates [${actual.join(', ')}] should be [${expected.join(', ')}]`);
  }

  const meta = resolvePublicPageMeta(variant.page, variant.language);
  if (document.title !== meta.title) {
    problems.push(`${label}: <title> "${document.title}" should be "${meta.title}"`);
  }
  return problems;
}

/** Read the hreflang alternates declared in a document's `<head>`. */
export function readHreflangAlternates(document: Document): HreflangAlternate[] {
  return [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((element) => ({
    hreflang: element.getAttribute('hreflang') ?? '',
    href: element.getAttribute('href') ?? '',
  }));
}

/** Throw a single error listing every problem, so the build log shows all of them at once. */
export function assertNoSeoProblems(context: string, problems: readonly string[]): void {
  if (problems.length > 0) {
    throw new Error(`SEO guard failed (${context}):\n  - ${problems.join('\n  - ')}`);
  }
}
