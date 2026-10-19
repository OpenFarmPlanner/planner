/**
 * In-memory UI language override for the development-only switcher in the
 * global menu. It is never persisted (no account API, no local storage), so a
 * reload returns to the stored preference. `useLanguagePreference` applies it
 * ahead of the preference; otherwise its sync effect would immediately switch
 * the UI back to the account language.
 */

import type { SupportedLanguage } from './languages';

let override: SupportedLanguage | null = null;
const listeners = new Set<() => void>();

export function getDevLanguageOverride(): SupportedLanguage | null {
  return override;
}

export function setDevLanguageOverride(next: SupportedLanguage | null): void {
  if (!import.meta.env.DEV || override === next) {
    return;
  }
  override = next;
  listeners.forEach((listener) => listener());
}

export function subscribeDevLanguageOverride(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
