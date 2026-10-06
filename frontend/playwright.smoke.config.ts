import { defineConfig, devices } from '@playwright/test';

// Post-deploy smoke check against a *live* environment (staging/production) —
// see e2e-smoke/README.md. Deliberately a separate config from
// playwright.config.ts: that one always boots its own local backend+frontend
// webServer pair and relies on the DEBUG-only E2E_TEST_TOKEN fixture
// endpoint, neither of which exists against a deployed environment. Kept out
// of e2e/ (a different testDir) so `npm run test:e2e` never picks this up
// and fails for lacking SMOKE_BASE_URL.
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) {
  throw new Error(
    'SMOKE_BASE_URL is required, e.g. SMOKE_BASE_URL=https://staging.openfarmplanner.org npm run smoke',
  );
}

export default defineConfig({
  testDir: './e2e-smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: 'list',
  use: {
    baseURL,
    locale: 'de-DE',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
