import { describe, expect, it } from 'vitest';
import {
  applyHeadTags,
  assertNoLoopbackUrls,
  assertPrerenderedSeo,
  outputFileFor,
  PUBLIC_PAGE_VARIANTS,
} from './prerenderSeo.ts';
import { resolvePublicPageMeta } from '../src/seo/publicPageMeta.ts';

function variantAt(path: string) {
  const variant = PUBLIC_PAGE_VARIANTS.find((candidate) => candidate.path === path);
  if (!variant) {
    throw new Error(`no public page variant at ${path}`);
  }
  return variant;
}

/**
 * Simulates what Playwright's `page.content()` actually captures: the base
 * `index.html` (already carrying seoPlugin's landing-page canonical/robots/
 * description/OG tags) plus whatever `RouteSeo` patched in at runtime for
 * the current route (it only touches canonical + robots).
 */
function sampleCapturedHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="de"><head>',
    '  <meta charset="UTF-8">',
    '  <title>OpenFarmPlanner</title>',
    '  <meta name="description" content="Landing page default description">',
    '  <link rel="canonical" href="https://openfarmplanner.org/impressum">',
    '  <meta name="robots" content="index, follow">',
    '  <meta property="og:title" content="OpenFarmPlanner">',
    '  <meta property="og:description" content="Landing page default description">',
    '  <meta name="twitter:title" content="OpenFarmPlanner">',
    '</head><body><div id="root"><h1>Impressum</h1></div></body></html>',
  ].join('\n');
}

describe('applyHeadTags', () => {
  const impressumRoute = variantAt('/impressum');
  const impressumMeta = resolvePublicPageMeta(impressumRoute.page, 'de');
  const env = { VITE_PUBLIC_SITE_URL: 'https://openfarmplanner.org' };

  it('sets the route-specific title, canonical and description exactly once', () => {
    const html = applyHeadTags(sampleCapturedHtml(), impressumRoute, env);

    expect(html).toContain('<title>Impressum – OpenFarmPlanner</title>');
    expect(html.match(/<title>/g)).toHaveLength(1);

    expect(html).toContain('href="https://openfarmplanner.org/impressum"');
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);

    expect(html).toContain(impressumMeta.description);
    expect(html.match(/name="description"/g)).toHaveLength(1);
  });

  it('removes the stale runtime/build-time OG and Twitter tags before adding the route-specific set', () => {
    const html = applyHeadTags(sampleCapturedHtml(), impressumRoute, env);

    expect(html).not.toContain('content="Landing page default description"');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/name="twitter:title"/g)).toHaveLength(1);
    expect(html).toContain(`content="${impressumMeta.title}"`);
  });

  it('keeps robots as index,follow for a public route on an indexable deployment', () => {
    const html = applyHeadTags(sampleCapturedHtml(), impressumRoute, env);

    expect(html.match(/name="robots"/g)).toHaveLength(1);
    expect(html).toContain('content="index, follow"');
  });

  it('emits noindex when the deployment is not indexable (e.g. staging)', () => {
    const html = applyHeadTags(sampleCapturedHtml(), impressumRoute, {
      ...env,
      VITE_SEO_INDEXABLE: 'false',
    });

    expect(html).toContain('content="noindex, nofollow"');
  });

  it('sets the landing page own title/description rather than falling back to the generic default', () => {
    const homeRoute = variantAt('/');
    const homeMeta = resolvePublicPageMeta(homeRoute.page, 'de');
    const html = applyHeadTags(sampleCapturedHtml(), homeRoute, env);

    expect(html).toContain(`<title>${homeMeta.title}</title>`);
    expect(html).toContain(homeMeta.description);
    expect(html).toContain('href="https://openfarmplanner.org/"');
  });

  it('renders the English version with English meta, lang, og:locale and reciprocal hreflang', () => {
    const aboutEn = variantAt('/en/about');
    const meta = resolvePublicPageMeta(aboutEn.page, 'en');
    const html = applyHeadTags(sampleCapturedHtml(), aboutEn, env);

    expect(html).toContain(
      '<html lang="en" data-ofp-page-language="en" data-ofp-page-path="/en/about" '
        + 'data-ofp-page-alternates="{&quot;de&quot;:&quot;/ueber&quot;,&quot;en&quot;:&quot;/en/about&quot;}">',
    );
    expect(html).toContain(`<title>${meta.title}</title>`);
    expect(meta.title).toBe('About OpenFarmPlanner');
    expect(html).toContain('<link rel="canonical" href="https://openfarmplanner.org/en/about">');
    expect(html).toContain('<meta property="og:locale" content="en_US">');
    expect(html).toContain('<meta property="og:url" content="https://openfarmplanner.org/en/about">');
    expect(html).toContain('<link rel="alternate" hreflang="de" href="https://openfarmplanner.org/ueber">');
    expect(html).toContain('<link rel="alternate" hreflang="en" href="https://openfarmplanner.org/en/about">');
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://openfarmplanner.org/ueber">');
  });

  it('adds SoftwareApplication JSON-LD structured data on the landing page only', () => {
    const homeRoute = variantAt('/');
    const html = applyHeadTags(sampleCapturedHtml(), homeRoute, env);

    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"SoftwareApplication"');
    expect(html).toContain(resolvePublicPageMeta(homeRoute.page, 'de').description);

    const impressumHtml = applyHeadTags(sampleCapturedHtml(), impressumRoute, env);
    expect(impressumHtml).not.toContain('application/ld+json');
  });

  it('preloads the hero image with imagesrcset/imagesizes on the landing page only', () => {
    const homeRoute = variantAt('/');
    const html = applyHeadTags(sampleCapturedHtml(), homeRoute, env);

    expect(html).toContain('<link rel="preload" as="image" href="/landing/hero-field.webp"');
    expect(html).toContain('imagesrcset="/landing/hero-field-640.webp 640w, /landing/hero-field-960.webp 960w, /landing/hero-field-1280.webp 1280w, /landing/hero-field.webp 1920w"');
    expect(html).toContain('imagesizes="100vw"');
    expect(html).toContain('fetchpriority="high"');
  });

  it('does not preload the hero image on non-landing routes', () => {
    const html = applyHeadTags(sampleCapturedHtml(), impressumRoute, env);

    expect(html).not.toContain('rel="preload"');
  });

  it('removes local preview preload hints captured from Vite preview', () => {
    const html = applyHeadTags(
      [
        '<!doctype html>',
        '<html lang="de"><head>',
        '  <title>OpenFarmPlanner</title>',
        '  <link rel="modulepreload" href="/assets/react.js">',
        '  <link rel="modulepreload" href="http://127.0.0.1:44797/assets/HomePage.js">',
        '  <link rel="preload" href="http://localhost:44797/assets/HeroImage.js">',
        '  <link rel="prefetch" href="http://[::1]:44797/assets/useGuestDemoStart.js">',
        '  <link rel="stylesheet" href="http://127.0.0.1:44797/assets/index.css">',
        '</head><body><div id="root"><h1>OpenFarmPlanner</h1></div></body></html>',
      ].join('\n'),
      variantAt('/'),
      env,
    );

    expect(html).toContain('href="/assets/react.js"');
    expect(html).toContain('rel="stylesheet" href="http://127.0.0.1:44797/assets/index.css"');
    expect(html).not.toContain('rel="modulepreload" href="http://127.0.0.1:44797');
    expect(html).not.toContain('rel="preload" href="http://localhost:44797');
    expect(html).not.toContain('rel="prefetch" href="http://[::1]:44797');
  });
});

describe('assertNoLoopbackUrls', () => {
  it('allows production-local relative asset URLs', () => {
    expect(() => assertNoLoopbackUrls('<script src="/assets/index.js"></script>', '/')).not.toThrow();
  });

  it('fails when prerendered HTML still contains an absolute loopback URL', () => {
    expect(() => assertNoLoopbackUrls('<link href="http://127.0.0.1:44797/assets/index.css">', '/')).toThrow(
      /contains local preview URL/,
    );
  });
});

describe('outputFileFor', () => {
  it('writes flat files so slashless URLs are served without a directory redirect', () => {
    expect(outputFileFor('/')).toBe('index.html');
    expect(outputFileFor('/ueber')).toBe('ueber.html');
    expect(outputFileFor('/en')).toBe('en.html');
    expect(outputFileFor('/en/about')).toBe('en/about.html');
  });
});

describe('assertPrerenderedSeo', () => {
  const env = { VITE_PUBLIC_SITE_URL: 'https://openfarmplanner.org' };

  it('accepts the heads applyHeadTags produces for every public page', () => {
    const pages = PUBLIC_PAGE_VARIANTS.map((variant) => ({
      variant,
      html: applyHeadTags(sampleCapturedHtml(), variant, env),
    }));
    expect(() => assertPrerenderedSeo(pages, env)).not.toThrow();
  });

  it('fails when a prerendered canonical does not match the served URL', () => {
    const pages = PUBLIC_PAGE_VARIANTS.map((variant) => ({
      variant,
      html: applyHeadTags(sampleCapturedHtml(), variant, env),
    }));
    pages[2] = {
      ...pages[2],
      html: pages[2].html.replace(
        'rel="canonical" href="https://openfarmplanner.org/ueber"',
        'rel="canonical" href="https://openfarmplanner.org/ueber/"',
      ),
    };
    expect(() => assertPrerenderedSeo(pages, env)).toThrow(/canonical/);
  });

  it('fails when a page is prerendered without its counterpart', () => {
    const pages = PUBLIC_PAGE_VARIANTS.filter((variant) => variant.path !== '/en/terms').map((variant) => ({
      variant,
      html: applyHeadTags(sampleCapturedHtml(), variant, env),
    }));
    expect(() => assertPrerenderedSeo(pages, env)).toThrow(/en\/terms/);
  });
});
