import { describe, expect, it } from 'vitest';

import { buildSitemapXml } from '../seoAssets';
import { PUBLIC_PAGES, PUBLIC_PAGE_VARIANTS, type PublicPage } from '../seoConfig';
import {
  checkCanonicalUrlShape,
  validateHreflangReciprocity,
  validatePublicPageRegistry,
  validateSitemapXml,
} from '../seoGuard';

import appSource from '../../App.tsx?raw';

const SITE = 'https://openfarmplanner.org';
const PUBLIC_PAGE_MODULES = import.meta.glob('../../pages/public/*Page.tsx');

/**
 * Public, non-app page components that are deliberately not in the SEO
 * registry: the demo-start page is shareable but noindex.
 */
const UNREGISTERED_PUBLIC_PAGE_COMPONENTS = new Set(['DemoPage']);

describe('validatePublicPageRegistry', () => {
  it('accepts the real registry', () => {
    expect(validatePublicPageRegistry()).toEqual([]);
  });

  it('rejects a page without an English counterpart', () => {
    const broken = [
      { ...PUBLIC_PAGES[1], paths: { de: '/ueber' } } as unknown as PublicPage,
    ];
    expect(validatePublicPageRegistry(broken)).toContain('about: missing "en" path');
  });

  it('rejects trailing slashes, unprefixed English paths and missing translations', () => {
    const broken: PublicPage[] = [
      {
        ...PUBLIC_PAGES[1],
        paths: { de: '/ueber/', en: '/about' },
        titleKey: 'seo.titles.doesNotExist',
      },
    ];
    const problems = validatePublicPageRegistry(broken).join('\n');
    expect(problems).toMatch(/"\/ueber\/" must not end with "\/"/);
    expect(problems).toMatch(/"\/about" must live under "\/en"/);
    expect(problems).toMatch(/Missing "de" translation for home:seo.titles.doesNotExist/);
  });

  it('rejects a public page under an app-only prefix', () => {
    const broken: PublicPage[] = [{ ...PUBLIC_PAGES[1], paths: { de: '/login', en: '/en/login' } }];
    expect(validatePublicPageRegistry(broken).join('\n')).toMatch(/non-indexable prefix/);
  });
});

describe('validateSitemapXml', () => {
  it('accepts the generated sitemap', () => {
    const xml = buildSitemapXml({ siteUrl: SITE, lastmod: '2026-01-01' });
    expect(validateSitemapXml(xml, SITE, PUBLIC_PAGE_VARIANTS)).toEqual([]);
  });

  it('flags a missing page, a trailing slash and a www host', () => {
    const xml = buildSitemapXml({ siteUrl: SITE, lastmod: '2026-01-01' })
      .replace(`<loc>${SITE}/en/terms</loc>`, `<loc>${SITE}/en/terms/</loc>`)
      .replace(`<loc>${SITE}/impressum</loc>`, '<loc>https://www.openfarmplanner.org/impressum</loc>');
    const problems = validateSitemapXml(xml, SITE, PUBLIC_PAGE_VARIANTS).join('\n');
    expect(problems).toMatch(/missing https:\/\/openfarmplanner.org\/en\/terms/);
    expect(problems).toMatch(/trailing slash/);
    expect(problems).toMatch(/www host/);
  });
});

describe('validateHreflangReciprocity', () => {
  it('flags alternates that do not point back', () => {
    const annotations = new Map([
      [
        `${SITE}/ueber`,
        [
          { hreflang: 'de', href: `${SITE}/ueber` },
          { hreflang: 'en', href: `${SITE}/en/about` },
          { hreflang: 'x-default', href: `${SITE}/ueber` },
        ],
      ],
      [
        `${SITE}/en/about`,
        [
          { hreflang: 'en', href: `${SITE}/en/about` },
          { hreflang: 'x-default', href: `${SITE}/ueber` },
        ],
      ],
    ]);
    const problems = validateHreflangReciprocity(annotations).join('\n');
    expect(problems).toMatch(/do not carry the same hreflang set/);
    expect(problems).toMatch(/en\/about has no "de" hreflang alternate/);
  });
});

describe('checkCanonicalUrlShape', () => {
  it('allows the root slash only', () => {
    expect(checkCanonicalUrlShape(`${SITE}/`)).toEqual([]);
    expect(checkCanonicalUrlShape(`${SITE}/ueber`)).toEqual([]);
    expect(checkCanonicalUrlShape(`${SITE}/ueber/`)).toHaveLength(1);
  });
});

describe('public routes outside the registry', () => {
  it('routes every public page component through the registry', () => {
    const elementsBlock = /const PUBLIC_PAGE_ELEMENTS[\s\S]*?\n};/.exec(appSource)?.[0] ?? '';
    const pageComponents = Object.keys(PUBLIC_PAGE_MODULES)
      .map((file) => /([A-Z]\w*Page)\.tsx$/.exec(file)?.[1])
      .filter((name): name is string => Boolean(name))
      .filter((name) => !UNREGISTERED_PUBLIC_PAGE_COMPONENTS.has(name));

    expect(pageComponents.length).toBeGreaterThan(0);
    for (const component of pageComponents) {
      expect(elementsBlock, `${component} must be registered in PUBLIC_PAGES and PUBLIC_PAGE_ELEMENTS`).toContain(
        `<${component} />`,
      );
    }
    expect(PUBLIC_PAGES.length).toBe(pageComponents.length);
  });

  it('never hardcodes a public page path as a router entry', () => {
    for (const variant of PUBLIC_PAGE_VARIANTS) {
      if (variant.path === '/') {
        continue;
      }
      expect(appSource).not.toContain(`path: '${variant.path.slice(1)}'`);
    }
  });
});
