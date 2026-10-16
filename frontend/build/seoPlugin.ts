/**
 * Vite plugin wiring the SEO artifacts into the build and dev/preview servers.
 *
 * Responsibilities:
 *   - inject canonical / Open Graph / Twitter / robots <head> tags into
 *     index.html (build and dev), so crawlers get real metadata from the first
 *     HTML response of this otherwise client-rendered SPA;
 *   - emit /robots.txt and /sitemap.xml as build assets, after the SEO guard
 *     (`src/seo/seoGuard.ts`) validated the public page registry and sitemap;
 *   - serve /robots.txt and /sitemap.xml from the dev and preview servers so
 *     the behaviour can be verified locally with the same URLs as production.
 *
 * The canonical domain and route lists come from seoConfig.ts; nothing here
 * hardcodes the domain.
 */

import type { Plugin } from 'vite';
import {
  PUBLIC_PAGE_VARIANTS,
  resolveIndexable,
  resolveSiteUrl,
  type SeoEnv,
} from '../src/seo/seoConfig.ts';
import { buildHeadTags, buildRobotsTxt, buildSitemapXml } from '../src/seo/seoAssets.ts';
import {
  assertNoSeoProblems,
  validatePublicPageRegistry,
  validateSitemapXml,
} from '../src/seo/seoGuard.ts';

export function seoPlugin(env: SeoEnv = process.env as SeoEnv): Plugin {
  const siteUrl = resolveSiteUrl(env);
  const indexable = resolveIndexable(env);

  const robotsTxt = buildRobotsTxt({ siteUrl, indexable });
  const sitemapXml = buildSitemapXml({ siteUrl });
  // Fail the build (and the dev server start) instead of shipping a public
  // page Google cannot index consistently.
  assertNoSeoProblems('public page registry', validatePublicPageRegistry());
  assertNoSeoProblems('sitemap.xml', validateSitemapXml(sitemapXml, siteUrl, PUBLIC_PAGE_VARIANTS));
  const headTags = buildHeadTags({ siteUrl, indexable });

  return {
    name: 'openfarmplanner-seo',

    transformIndexHtml(html) {
      const injection = `${headTags.map((tag) => `    ${tag}`).join('\n')}\n  </head>`;
      return html.replace(/\s*<\/head>/, `\n${injection}`);
    },

    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: robotsTxt,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: sitemapXml,
      });
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/robots.txt') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(robotsTxt);
          return;
        }
        if (req.url === '/sitemap.xml') {
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.end(sitemapXml);
          return;
        }
        next();
      });
    },

    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/robots.txt') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(robotsTxt);
          return;
        }
        if (req.url === '/sitemap.xml') {
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.end(sitemapXml);
          return;
        }
        next();
      });
    },
  };
}
