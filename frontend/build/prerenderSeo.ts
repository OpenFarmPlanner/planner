/**
 * Pure logic shared between `build/prerender.ts` (the Node entry point) and
 * its unit tests: computing the final, route-specific `<head>` for a
 * prerendered page. Kept as its own module (rather than inlined in
 * prerender.ts) so it can be loaded through Vite's SSR module runner, which
 * resolves this project's TypeScript imports the same way `vite build` and
 * `vitest` do — the Node entry point itself is executed directly by Node
 * (via `--experimental-strip-types`), so keep its direct imports explicit.
 */

import { JSDOM } from 'jsdom';
import {
  OG_LOCALES,
  PUBLIC_PAGE_VARIANTS,
  buildCanonicalUrl,
  buildHreflangAlternates,
  resolveIndexable,
  resolveSiteUrl,
  type PublicPageVariant,
  type SeoEnv,
} from '../src/seo/seoConfig.ts';
import { buildHeadTags, buildSoftwareApplicationJsonLd } from '../src/seo/seoAssets.ts';
import { resolvePublicPageMeta } from '../src/seo/publicPageMeta.ts';
import {
  assertNoSeoProblems,
  readHreflangAlternates,
  validateHreflangReciprocity,
  validatePrerenderedHead,
} from '../src/seo/seoGuard.ts';

export { PUBLIC_PAGE_VARIANTS, OG_LOCALES };
export type { PublicPageVariant };

/**
 * Attributes on `<html>` that tell index.html's language preboot the page
 * language is fixed by its URL. The path lets the preboot ignore them when a
 * static server's SPA fallback hands this file out for another URL.
 */
export const PAGE_LANGUAGE_ATTRIBUTE = 'data-ofp-page-language';
export const PAGE_PATH_ATTRIBUTE = 'data-ofp-page-path';

/**
 * Global the preboot reads the page's language versions from, so it can send
 * a visitor to their language before first paint. Handed over as a script
 * value rather than a DOM attribute: the preboot navigates to it, and DOM
 * text must never flow into a navigation (CodeQL js/xss-through-dom).
 */
export const PAGE_ALTERNATES_GLOBAL = '__OFP_PAGE_ALTERNATES__';

function buildPageAlternatesScript(variant: PublicPageVariant): string {
  const json = JSON.stringify(variant.page.paths).replace(/</g, '\\u003c');
  return `window.${PAGE_ALTERNATES_GLOBAL} = ${json};`;
}

/**
 * File a page variant is written to, relative to the build output directory.
 *
 * Pages are written as flat `<path>.html` files (`ueber.html`,
 * `en/about.html`), never `<path>/index.html`: a directory makes Apache (and
 * every other static server) 301 the slashless URL to `<path>/`, which is
 * exactly the canonical/redirect conflict Search Console reported. Only the
 * German root stays `index.html`.
 */
export function outputFileFor(routePath: string): string {
  return routePath === '/' ? 'index.html' : `${routePath.replace(/^\//, '')}.html`;
}

function isLoopbackHttpUrl(value: string | null): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function removeLocalPreviewPreloads(document: Document): void {
  document.querySelectorAll('link[href]').forEach((element) => {
    const rel = (element.getAttribute('rel') ?? '').toLowerCase();
    if (!['modulepreload', 'preload', 'prefetch'].includes(rel)) {
      return;
    }
    if (isLoopbackHttpUrl(element.getAttribute('href'))) {
      element.remove();
    }
  });
}

export function assertNoLoopbackUrls(html: string, routePath: string): void {
  const matches = html.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(?::\d+)?[^\s"'<>)]*/g);
  if (matches?.length) {
    const uniqueMatches = [...new Set(matches)];
    throw new Error(
      `prerender: ${routePath} contains local preview URL(s): ${uniqueMatches.join(', ')}`
    );
  }
}

/**
 * Rewrite `<head>` in a captured, client-rendered document to the
 * route-specific canonical values. Strips whatever `seoPlugin` baked into
 * the base `index.html` and whatever `RouteSeo` already patched in at
 * runtime (it only touches canonical/robots) before re-adding the full,
 * consistent set for this route — this is what keeps build-time and runtime
 * SEO tags from ever duplicating or disagreeing.
 */
export function applyHeadTags(html: string, variant: PublicPageVariant, env: SeoEnv): string {
  const siteUrl = resolveSiteUrl(env);
  const indexable = resolveIndexable(env);
  const meta = resolvePublicPageMeta(variant.page, variant.language);

  const dom = new JSDOM(html);
  const { document } = dom.window;

  removeLocalPreviewPreloads(document);

  const root = document.documentElement;
  root.setAttribute('lang', variant.language);
  root.setAttribute(PAGE_LANGUAGE_ATTRIBUTE, variant.language);
  root.setAttribute(PAGE_PATH_ATTRIBUTE, variant.path);
  // Must run before the language preboot, the first script in <head>.
  const alternatesScript = document.createElement('script');
  alternatesScript.textContent = buildPageAlternatesScript(variant);
  document.head.insertBefore(alternatesScript, document.head.querySelector('script'));
  // Runtime-only state the language preboot put on the capturing browser's
  // document; index.html recomputes it on every real load.
  root.removeAttribute('data-initial-ui-language');
  root.classList.remove('ofp-hide-prerender');
  if (root.classList.length === 0) {
    root.removeAttribute('class');
  }

  document.title = meta.title;

  document
    .querySelectorAll(
      'link[rel="canonical"], link[rel="alternate"][hreflang], meta[name="robots"], meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]',
    )
    .forEach((element) => element.remove());

  const tags = buildHeadTags({
    siteUrl,
    indexable,
    title: meta.title,
    description: meta.description,
    path: variant.path,
    language: variant.language,
    alternates: buildHreflangAlternates(siteUrl, variant.page),
  });
  if (variant.page.id === 'home') {
    tags.push(buildHeroImagePreloadTag());
    tags.push(
      buildSoftwareApplicationJsonLd({
        url: buildCanonicalUrl(siteUrl, variant.path),
        description: meta.description,
        language: variant.language,
      }),
    );
  }
  for (const tagHtml of tags) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = tagHtml;
    const element = wrapper.firstElementChild;
    if (element) {
      document.head.appendChild(element);
    }
  }

  return dom.serialize();
}

/**
 * Run the SEO guard over the final prerendered documents: each head must be
 * self-consistent with the URL it is served at, and the hreflang annotations
 * must be reciprocal across all pages. Throws (failing the build) otherwise.
 */
export function assertPrerenderedSeo(
  pages: readonly { variant: PublicPageVariant; html: string }[],
  env: SeoEnv,
): void {
  const siteUrl = resolveSiteUrl(env);
  const problems: string[] = [];
  const annotations = new Map<string, ReturnType<typeof readHreflangAlternates>>();
  for (const { variant, html } of pages) {
    const { document } = new JSDOM(html).window;
    problems.push(...validatePrerenderedHead(document, variant, siteUrl));
    annotations.set(buildCanonicalUrl(siteUrl, variant.path), readHreflangAlternates(document));
  }
  problems.push(...validateHreflangReciprocity(annotations));
  assertNoSeoProblems('prerendered public pages', problems);
}

/**
 * High-priority preload for the landing page's LCP element, scoped to `/`
 * and its English counterpart only (never injected into `app-shell.html`, the SPA fallback for `/app/*`
 * and auth routes, since those never render the hero image). Values must
 * mirror HeroImage.tsx's `src`/`srcSet`/`sizes` exactly so the browser never
 * fetches the image twice — see docs/seo-and-indexing.md.
 */
function buildHeroImagePreloadTag(): string {
  const imagesrcset = [
    '/landing/hero-field-640.webp 640w',
    '/landing/hero-field-960.webp 960w',
    '/landing/hero-field-1280.webp 1280w',
    '/landing/hero-field.webp 1920w',
  ].join(', ');
  return (
    '<link rel="preload" as="image" href="/landing/hero-field.webp" ' +
    `imagesrcset="${imagesrcset}" imagesizes="100vw" fetchpriority="high" />`
  );
}
