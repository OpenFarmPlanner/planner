import { describe, it, expect } from 'vitest';
import {
  buildHeadTags,
  buildRobotsTxt,
  buildSitemapXml,
} from '../seoAssets';
import {
  NON_INDEXABLE_PATH_PREFIXES,
  PUBLIC_INDEXABLE_ROUTES,
} from '../seoConfig';

const SITE = 'https://openfarmplanner.org';

describe('buildRobotsTxt (indexable production)', () => {
  const robots = buildRobotsTxt({ siteUrl: SITE, indexable: true });

  it('does not block the whole site', () => {
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(robots).toMatch(/^Allow:\s*\/$/m);
  });

  it('disallows every private prefix', () => {
    for (const prefix of NON_INDEXABLE_PATH_PREFIXES) {
      expect(robots).toContain(`Disallow: ${prefix}`);
    }
  });

  it('advertises the sitemap with the canonical domain', () => {
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});

describe('buildRobotsTxt (non-indexable environment)', () => {
  const robots = buildRobotsTxt({ siteUrl: SITE, indexable: false });

  it('blocks the whole site', () => {
    expect(robots).toMatch(/^Disallow:\s*\/$/m);
    expect(robots).toContain('User-agent: *');
  });

  it('does not advertise a sitemap', () => {
    expect(robots).not.toContain('Sitemap:');
  });
});

describe('buildSitemapXml', () => {
  const sitemap = buildSitemapXml({ siteUrl: SITE, lastmod: '2026-01-01' });

  it('is a valid urlset document', () => {
    expect(sitemap).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(sitemap).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(sitemap).toContain('</urlset>');
  });

  it('contains exactly the public canonical routes', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      `${SITE}/`,
      `${SITE}/ueber`,
      `${SITE}/impressum`,
      `${SITE}/datenschutz`,
      `${SITE}/nutzungsbedingungen`,
    ]);
    expect(locs).toHaveLength(PUBLIC_INDEXABLE_ROUTES.length);
  });

  it('never lists private or auth routes', () => {
    for (const prefix of NON_INDEXABLE_PATH_PREFIXES) {
      expect(sitemap).not.toContain(`<loc>${SITE}${prefix}`);
    }
  });

  it('uses the provided lastmod and well-formed priorities', () => {
    expect(sitemap).toContain('<lastmod>2026-01-01</lastmod>');
    expect(sitemap).toMatch(/<priority>1\.0<\/priority>/);
  });
});

describe('buildHeadTags', () => {
  it('emits a canonical using the production domain and index directive', () => {
    const tags = buildHeadTags({ siteUrl: SITE, indexable: true }).join('\n');
    expect(tags).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(tags).toContain('<meta name="robots" content="index, follow" />');
    expect(tags).not.toContain('noindex');
  });

  it('emits Open Graph and Twitter preview tags', () => {
    const tags = buildHeadTags({ siteUrl: SITE, indexable: true }).join('\n');
    expect(tags).toContain('property="og:title"');
    expect(tags).toContain('property="og:url"');
    expect(tags).toContain(`property="og:image" content="${SITE}/landing/hero-field.webp"`);
    expect(tags).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('emits a noindex directive for non-indexable deployments', () => {
    const tags = buildHeadTags({ siteUrl: SITE, indexable: false }).join('\n');
    expect(tags).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('escapes HTML-significant characters in text values', () => {
    const tags = buildHeadTags({
      siteUrl: SITE,
      indexable: true,
      description: 'A & B "quoted" <tag>',
    }).join('\n');
    expect(tags).toContain('&amp;');
    expect(tags).toContain('&quot;');
    expect(tags).not.toContain('"quoted"');
  });
});
