// Loader and types for the Cloudflare Turnstile bot check on the registration
// form. See docs/account-trust-levels.md ("Registration hardening").

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  size?: 'normal' | 'flexible' | 'compact';
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback?: (token: string) => void;
  'error-callback'?: (errorCode: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'before-interactive-callback'?: () => void;
  'after-interactive-callback'?: () => void;
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Empty when this build was made without a Turnstile widget (dev, E2E). */
export function resolveTurnstileSiteKey(rawValue: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY): string {
  return (rawValue ?? '').trim();
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/**
 * Inject Cloudflare's script once and resolve with the API. A failed load
 * removes its script tag so a later call can retry.
 */
export function loadTurnstileScript(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  if (scriptPromise) {
    return scriptPromise;
  }
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error('Turnstile script loaded without exposing its API'));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.appendChild(script);
  }).finally(() => {
    // Only dedupe in-flight loads; afterwards `window.turnstile` is the cache,
    // and a failed load may be retried.
    scriptPromise = null;
  });
  return scriptPromise;
}
