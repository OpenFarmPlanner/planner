/**
 * Build-time prerendering for OpenFarmPlanner's public, static pages.
 *
 * OpenFarmPlanner stays a plain client-rendered React SPA — this script does
 * not introduce SSR or a Node runtime in production. It runs once, after
 * `vite build` (wired up as the `postbuild` npm script), as a small
 * standalone Node step:
 *
 *   1. serve the just-built `dist/` with Vite's own `preview()` server
 *      (same static assets production will serve, no dev-only behavior);
 *   2. use Playwright (already a devDependency for this project's e2e tests)
 *      to load every language version of each `PUBLIC_PAGES` entry
 *      (`PUBLIC_PAGE_VARIANTS`) in a real browser and
 *      capture the fully client-rendered DOM — no backend is required, since
 *      none of these pages fetch data to render their initial content;
 *   3. normalize the `<head>` (title, canonical, robots, OG, Twitter tags) to
 *      the route-specific values from `seoConfig.ts`/`seoAssets.ts` (via
 *      `prerenderSeo.ts`) — the same source of truth `RouteSeo` uses at
 *      runtime and `seoPlugin` uses for the base `index.html` — so
 *      build-time and runtime never disagree;
 *   4. run the SEO guard over all captured heads (canonical = served URL,
 *      reciprocal hreflang, `<html lang>`), then write the result as a flat
 *      file per URL (`dist/index.html`, `dist/ueber.html`,
 *      `dist/en/about.html`, ...), so a static file server can serve each
 *      slashless public URL's actual content directly with 200 instead of
 *      falling back to the empty SPA shell or redirecting to a `/` variant.
 *
 * Every other route (the authenticated `/app/*` shell, login/register/reset,
 * invitations) is untouched: only `dist/index.html` and the per-URL
 * files listed above are written. The browser then boots the same SPA bundle
 * as before (`createRoot(...).render(...)`, no hydration) and takes over
 * normal client-side routing/i18n immediately — there is nothing route- or
 * language-specific baked into the bundle itself, just the initial markup.
 *
 * `prerenderSeo.ts` (the actual SEO logic) is loaded through Vite's SSR
 * module runner rather than imported directly, because it in turn imports
 * this project's `src/seo/*` modules with TypeScript file extensions —
 * something Vite's resolver handles consistently with the rest of the build.
 *
 * Before any route is prerendered, the pristine (un-prerendered) `index.html`
 * is copied to `app-shell.html`. Production's reverse proxy uses SPA-fallback
 * rewriting to serve a single file for any URL that isn't a real file/dir —
 * that file must stay the empty SPA shell, never the prerendered landing page
 * that ends up at `index.html`. Otherwise, reloading an authenticated route
 * (e.g. `/app/dashboard`) serves the landing page's baked-in markup for one
 * frame before the SPA bundle boots and takes over, which reads as a
 * login/landing "flash" to the user.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createServer, preview } from 'vite';
import type { PublicPageVariant } from './prerenderSeo.ts';

interface PrerenderSeoModule {
  PUBLIC_PAGE_VARIANTS: readonly PublicPageVariant[];
  OG_LOCALES: Readonly<Record<string, string>>;
  applyHeadTags: (html: string, variant: PublicPageVariant, env: NodeJS.ProcessEnv) => string;
  assertNoLoopbackUrls: (html: string, routePath: string) => void;
  assertPrerenderedSeo: (
    pages: readonly { variant: PublicPageVariant; html: string }[],
    env: NodeJS.ProcessEnv,
  ) => void;
  outputFileFor: (routePath: string) => string;
}

interface PrerenderedPage {
  variant: PublicPageVariant;
  outputPath: string;
  html: string;
}

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Mirrors `normalizeBasePath` in vite.config.ts — kept in sync deliberately
 * rather than imported, since vite.config.ts is not a module other code
 * should depend on. */
function normalizeBasePath(input?: string): string {
  const value = input && input.trim().length > 0 ? input.trim() : '/';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

const outDir = process.env.PRERENDER_OUT_DIR?.trim() || 'dist';
const base = normalizeBasePath(process.env.VITE_BASE_PATH);

async function loadSeoHelpers(): Promise<PrerenderSeoModule> {
  const devServer = await createServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'warn',
    // We only need `ssrLoadModule` for one small, React-free module below —
    // suppress Vite's default client dependency-optimizer scan (which
    // crawls from index.html/main.tsx) since nothing here ever serves the
    // app itself, and the scan otherwise races the server close() below.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await devServer.ssrLoadModule('/build/prerenderSeo.ts') as unknown as PrerenderSeoModule;
  } finally {
    await devServer.close();
  }
}

async function serializeCssInJsRules(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const styleElement of document.querySelectorAll<HTMLStyleElement>('style[data-emotion]')) {
      if (styleElement.textContent?.trim()) {
        continue;
      }

      const sheet = styleElement.sheet;
      if (!sheet) {
        continue;
      }

      try {
        styleElement.textContent = Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n');
      } catch {
        // Ignore inaccessible sheets. Emotion/MUI inserts same-document style
        // sheets, so this should not happen for the styles we need.
      }
    }
  });
}

async function main(): Promise<void> {
  const distDir = path.resolve(rootDir, outDir);
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    throw new Error(`prerender: no build output at ${indexHtmlPath} — run "vite build" first.`);
  }

  const appShellPath = path.join(distDir, 'app-shell.html');
  await copyFile(indexHtmlPath, appShellPath);
  console.log(`prerender: index.html -> ${path.relative(distDir, appShellPath)} (SPA fallback shell)`);

  const {
    PUBLIC_PAGE_VARIANTS,
    OG_LOCALES,
    applyHeadTags,
    assertNoLoopbackUrls,
    assertPrerenderedSeo,
    outputFileFor,
  } = await loadSeoHelpers();

  const server = await preview({
    root: rootDir,
    base,
    build: { outDir },
    preview: { port: 0, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  const localUrl = server.resolvedUrls?.local[0];
  if (!localUrl) {
    await server.close();
    throw new Error('prerender: preview server did not resolve a local URL.');
  }

  try {
    // Reuses the same "chrome" channel binary the e2e workflow already
    // installs (playwright.config.ts's `chromium` project pins the same
    // channel) instead of the default bundled Chromium/headless-shell,
    // which is a separate download CI never installs.
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const prerenderedPages: PrerenderedPage[] = [];
      for (const variant of PUBLIC_PAGE_VARIANTS) {
        // The page language comes from the URL alone (see
        // src/i18n/routeLanguage.ts); a fresh context per page keeps any
        // stored language preference from leaking between captures, and the
        // matching locale keeps Intl formatting consistent with the page.
        const context = await browser.newContext({ locale: OG_LOCALES[variant.language].replace('_', '-') });
        try {
          const page = await context.newPage();
          const targetUrl = new URL(variant.path.replace(/^\//, ''), localUrl).toString();
          await page.goto(targetUrl, { waitUntil: 'networkidle' });
          await page.waitForSelector(`html[lang="${variant.language}"] #root h1`, { timeout: 10_000 });

          await serializeCssInJsRules(page);
          const html = await page.content();
          const finalHtml = applyHeadTags(html, variant, process.env);
          assertNoLoopbackUrls(finalHtml, variant.path);

          prerenderedPages.push({
            variant,
            outputPath: path.join(distDir, outputFileFor(variant.path)),
            html: finalHtml,
          });
        } finally {
          await context.close();
        }
      }

      assertPrerenderedSeo(prerenderedPages, process.env);

      for (const prerenderedPage of prerenderedPages) {
        const outputPath = prerenderedPage.outputPath;
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, prerenderedPage.html, 'utf-8');
        console.log(`prerender: ${prerenderedPage.variant.path} -> ${path.relative(distDir, outputPath)}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  // The Vite preview server keeps its listening socket open, which would
  // otherwise keep the process (and CI, up to its job timeout) alive even
  // after this handler runs — force an exit once the failure is reported.
  process.exitCode = 1;
  process.exit(1);
});
