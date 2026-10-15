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
  /** Returning true tells Turnstile the error was handled, so it logs nothing itself. */
  'error-callback'?: (errorCode: string) => boolean | void;
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

/**
 * Widget error codes that mean the widget itself is misconfigured, per
 * Cloudflare's "Client-side errors / Error codes" docs: invalid or unknown
 * site key (110100, 110110, 400020), hostname not authorized for the widget
 * (110200), site key region/domain mismatch (400021), disabled site key
 * (400070). Every other code (timeouts, iframe load, clock, 300xxx/600xxx
 * challenge failures) is transient or about the visitor. Must match the
 * backend allowlist `TURNSTILE_CLIENT_CONFIG_ERROR_CODES`.
 */
export const TURNSTILE_CONFIG_ERROR_CODES: ReadonlySet<string> = new Set([
  '110100',
  '110110',
  '110200',
  '400020',
  '400021',
  '400070',
]);

export function isTurnstileConfigError(errorCode: string | number | null | undefined): boolean {
  return TURNSTILE_CONFIG_ERROR_CODES.has(String(errorCode ?? '').trim());
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
