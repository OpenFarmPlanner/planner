# SEO & Search-Engine Indexing

OpenFarmPlanner's frontend is a client-rendered React SPA (Vite) that is
deployed as static assets and served from the site root by the operations
stack (see `ops`). The Django backend is API-only and does
**not** serve the SPA or any SEO artifact. Everything below is therefore
produced by the **frontend build**.

## What is indexable

Indexable public pages (also the sitemap entries):

| Path                   | Purpose                        |
| ---------------------- | ------------------------------ |
| `/`                    | Public landing page            |
| `/ueber`               | About page                     |
| `/impressum`           | Imprint (legal)                |
| `/datenschutz`         | Privacy policy (legal)         |
| `/nutzungsbedingungen` | Terms of service (legal)       |

Explicitly **not** indexable (disallowed in `robots.txt` and served with a
`noindex, nofollow` robots meta at runtime):

- `/app/*` — the authenticated application
- `/login`, `/register`, `/activate`, `/forgot-password`, `/reset-password`,
  `/confirm-email-change`
- `/demo` — shareable guest-demo entry page; direct links are supported, but
  the route is not intended for search indexing
- `/invite/*`, `/invitation`

The single source of truth for both lists is
[`frontend/src/seo/seoConfig.ts`](../frontend/src/seo/seoConfig.ts)
(`PUBLIC_INDEXABLE_ROUTES` and `NON_INDEXABLE_PATH_PREFIXES`). Add a new public
route there and it flows automatically into the sitemap, the runtime canonical
logic and the tests. When the planned public crop library (`/crops`, see
[crop-library-architecture.md](crop-library-architecture.md)) ships, add its
public routes to `PUBLIC_INDEXABLE_ROUTES`.

## How robots.txt and sitemap.xml are generated

They are **not** static files under `frontend/public/`. They are generated at
build time by the Vite plugin
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
2. uses Playwright (already a devDependency for e2e) to load each entry of
   `PUBLIC_INDEXABLE_ROUTES` in a real headless browser and capture the fully
   client-rendered DOM — no backend is required, since none of these pages
   need to fetch data to render their initial content;
3. serializes the CSS-in-JS rules that Emotion/MUI inserted through the
   browser CSSOM back into the prerendered `<style data-emotion>` tags, so the
   first paint is styled even before the JavaScript bundle boots;
4. normalizes `<head>` (title, canonical, robots, description, OG, Twitter) to
   the route-specific values from `seoConfig.ts`/`seoAssets.ts` — the same
   source `RouteSeo` and `seoPlugin` already use, via the pure helper
   [`frontend/build/prerenderSeo.ts`](../frontend/build/prerenderSeo.ts) — so
   build-time and runtime tags never disagree or duplicate;
5. writes the result as a real file per route: `dist/index.html`,
   `dist/impressum/index.html`, `dist/datenschutz/index.html`,
   `dist/nutzungsbedingungen/index.html`;
6. additionally copies the *un*-prerendered SPA shell to
   `dist/app-shell.html`. Production's SPA fallback serves that file for every
   non-prerendered route, so `/app/*` and the auth routes never get the
   landing page's markup and metadata. An e2e assertion
   (`e2e/public-page-prerendering.spec.ts`) guards that it stays empty.

Every other route (`/app/*`, `/login`, `/register`, password reset,
invitations, ...) has no prerendered content of its own — only the four route
files above plus the shell are written. The
browser then boots the exact same SPA bundle as before
(`createRoot(...).render(...)`, no hydration) and takes over normal
client-side routing/i18n immediately; there is no route-specific content baked
into the JS bundle itself, only the initial markup.

The prerendered public HTML uses the site's canonical SEO language
(`SITE_LANGUAGE = 'de'` in `seoConfig.ts`). Runtime UI language is still
user-specific, so an English visitor must not see the German prerendered body
while the production bundle is loading. `frontend/index.html` therefore runs a
tiny synchronous language preboot before first paint: it reads
`localStorage["ui.language"]`, then `navigator.languages`/`navigator.language`,
falls back to English, sets `<html lang>`, and hides the prerendered root when
the initial UI language is not German. React removes that guard in a
`useLayoutEffect` after the first committed app render, so the first visible
client-rendered frame is already in the resolved language.

`PRERENDER_OUT_DIR` (default `dist`) tells the script which build output
directory to prerender into, mirroring `vite build --outDir`; ops sets this
alongside `VITE_BASE_PATH` when building into `dist-production`/`dist-staging`
(see `ops/deploy/deploy_frontend.sh`).

Production must serve the generated files with distinct cache policies:

- HTML documents (`index.html`, `app-shell.html`, prerendered route
  `index.html` files) are revalidated (`Cache-Control: no-cache`) so each
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
2. **A `/`-only `<link rel=preload>`.** `applyHeadTags` in
   [`prerenderSeo.ts`](../frontend/build/prerenderSeo.ts) adds a
   `fetchpriority="high"` preload with `imagesrcset`/`imagesizes` that must
   mirror `HeroImage.tsx`'s `src`/`srcSet`/`sizes` exactly — gated on
   `route.path === '/'` so it only lands in `dist/index.html`, never in
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

**Local verification caveat:** `vite preview`'s static file server only
resolves a route's prerendered `index.html` for a *trailing-slash* request
(`/impressum/`), the same way production Apache 301-redirects `/impressum` to
`/impressum/` before serving it (see `deploy_frontend.sh`'s generated
`.htaccess`, which passes real files/directories straight through via its
`-f`/`-d` rewrite condition). `curl`ing `/impressum` (no trailing slash)
against a local `vite preview` therefore falls back to the SPA shell — that is
a `vite preview`-only serving detail, not a prerendering bug; add `-L` to
`curl` or use the trailing-slash URL locally.

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
grep -E '<title>|rel="canonical"|name="description"' dist/impressum/index.html
grep -E '<title>|rel="canonical"|name="description"' dist/datenschutz/index.html
grep -E '<title>|rel="canonical"|name="description"' dist/nutzungsbedingungen/index.html
! grep -R -E 'https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)' dist --include='*.html'
```

Or over HTTP against `vite preview` — note the trailing slash (see the caveat
above):

```bash
curl -sL http://localhost:4173/impressum/ | grep -E '<title>|rel="canonical"'
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
  response header, HTTP→HTTPS and `www`→non-`www` redirects, TLS, and the actual
  static serving of `robots.txt` / `sitemap.xml`. A previously-indexed site that
  silently dropped out of Google — while still being found by other engines — is
  most consistent with an `X-Robots-Tag: noindex` header (or a `robots.txt`
  `Disallow: /`) introduced at the proxy, e.g. during a beta/demo phase. Verify
  with the `curl` header checks above and remove any such directive in the ops
  configuration.
- **Google Search Console only:** submitting/pinging the sitemap, requesting
  re-indexing, and reviewing the "Page indexing" / "Removals" reports and any
  manual actions. These cannot be inspected from the codebase.
