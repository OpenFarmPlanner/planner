import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:14191';

export default defineConfig({
  testDir: '.',
  testMatch: 'editor.browser.ts',
  outputDir: process.env.SPIKE_TEST_RESULTS ?? 'test-results',
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.SPIKE_CHROMIUM },
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'vite preview --host 127.0.0.1 --strictPort --port 14191',
    url: baseURL,
  },
});
