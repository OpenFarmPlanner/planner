import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_URL,
  PUBLIC_PAGE_VARIANTS,
  PUBLIC_PAGES,
  SEO_LANGUAGES,
  buildCanonicalUrl,
  buildHreflangAlternates,
  findPublicPageVariant,
  publicPagePath,
  isPathIndexable,
  normalizePathname,
  resolveIndexable,
  resolveSiteUrl,
} from '../seoConfig';

describe('resolveSiteUrl', () => {
  it('defaults to the production domain when unset', () => {
    expect(resolveSiteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl({ VITE_PUBLIC_SITE_URL: '' })).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl({ VITE_PUBLIC_SITE_URL: '   ' })).toBe(DEFAULT_SITE_URL);
  });

  it('strips trailing slashes and any path', () => {
    expect(resolveSiteUrl({ VITE_PUBLIC_SITE_URL: 'https://example.org/' })).toBe(
      'https://example.org',
    );
    expect(
      resolveSiteUrl({ VITE_PUBLIC_SITE_URL: 'https://example.org/app/' }),
    ).toBe('https://example.org');
  });

  it('keeps a non-standard port', () => {
    expect(
      resolveSiteUrl({ VITE_PUBLIC_SITE_URL: 'http://localhost:5173' }),
    ).toBe('http://localhost:5173');
  });

  it('falls back to the default for invalid or non-http(s) input', () => {
    expect(resolveSiteUrl({ VITE_PUBLIC_SITE_URL: 'not a url' })).toBe(
      DEFAULT_SITE_URL,
    );
    expect(
      resolveSiteUrl({ VITE_PUBLIC_SITE_URL: 'ftp://example.org' }),
    ).toBe(DEFAULT_SITE_URL);
  });
});

describe('resolveIndexable', () => {
  it('defaults to indexable', () => {
    expect(resolveIndexable({})).toBe(true);
    expect(resolveIndexable({ VITE_SEO_INDEXABLE: '' })).toBe(true);
    expect(resolveIndexable({ VITE_SEO_INDEXABLE: 'true' })).toBe(true);
  });

  it('blocks indexing for explicit falsey values', () => {
    for (const value of ['false', '0', 'no', 'off', 'FALSE', 'Off']) {
      expect(resolveIndexable({ VITE_SEO_INDEXABLE: value })).toBe(false);
    }
  });
});

describe('normalizePathname', () => {
  it('keeps the root path as "/"', () => {
    expect(normalizePathname('/')).toBe('/');
  });

  it('adds a leading slash and drops trailing slashes and query/hash', () => {
    expect(normalizePathname('impressum')).toBe('/impressum');
    expect(normalizePathname('/impressum/')).toBe('/impressum');
    expect(normalizePathname('/impressum?ref=x')).toBe('/impressum');
    expect(normalizePathname('/impressum#top')).toBe('/impressum');
  });
});

describe('isPathIndexable', () => {
  it('marks known public routes as indexable', () => {
    for (const variant of PUBLIC_PAGE_VARIANTS) {
      expect(isPathIndexable(variant.path)).toBe(true);
    }
  });

  it('never indexes private app or auth routes', () => {
    for (const path of [
      '/app',
      '/app/dashboard',
      '/app/crops',
      '/demo',
      '/login',
      '/register',
      '/activate/abc/def',
      '/forgot-password',
      '/reset-password',
      '/confirm-email-change',
      '/invite/token',
      '/invitation',
    ]) {
      expect(isPathIndexable(path)).toBe(false);
    }
  });

  it('does not index unknown paths', () => {
    expect(isPathIndexable('/does-not-exist')).toBe(false);
  });

  it('blocks everything when the deployment is not indexable', () => {
    expect(isPathIndexable('/', false)).toBe(false);
    expect(isPathIndexable('/impressum', false)).toBe(false);
  });
});

describe('buildCanonicalUrl', () => {
  it('keeps a trailing slash only for the root', () => {
    expect(buildCanonicalUrl('https://example.org', '/')).toBe(
      'https://example.org/',
    );
    expect(buildCanonicalUrl('https://example.org', '/impressum')).toBe(
      'https://example.org/impressum',
    );
    expect(buildCanonicalUrl('https://example.org', '/impressum/')).toBe(
      'https://example.org/impressum',
    );
  });
});

describe('public page registry', () => {
  it('serves German at the root and English under /en with English slugs', () => {
    expect(publicPagePath('home', 'de')).toBe('/');
    expect(publicPagePath('home', 'en')).toBe('/en');
    expect(publicPagePath('about', 'de')).toBe('/ueber');
    expect(publicPagePath('about', 'en')).toBe('/en/about');
    expect(publicPagePath('imprint', 'en')).toBe('/en/legal-notice');
    expect(publicPagePath('privacy', 'en')).toBe('/en/privacy');
    expect(publicPagePath('terms', 'en')).toBe('/en/terms');
  });

  it('finds the variant for a path, tolerating a trailing slash', () => {
    expect(findPublicPageVariant('/ueber/')).toMatchObject({ language: 'de', path: '/ueber' });
    expect(findPublicPageVariant('/en/about')).toMatchObject({ language: 'en', path: '/en/about' });
    expect(findPublicPageVariant('/login')).toBeNull();
  });

  it('builds reciprocal hreflang alternates with x-default on German', () => {
    const variant = findPublicPageVariant('/en/about')!;
    expect(buildHreflangAlternates('https://example.org', variant.page)).toEqual([
      { hreflang: 'de', href: 'https://example.org/ueber' },
      { hreflang: 'en', href: 'https://example.org/en/about' },
      { hreflang: 'fr', href: 'https://example.org/fr/a-propos' },
      { hreflang: 'es', href: 'https://example.org/es/acerca-de' },
      { hreflang: 'x-default', href: 'https://example.org/ueber' },
    ]);
  });

  it('gives every language version of a page the same alternates', () => {
    for (const page of PUBLIC_PAGES) {
      const alternates = buildHreflangAlternates('https://example.org', page);
      for (const language of SEO_LANGUAGES) {
        const variant = findPublicPageVariant(page.paths[language])!;
        expect(variant.language).toBe(language);
        expect(buildHreflangAlternates('https://example.org', variant.page)).toEqual(alternates);
      }
    }
  });
});
