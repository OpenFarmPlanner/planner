import { describe, it, expect } from 'vitest';
import {
  buildHeadTags,
  buildRobotsTxt,
  buildSitemapXml,
  buildSoftwareApplicationJsonLd,
} from '../seoAssets';
import {
  NON_INDEXABLE_PATH_PREFIXES,
  PUBLIC_PAGE_VARIANTS,
  PUBLIC_PAGES,
  buildHreflangAlternates,
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
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    );
    expect(sitemap).toContain('</urlset>');
  });

  it('contains every public page in both languages, slashless', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      `${SITE}/`,
      `${SITE}/en`,
      `${SITE}/ueber`,
      `${SITE}/en/about`,
      `${SITE}/impressum`,
      `${SITE}/en/legal-notice`,
      `${SITE}/datenschutz`,
      `${SITE}/en/privacy`,
      `${SITE}/nutzungsbedingungen`,
      `${SITE}/en/terms`,
    ]);
    expect(locs).toHaveLength(PUBLIC_PAGE_VARIANTS.length);
  });

  it('lists de, en and x-default alternates on every url entry', () => {
    const blocks = sitemap.match(/<url>[\s\S]*?<\/url>/g) ?? [];
    expect(blocks).toHaveLength(PUBLIC_PAGE_VARIANTS.length);
    const about = blocks.find((block) => block.includes(`<loc>${SITE}/en/about</loc>`))!;
    expect(about).toContain(`<xhtml:link rel="alternate" hreflang="de" href="${SITE}/ueber" />`);
    expect(about).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${SITE}/en/about" />`);
    expect(about).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/ueber" />`);
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

  it('emits hreflang alternates and the og:locale of the page language', () => {
    const about = PUBLIC_PAGES.find((page) => page.id === 'about')!;
    const tags = buildHeadTags({
      siteUrl: SITE,
      indexable: true,
      path: '/en/about',
      language: 'en',
      alternates: buildHreflangAlternates(SITE, about),
    }).join('\n');
    expect(tags).toContain(`<link rel="canonical" href="${SITE}/en/about" />`);
    expect(tags).toContain(`<link rel="alternate" hreflang="de" href="${SITE}/ueber" />`);
    expect(tags).toContain(`<link rel="alternate" hreflang="en" href="${SITE}/en/about" />`);
    expect(tags).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE}/ueber" />`);
    expect(tags).toContain('<meta property="og:locale" content="en_US" />');
    expect(tags).toContain(`<meta property="og:url" content="${SITE}/en/about" />`);
  });

  it('defaults og:locale to German', () => {
    const tags = buildHeadTags({ siteUrl: SITE, indexable: true }).join('\n');
    expect(tags).toContain('<meta property="og:locale" content="de_DE" />');
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

describe('buildSoftwareApplicationJsonLd', () => {
  it('emits a valid SoftwareApplication JSON-LD script tag', () => {
    const tag = buildSoftwareApplicationJsonLd({ url: `${SITE}/`, description: 'Open-source crop planning.', language: 'de' });

    expect(tag).toMatch(/^<script type="application\/ld\+json">.*<\/script>$/);

    const json = JSON.parse(tag.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, ''));
    expect(json).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'OpenFarmPlanner',
      url: `${SITE}/`,
      description: 'Open-source crop planning.',
      inLanguage: 'de',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    });
  });

  it('escapes markup characters so a description cannot close the script tag', () => {
    const tag = buildSoftwareApplicationJsonLd({ url: `${SITE}/`, description: 'x</script><b>', language: 'de' });

    expect(tag.match(/<\/script>/g)).toHaveLength(1);
    const body = tag.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(body).description).toBe('x</script><b>');
  });
});
