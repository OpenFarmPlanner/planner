import { defineConfig, devices } from '@playwright/test';
import { e2eBaseURL, e2eWebServers } from './playwright.webservers';

// Cross-browser functional and layout suite; see docs/testing-and-ci.md.
// Firefox has no mobile emulation (`isMobile` is Chromium/WebKit only), so the
// mobile-firefox project approximates a phone: Pixel-class viewport, touch,
// a 2x pixel ratio and a Firefox for Android user agent. It still reports
// desktop-style media features such as `pointer: fine`; see docs.
const MOBILE_FIREFOX_USER_AGENT = 'Mozilla/5.0 (Android 14; Mobile; rv:155.0) Gecko/155.0 Firefox/155.0';

export default defineConfig({
  testDir: './e2e-cross-browser',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: e2eBaseURL,
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: e2eWebServers,
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] } },
    {
      name: 'mobile-firefox',
      use: {
        browserName: 'firefox',
        viewport: { width: 393, height: 851 },
        screen: { width: 393, height: 851 },
        deviceScaleFactor: 2,
        hasTouch: true,
        userAgent: MOBILE_FIREFOX_USER_AGENT,
      },
    },
  ],
});
