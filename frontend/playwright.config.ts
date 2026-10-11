import { defineConfig, devices } from '@playwright/test';
import { e2eBaseURL, e2eWebServers } from './playwright.webservers';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: e2eBaseURL,
    // The app resolves its UI language from the browser (see docs/i18n.md), and
    // these specs assert German text. Without pinning the locale the suite would
    // silently depend on the runner's Chrome locale — CI reports en-US, so every
    // German assertion would time out. Setting it here keeps the real detection
    // path under test rather than bypassing it.
    locale: 'de-DE',
    // An intermittent CI failure is only diagnosable from what the browser
    // saw (requests, cookies, responses). Traces are written for failed tests
    // only, into test-results/, which e2e.yml uploads when a shard fails.
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: e2eWebServers,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
      testIgnore: /scrollbar-layout\.spec\.ts/,
    },
    {
      // Headless Chrome is launched with `--hide-scrollbars`, so the page never
      // gets the classic scrollbar that MUI's modal scroll lock compensates for
      // - the very thing scrollbar-layout.spec.ts is about. Dropping that flag
      // for this project only keeps the rest of the suite (and its screenshot
      // baselines) on the default, scrollbar-free rendering.
      name: 'chromium-scrollbars',
      testMatch: /scrollbar-layout\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
      },
    },
  ],
});
