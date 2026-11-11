# Frontend E2E Tests

Playwright end-to-end tests for OpenFarmPlanner frontend flows.

## Run

```bash
cd frontend
npm run test:e2e
```

## Notes

- The Playwright configuration starts the backend and frontend web servers automatically.
  The backend runs through Daphne/ASGI so WebSocket routes behave like staging and
  production.
- The frontend server is the **production build** served via `vite preview`, not the Vite
  dev server: `npm run test:e2e` runs `npm run build` first, and Playwright's `webServer`
  entry only runs `vite preview` against the resulting `dist/`. This is intentional — it
  catches production-only bugs (e.g. effect-ordering/timing issues that only show up once
  code is bundled) that the dev server can mask. If you change frontend source and re-run
  `npx playwright test` directly (skipping `npm run test:e2e`), remember to `npm run build`
  first, or your changes won't be reflected.
- A debug-only backend fixture endpoint is available only when:
  - `DEBUG=True`
  - `E2E_TEST_TOKEN` is set for the backend process started by Playwright
- Tests that publish global public-library data must clean up their scenario
  with `resetE2EScenario()` in a `finally` block. The backend reset removes
  project data and reserved E2E public-crop varieties so local development
  catalogues do not accumulate test publications.
- `FRONTEND_PORT` and `BACKEND_PORT` env vars override the default ports (4173 / 8000) if
  you need to run E2E tests alongside an already-running dev environment.
- Two Playwright projects exist. `chromium` runs everything except
  `scrollbar-layout.spec.ts`; `chromium-scrollbars` runs only that spec, with headless
  Chrome's `--hide-scrollbars` flag dropped so the page actually renders a classic
  scrollbar. That spec is about MUI's modal scroll lock compensating the scrollbar
  width, which is unobservable without one. Keep the rest of the suite on the default, scrollbar-free rendering.

See `frontend/playwright.config.ts` for exact runtime settings. In CI, the
`E2E (production build)` workflow (`.github/workflows/e2e.yml`) runs this same build+test
flow on every pull request targeting `main`.


## Responsive layout checks

```bash
cd frontend
npx playwright test e2e/responsive-layouts.spec.ts
```

Eight main routes are checked at `375x800`, `768x900`, `1024x900` and
`1440x900` for page-heading visibility and horizontal overflow. Captures are
attached for human visual review; there are no pixel comparisons or baseline
updates. Focused specs cover dialogs, grids, action bounds and phone landscape.
Both configs retain a screenshot and trace on failure for CI artifacts.

## Cross-browser suite

Chromium, Firefox and WebKit (desktop and mobile) functional/layout assertions
live in `e2e-cross-browser/` with `playwright.cross-browser.config.ts`.
Run them inside the official Playwright Docker image:

```bash
cd frontend
npm run test:e2e:cross-browser
```

See "Cross-browser suite" in `docs/testing-and-ci.md`.
