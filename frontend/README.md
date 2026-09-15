# OpenFarmPlanner Frontend

React + TypeScript frontend for OpenFarmPlanner.

This README covers frontend-specific development details. For the full project overview, start at the root [`README.md`](../README.md).

## Stack

- React 19
- TypeScript
- Vite
- Material UI
- React Router
- Vitest + Testing Library
- Playwright (E2E)
- vite-plugin-pwa (installable app + build-asset caching)

## Setup

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Local app URL: `http://localhost:5173/`

For phone/tablet testing in the same LAN, use the repository-level script:

```bash
../scripts/dev-lan.sh
```

It starts Vite with `--host 0.0.0.0` and prints the LAN URL. Leave `VITE_API_BASE_URL` unset unless you intentionally need a direct backend URL; `/api` is proxied by Vite and works from LAN clients.

## Available Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run test
npm run test:coverage
npm run test:e2e
npm run test:e2e:headed
```

## API Integration

- Frontend API client targets `/api` by default.
- In development, `VITE_API_BASE_URL` can override the API base URL. If it points to `localhost` and the app is opened via a LAN IP, the frontend rewrites it to the current LAN host for local testing.
- Requests include credentials and CSRF token handling for write operations.
- Active project context is sent via `X-Project-Id` when available.

## Internationalization

- UI strings are managed through i18n resource files under `src/i18n/locales/`.
- Keep UI text in translation resources rather than inline strings whenever practical.

## Deployment Notes

The app uses Vite code splitting and hashed frontend assets. When a new build is deployed, existing browser sessions can still reference chunk URLs from the previous build. The runtime handler in `src/runtime/chunkLoadErrors.ts` catches missing dynamic imports, reloads once per session window, and then shows a manual reload action if the chunk is still unavailable.

Vite clears the build output directory by default before writing a new build unless `emptyOutDir` is changed. Deployment details live in the separate ops repository, but if production deployment removes old hashed assets immediately, the runtime handler is still required. Keeping old `assets/` files available for a short grace period during deploys further reduces missing-chunk errors for active sessions.

## Progressive Web App

The app is installable and caches its own build assets through a service
worker. It caches **no API data** and provides **no offline mode** — see
[`docs/pwa.md`](../docs/pwa.md) for the full rationale, including the
multi-tenancy rule any future API caching would have to follow.

### Testing the PWA locally

The service worker only exists in a production build, so `npm run dev` will
not show any of this. Build and serve the real bundle:

```bash
cd frontend
npm run build
npm run preview          # http://localhost:4173
```

**Chrome DevTools (Application tab)**

1. **Manifest** — name "OpenFarmPlanner", short name "OFP", `standalone`,
   start URL `/app/dashboard`, and all three icons rendering without a
   "Download error" next to them.
2. **Service Workers** — one worker for the origin, status *activated and is
   running*. "Update on reload" while iterating saves a manual unregister.
3. **Cache Storage** — one `workbox-precache-*` entry listing the hashed
   `assets/*.js` and `assets/*.css` files. What should **not** be in there:
   any `/api/...` URL, and any HTML document (`/`, `/index.html`).
4. **Network** — reload and confirm the bundle rows say *(ServiceWorker)* in
   the Size column while `/api/...` rows still show a real transfer size.
5. **Offline** — tick DevTools' *Offline* box (Network tab, or Service
   Workers → Offline). The topbar indicator turns into a red crossed-out wifi
   icon within a second. Reloading the page will **not** work; that is the
   documented scope, not a bug.
6. **Install** — the install icon in the address bar, or ⋮ → *Cast, save and
   share* → *Install page as app*. The installed window opens on the
   dashboard with no browser chrome.

**On a real phone**

The manifest requires a secure context, so `http://<LAN-IP>:4173` will not
offer installation. Either use `chrome://inspect` port forwarding from a
desktop Chrome (`localhost:4173` → phone), or test against a deployed HTTPS
environment.

1. Open the app, then *Add to home screen* (Chrome/Android) or Share →
   *Add to Home Screen* (Safari/iOS).
2. Check the home-screen icon: on Android it should fill the launcher shape
   without the mark being clipped (that is the `maskable` variant), on iOS it
   uses the `apple-touch-icon`.
3. Launch from the home screen — it should open standalone at the dashboard,
   with the green brand colour in the status bar.
4. Enable flight mode and confirm the connection indicator appears in the
   compact topbar (it is hidden there while online) and reads
   "Offline – keine Verbindung".

## End-to-End Tests

See [`e2e/README.md`](./e2e/README.md) for Playwright-specific details.
`e2e/pwa.spec.ts` covers the manifest and the caching boundaries automatically.
