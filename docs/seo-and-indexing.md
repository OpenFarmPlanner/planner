# SEO & Search-Engine Indexing

OpenFarmPlanner's frontend is a client-rendered React SPA (Vite) that is
deployed as static assets and served from the site root by the operations
stack (see `ops`). The Django backend is API-only and does
**not** serve the SPA or any SEO artifact. Everything below is therefore
produced by the **frontend build**.

## What is indexable

Every public page exists in German, English, French and Spanish. German is
the default language and lives at the root without a prefix; every other
language lives under its own prefix with slugs in that language:

| Page             | German (`x-default`)   | English            | French                      | Spanish           |
| ---------------- | ---------------------- | ------------------ | --------------------------- | ----------------- |
| Landing page     | `/`                    | `/en`              | `/fr`                       | `/es`             |
| About            | `/ueber`               | `/en/about`        | `/fr/a-propos`              | `/es/acerca-de`   |
| Imprint (legal)  | `/impressum`           | `/en/legal-notice` | `/fr/mentions-legales`      | `/es/aviso-legal` |
| Privacy (legal)  | `/datenschutz`         | `/en/privacy`      | `/fr/confidentialite`       | `/es/privacidad`  |
| Terms (legal)    | `/nutzungsbedingungen` | `/en/terms`        | `/fr/conditions-utilisation` | `/es/terminos`   |

Slugs are plain ASCII (no accents), lowercase, hyphen-separated.

Explicitly **not** indexable (disallowed in `robots.txt` and served with a
`noindex, nofollow` robots meta at runtime):

- `/app/*` — the authenticated application
- `/login`, `/register`, `/activate`, `/forgot-password`, `/reset-password`,
  `/confirm-email-change`
- `/demo` — shareable guest-demo entry page; direct links are supported, but
  the route is not intended for search indexing
- `/invite/*`, `/invitation`

None of these has an `/en/...`, `/fr/...` or `/es/...` twin — app and auth
routes are language-neutral and follow the user's language preference. If one
ever gets one, its prefixed path must be added to `NON_INDEXABLE_PATH_PREFIXES` too (the SEO guard rejects
registering it as public).

## The public page registry

[`frontend/src/seo/seoConfig.ts`](../frontend/src/seo/seoConfig.ts) is the
single source of truth. `SEO_LANGUAGES` lists the published languages in
hreflang order (`de`, `en`, `fr`, `es`); `PUBLIC_PAGES` lists every public
page with its path per language, sitemap `changefreq`/`priority`, and the `home`-namespace
i18n keys of its `<title>` and meta description (`seo.titles.*`,
`seo.descriptions.*` — the texts live in the locale bundles like every other
UI string and are resolved at build time by
[`publicPageMeta.ts`](../frontend/src/seo/publicPageMeta.ts)).
`PUBLIC_PAGE_VARIANTS` flattens it into one entry per served URL. Everything
else is derived from it, so no public path is listed anywhere else:

- the router entries (`buildPublicPageRoutes` in `App.tsx`, which only maps
  page ids to components);
- build-time prerendering, `sitemap.xml` and the prerendered `<head>`;
- canonical, hreflang, title and description at runtime (`RouteSeo`);
- the language switcher's counterpart links and every internal link to a
  public page (`usePublicPagePath`);
- the startup auth-probe skip list (`AuthContext`).

`NON_INDEXABLE_PATH_PREFIXES` in the same file drives the `robots.txt`
`Disallow` lines.

### URL, canonical and hreflang rules

- The canonical host is `https://openfarmplanner.org` (no `www`).
- Public URLs are **slashless** (`/ueber`, never `/ueber/`; only the root keeps
  its `/`). The slash variant 301-redirects to the slashless one, never the
  other way round, and the slashless URL is served directly with 200.
- Every public page has exactly one self-referencing canonical: the URL it is
  served at with 200 (`buildCanonicalUrl`).
- Every public page carries the same reciprocal hreflang set: `de`, `en`,
  `fr`, `es` and `x-default` (pointing at the German version) — in the prerendered `<head>`,
  at runtime, and as `xhtml:link` alternates on every sitemap `<url>`.
- **Every URL renders its own language** — `/ueber` is always German,
  `/en/about` always English, `/fr/a-propos` always French and
  `/es/acerca-de` always Spanish, prerendered that way and rendered that way by
  the SPA. There is no content swap on a URL.
- **Visitors land in their language, crawlers never get redirected.** On the
  first load of a public page, a visitor whose language differs from the
  page's is sent to the counterpart URL with `location.replace` (query and
  hash kept): their stored choice from the switcher if any, otherwise the
  browser language — German, French and Spanish browsers (any regional
  variant, e.g. `fr-CA`, `es-419`, `es-MX`) get their language, every other
  language gets English.
  The `index.html` preboot does this before first paint on prerendered pages
  (from the `data-ofp-page-alternates` attribute), and
  `src/i18n/publicPageLanguageRedirect.ts` is the fallback for the dev server
  and the SPA shell. User agents matching the crawler pattern (Googlebot,
  Bingbot, link previews, Lighthouse, …) are never redirected, otherwise
  Google would only ever see one language. Keep the two pattern copies in
  sync. There is no server-side `Accept-Language` or geolocation redirect.

### The SEO guard

[`frontend/src/seo/seoGuard.ts`](../frontend/src/seo/seoGuard.ts) fails the
build — and the unit tests in `src/seo/__tests__/seoGuard.test.ts` and
`build/prerenderSeo.test.ts` fail CI — when:

- a registry entry lacks a language, has a trailing slash, a non-German path
  outside its language prefix (`/en`, `/fr`, `/es`), a duplicate path, a path under an app-only prefix, or a
  missing title/description translation (`validatePublicPageRegistry`, run by
  `seoPlugin` on every build and dev-server start);
- `sitemap.xml` misses a page variant, lists an unregistered URL, contains a
  trailing slash or `www` host, or has non-reciprocal alternates
  (`validateSitemapXml`, run by `seoPlugin` before emitting it);
- a prerendered page's canonical is not the URL it is served at, its
  `<html lang>`, `og:url`, `og:locale` or `<title>` is wrong, or the hreflang
  annotations across all prerendered pages are not reciprocal
  (`assertPrerenderedSeo`, run by `prerender.ts` before writing any file);
- a component in `src/pages/public/*Page.tsx` is routed outside the registry,
  or `App.tsx` hardcodes a public path (`seoGuard.test.ts`).

## How robots.txt and sitemap.xml are generated

They are **not** static files under `frontend/public/`. They are generated at
build time (after the SEO guard has validated them) by the Vite plugin
[`frontend/build/seoPlugin.ts`](../frontend/build/seoPlugin.ts) from the
central config, so the canonical domain and route list are never duplicated:

- `generateBundle` emits `dist/robots.txt` and `dist/sitemap.xml`.
- `transformIndexHtml` injects `<link rel="canonical">`, the `robots` meta and
  the Open Graph / Twitter tags into `dist/index.html`, so crawlers get real
  metadata from the very first (pre-JavaScript) HTML response.
- `configureServer` / `configurePreviewServer` serve the same `/robots.txt` and
  `/sitemap.xml` from `vite` (dev) and `vite preview`, so local verification
  uses the same URLs as production.

At runtime, [`frontend/src/seo/RouteSeo.tsx`](../frontend/src/seo/RouteSeo.tsx)
keeps the canonical and `robots` meta correct during client-side navigation —
in particular it sets `noindex, nofollow` on every private/app/auth route. This
complements `robots.txt` (which prevents crawling) for crawlers that render
JavaScript.

## Build-time prerendering of public pages

OpenFarmPlanner stays a plain client-rendered SPA — there is no SSR server and
no per-request rendering in production. But `dist/index.html` alone cannot
carry per-route content, so a JS-less crawler hitting `/impressum` previously
saw the *landing page's* markup and metadata (served via the SPA fallback)
until client JS executed and React Router rendered the right page.

[`frontend/build/prerender.ts`](../frontend/build/prerender.ts) closes that
gap as a one-off **build** step (wired up as the `postbuild` npm script, so it
always runs right after `vite build`):

1. serves the just-built `dist/` with Vite's own `preview()` server;
2. uses Playwright (already a devDependency for e2e) to load every language
   version of every public page (`PUBLIC_PAGE_VARIANTS`) in a fresh headless
   browser context and capture the fully client-rendered DOM — the page's
   language comes from its URL, so each file contains the fully translated
   content, not German text translated after load — no backend is required, since none of these pages
   need to fetch data to render their initial content;
3. serializes the CSS-in-JS rules that Emotion/MUI inserted through the
   browser CSSOM back into the prerendered `<style data-emotion>` tags, so the
   first paint is styled even before the JavaScript bundle boots;
4. normalizes `<html lang>` and `<head>` (title, canonical, hreflang, robots,
   description, OG incl. `og:locale`/`og:url`, Twitter) to the page variant's
   values from `seoConfig.ts`/`seoAssets.ts` — the same
   source `RouteSeo` and `seoPlugin` already use, via the pure helper
   [`frontend/build/prerenderSeo.ts`](../frontend/build/prerenderSeo.ts) — so
   build-time and runtime tags never disagree or duplicate. The landing page
   (`/` only, same gating as the hero image preload below) additionally gets a
   `SoftwareApplication` JSON-LD `<script type="application/ld+json">` tag
   (`buildSoftwareApplicationJsonLd` in `seoAssets.ts`) for rich-result
   eligibility. Every claim in it (free to use, AGPL-3.0) must stay true to
   the visible page — update it in the same change if that ever changes;
5. runs the SEO guard over all captured heads, then writes the result as a
   **flat file per URL**: `dist/index.html`, `dist/en.html`,
   `dist/ueber.html`, `dist/en/about.html`, `dist/impressum.html`, … —
   never `<path>/index.html`. A directory named like the page makes every
   static server (Apache's `DirectorySlash`, `vite preview`) 301 the
   slashless URL to `<path>/`, which with a slashless canonical is exactly the
   canonical-points-at-a-redirect conflict that kept `/ueber` out of Google.
   The prerendered `<html>` also carries `data-ofp-page-language` and
   `data-ofp-page-path`, which `index.html`'s language preboot uses (see
   below);
6. additionally copies the *un*-prerendered SPA shell to
   `dist/app-shell.html`. Production's SPA fallback serves that file for every
   non-prerendered route, so `/app/*` and the auth routes never get the
   landing page's markup and metadata. An e2e assertion
   (`e2e/public-page-prerendering.spec.ts`) guards that it stays empty.

Every other route (`/app/*`, `/login`, `/register`, password reset,
invitations, ...) has no prerendered content of its own — only the public page
files above plus the shell are written. The
browser then boots the exact same SPA bundle as before
(`createRoot(...).render(...)`, no hydration) and takes over normal
client-side routing/i18n immediately; there is no route-specific content baked
into the JS bundle itself, only the initial markup.

Each prerendered file is in the language of its URL, and so is the SPA once
it boots on that URL (`src/i18n/routeLanguage.ts`). `frontend/index.html`
runs a tiny synchronous language preboot before first paint: on a
prerendered public page served at its own path (`data-ofp-page-path` matches
the URL) it takes the page language and shows the content immediately. On
every other route it resolves the user's language from
`localStorage["ui.language"]`, then `navigator.languages`/`navigator.language`,
falls back to English, sets `<html lang>`, and hides the root while the UI
language is not German (only relevant where a static server's SPA fallback
hands out prerendered German markup). React removes that guard in a
`useLayoutEffect` after the first committed app render.

`PRERENDER_OUT_DIR` (default `dist`) tells the script which build output
directory to prerender into, mirroring `vite build --outDir`; ops sets this
alongside `VITE_BASE_PATH` when building into `dist-production`/`dist-staging`
(see `ops/deploy/deploy_frontend.sh`).

Production must serve the generated files with distinct cache policies:

- HTML documents (`index.html`, `app-shell.html`, the prerendered
  `<path>.html` files) are revalidated (`Cache-Control: no-cache`) so each
  deploy immediately delivers the current hashed asset references.
- Vite content-hashed JavaScript/CSS/assets under `assets/` may be long-lived
  and immutable because a content change creates a new filename.
- Non-hashed JSON resources, including legacy public locale files under
  `public/locales/`, are revalidated rather than cached immutably.
- There is no service worker in the frontend build, so stale startup behavior
  should be debugged through the browser/proxy/static-host cache layers.

## Landing-page LCP: the hero image

The hero image (`/landing/hero-field.webp`, rendered by
[`HeroImage.tsx`](../frontend/src/components/HeroImage.tsx)) is the Largest
Contentful Paint element on `/`, and the three things that keep it fast are
spread across three different layers:

1. **`HomePage` is not lazy.** Every other public/app route in
   [`App.tsx`](../frontend/src/App.tsx) is `React.lazy()`-loaded behind a
   `Suspense fallback={null}` boundary — but `/` is build-time prerendered
   (see above) to static HTML that already contains the hero `<img>`,
   painted and downloading before any JS runs. `main.tsx` mounts with
   `createRoot(...).render(...)` (no hydration), so a lazy `HomePage` would
   wipe that prerendered DOM to nothing the instant the client bundle
   executes, and only repaint once the separate `HomePage` chunk round-trips.
   Measured locally (production build, `vite preview`, Lighthouse mobile
   preset, no added network/CPU throttling so the comparison isolates this
   specific change): LCP dropped from 1138 ms to 562 ms, and the LCP
   "element render delay" sub-part from 1022 ms to 459 ms. This is a
   known-but-unfixed latent issue on the other three prerendered routes
   (`/impressum`, `/datenschutz`, `/nutzungsbedingungen`) too — they still
   lazy-load and so still show a blank frame until their chunk loads; left
   alone deliberately since they aren't an LCP-critical route, but worth the
   same fix if one of them ever becomes one.
2. **A landing-page-only `<link rel=preload>`.** `applyHeadTags` in
   [`prerenderSeo.ts`](../frontend/build/prerenderSeo.ts) adds a
   `fetchpriority="high"` preload with `imagesrcset`/`imagesizes` that must
   mirror `HeroImage.tsx`'s `src`/`srcSet`/`sizes` exactly — gated on
   `variant.page.id === 'home'` so it only lands in `dist/index.html` and
   `dist/en.html`, never in
   `app-shell.html` (the SPA fallback for `/app/*` and auth routes) or the
   other prerendered routes, and never causes a double-fetch.
3. **Four responsive widths, not two.** `hero-field-640.webp` (~45 KB) and
   `hero-field-1280.webp` (~181 KB) were added alongside the existing
   `hero-field-960.webp` (~101 KB) and `hero-field.webp` (1920w, ~372 KB) —
   all WebP, quality ~75 (verified by re-encoding the existing files at that
   quality and comparing byte sizes: they already were ~75). The gap between
   960w and 1920w previously forced some phone/DPR combinations straight to
   the full 1920w file. Regenerate with:
   ```bash
   cd frontend/public/landing
   magick hero-field.webp -resize 640x  -quality 75 hero-field-640.webp
   magick hero-field.webp -resize 1280x -quality 75 hero-field-1280.webp
   ```
   Keep `HeroImage.tsx`'s `HERO_IMAGE_SRC_SET` and `prerenderSeo.ts`'s
   `imagesrcset` in sync — both must list the same four widths.

**Caching gap (not yet applied — lives in the `ops` repo):**
`ops/deploy/lib/htaccess.sh` currently serves all unhashed static assets
(`png|jpe?g|webp|svg|ico|woff2?|ttf`), including the hero variants, with
`Cache-Control: public, max-age=86400` — fine for correctness, but not the
1-year immutable caching a repeat visit could get. This only affects *repeat*
visits, not a cold Lighthouse run, since it's a caching header. To close it,
add a dedicated rule for the hero variants specifically (matched *before* the
generic static-asset rule, the same way the hashed-asset rule already
overrides it) in `render_spa_htaccess()`:
```apache
# Hero-field WebP variants are hand-versioned, not content-hashed - bump the
# filename (hero-field-v2.webp, ...) whenever the visual content changes, the
# same way Vite's content hash keeps the immutable rule below it safe.
<FilesMatch "landing/hero-field(-[0-9]+)?\.webp\$">
  Header set Cache-Control "public, max-age=31536000, immutable"
</FilesMatch>
```
placed above the existing generic `<FilesMatch "\.(png|jpe?g|webp|...)\$">`
block. Whoever changes the hero image's visual content must rename the file
(matching the existing hashed-JS/CSS convention of "a content change always
produces a new filename") rather than overwriting `hero-field.webp` in place,
or returning visitors would keep the stale cached image for up to a year.

## Serving: slashless URLs and the `www` host

Production serving lives in the `ops` repo (`deploy/lib/htaccess.sh` renders
the web-root `.htaccess`). Two rules there are required for the URL scheme
above:

1. **Slashless public pages.** Before the generic "real files and
   directories" pass-through, serve `<path>.html` for a slashless request and
   301 a trailing-slash request to the slashless URL whenever that file
   exists:

   ```apache
   RewriteCond %{DOCUMENT_ROOT}${rewrite_base}$1.html -f
   RewriteRule ^(.+)/$ ${rewrite_base}$1 [R=301,L]
   RewriteCond %{DOCUMENT_ROOT}${rewrite_base}$1.html -f
   RewriteRule ^(.+)$ $1.html [L]
   ```

   plus `DirectorySlash Off`: `/en` is both `en.html` and the directory
   `en/`, and without it mod_dir 301s `/en` to `/en/` before the rewrite runs
   (a redirect loop, or a 403 where the rewrite rules are missing). Gating
   both rules on the prerendered file keeps them away from backend prefixes,
   assets and app routes. Implemented in OpenFarmPlanner/ops#29. `vite preview` behaves the same for the
   slashless URL out of the box (its HTML fallback serves `<path>.html`), so
   local checks and the e2e suite use the production URLs.
2. **`www` → apex.** `WWW_REDIRECT_HOST` makes the `.htaccess` 301 every
   `www.openfarmplanner.org` request to the apex host. Backend prefixes
   proxied by `uberspace web backend` (`/api`, `/admin`, …) never reach that
   `.htaccess`, which is how `https://www.openfarmplanner.org/api/docs/` got
   indexed. The backend therefore redirects them itself:
   `config.middleware.CanonicalHostRedirectMiddleware` answers any request for
   a host in `CANONICAL_HOST_REDIRECTS` (default: `www.` + the
   `PUBLIC_FRONTEND_URL` host; set the env var, comma separated, to override,
   or to an empty value to disable) with a 301 (308 for non-GET/HEAD) to the
   same path and query on the canonical host.

## Environment variables

| Variable               | Default                         | Effect                                                                                                    |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `VITE_PUBLIC_SITE_URL` | `https://openfarmplanner.org`   | Canonical origin used for canonical/OG URLs, the `robots.txt` `Sitemap:` line and sitemap `<loc>` values. |
| `VITE_SEO_INDEXABLE`   | `true`                          | `false`/`0`/`no`/`off` → `robots.txt` becomes `Disallow: /` and a `noindex` meta is emitted.               |

**Production** must build with `VITE_PUBLIC_SITE_URL=https://openfarmplanner.org`
and `VITE_SEO_INDEXABLE` unset (or `true`).

**Preview / staging / test** builds should set `VITE_SEO_INDEXABLE=false` so
those hosts are deliberately kept out of search indexes. This is the only
supported way to block indexing environment-dependently — never ship a blanket
block to production.

## Local verification

Build and inspect the emitted artifacts:

```bash
cd frontend
VITE_PUBLIC_SITE_URL=https://openfarmplanner.org npm run build
cat dist/robots.txt
cat dist/sitemap.xml
grep -E 'canonical|robots|og:|twitter:' dist/index.html
grep -E '<title>|name="description"|application/ld\+json' dist/index.html
```

Or serve the production build and check over HTTP (no external service needed):

```bash
cd frontend
npm run build && npm run preview   # serves on http://localhost:4173
curl -s http://localhost:4173/robots.txt
curl -s http://localhost:4173/sitemap.xml
curl -s http://localhost:4173/ | grep -E 'rel="canonical"|name="robots"'
```

Check the prerendered per-route HTML directly (no server needed — this is the
actual file a static host will serve for that URL):

```bash
cd frontend
npm run build   # postbuild runs prerender.ts automatically
grep -E '<html|<title>|rel="canonical"|hreflang|og:locale' dist/ueber.html
grep -E '<html|<title>|rel="canonical"|hreflang|og:locale' dist/en/about.html
grep -E '<title>|rel="canonical"|name="description"' dist/impressum.html dist/en/legal-notice.html
! grep -R -E 'https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)' dist --include='*.html'
```

Or over HTTP against `vite preview`, with the same slashless URLs as
production:

```bash
curl -s http://localhost:4173/en/about | grep -E '<html|<title>|rel="canonical"|hreflang'
```

Confirm a non-production build blocks indexing:

```bash
cd frontend
VITE_SEO_INDEXABLE=false npm run build
cat dist/robots.txt      # expect: Disallow: /
grep 'name="robots"' dist/index.html   # expect: noindex, nofollow
```

Run the SEO tests:

```bash
cd frontend
npx vitest run src/seo build
```

Run the prerendering e2e checks (build output content, canonical/robots per
route, non-indexable routes never prerendered, no-JS content visibility,
client nav after loading a prerendered page):

```bash
cd frontend
npm run build && npx playwright test e2e/public-page-prerendering.spec.ts
```

## Production diagnosis after deployment

Run these against the live site (replace the host if verifying a preview):

```bash
# Status + redirect chain to the canonical URL (expect a single 200 at the end)
curl -sSIL https://openfarmplanner.org/ | grep -iE '^HTTP/|^location:'

# Public pages: slashless URL is a direct 200, the slash variant a 301 to it
curl -sSI https://openfarmplanner.org/ueber | grep -iE '^HTTP/|^location:'      # 200
curl -sSI https://openfarmplanner.org/ueber/ | grep -iE '^HTTP/|^location:'     # 301 -> /ueber
curl -sSI https://openfarmplanner.org/en/about | grep -iE '^HTTP/|^location:'   # 200
curl -s https://openfarmplanner.org/en/about | grep -E '<html lang="en"|<title>About OpenFarmPlanner</title>|hreflang'

# www -> apex, for SPA and backend paths alike
curl -sSI https://www.openfarmplanner.org/ueber | grep -iE '^HTTP/|^location:'     # 301 -> apex
curl -sSI https://www.openfarmplanner.org/api/docs/ | grep -iE '^HTTP/|^location:' # 301 -> apex

# All host/scheme variants should end on exactly one canonical https URL
for u in http://openfarmplanner.org https://openfarmplanner.org \
         http://www.openfarmplanner.org https://www.openfarmplanner.org; do
  echo "== $u =="; curl -sSIL "$u" | grep -iE '^HTTP/|^location:'
done

# robots.txt and sitemap.xml must return 200 and correct content types
curl -sSI https://openfarmplanner.org/robots.txt
curl -sSI https://openfarmplanner.org/sitemap.xml

# The landing HTML must NOT contain a noindex directive and MUST have a canonical
curl -s https://openfarmplanner.org/ | grep -iE 'rel="canonical"|name="robots"'

# There must be no X-Robots-Tag: noindex response header (this is set by the
# web server / proxy, i.e. in ops, not in this repository)
curl -sSI https://openfarmplanner.org/ | grep -i 'x-robots-tag'
```

### What this repository can and cannot fix

- **Fixable here:** the initial HTML metadata (canonical, robots, OG/Twitter),
  `robots.txt`, `sitemap.xml`, per-route `noindex` for private pages, and the
  canonical-domain configuration. All covered above.
- **Hosting / proxy / DNS (ops):** any `X-Robots-Tag: noindex`
  response header, HTTP→HTTPS and `www`→non-`www` redirects for the static
  site, the slashless public-page rewrite (see "Serving" above), TLS, and the
  actual static serving of `robots.txt` / `sitemap.xml`. The `www` redirect
  for backend-proxied paths is handled in this repo
  (`CanonicalHostRedirectMiddleware`). A previously-indexed site that
  silently dropped out of Google — while still being found by other engines — is
  most consistent with an `X-Robots-Tag: noindex` header (or a `robots.txt`
  `Disallow: /`) introduced at the proxy, e.g. during a beta/demo phase. Verify
  with the `curl` header checks above and remove any such directive in the ops
  configuration. The `www`→apex redirect is implemented as a production-only
  `.htaccess` rule in the `ops` repo (`WWW_REDIRECT_HOST` in
  `deploy/environments/production.env`, rendered by `deploy/lib/htaccess.sh`;
  see `ops/README.md`'s "Host canonicalization" section) — this repo only
  configures the canonical domain the redirect points at.
- **Google Search Console only:** submitting/pinging the sitemap, requesting
  re-indexing, and reviewing the "Page indexing" / "Removals" reports and any
  manual actions. These cannot be inspected from the codebase.
