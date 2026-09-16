import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import i18n from './i18n/config';
import { LANGUAGE_STORAGE_KEY } from './i18n/languages';

// Testing Library's default async timeout (findBy*/waitFor) is 1000ms. That's
// too tight when the full suite (~2000 tests) runs under CI/local CPU
// contention, causing sporadic timeouts in tests that are otherwise correct
// (they pass reliably in isolation). Several individual tests already worked
// around this with explicit per-call `timeout` options; raising the shared
// default here fixes the same class of flake suite-wide instead of requiring
// every async assertion to opt in individually.
configure({ asyncUtilTimeout: 5000 });

// Pin the suite to German. The app resolves its language from the stored
// preference / browser language, and jsdom reports en-US, so without this every
// assertion on user-visible text would silently depend on the environment.
// Tests that exercise language resolution set the language themselves and
// restore it here.
const TEST_LANGUAGE = 'de';

// jsdom reports en-US. Report German instead so the real resolution path
// (browser language → i18next) lands on the language the suite asserts,
// rather than having to bypass it.
Object.defineProperty(window.navigator, 'languages', {
  configurable: true,
  get: () => ['de-DE', 'de'],
});
Object.defineProperty(window.navigator, 'language', {
  configurable: true,
  get: () => 'de-DE',
});

beforeEach(() => {
  window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  if (i18n.resolvedLanguage !== TEST_LANGUAGE) {
    void i18n.changeLanguage(TEST_LANGUAGE);
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});
