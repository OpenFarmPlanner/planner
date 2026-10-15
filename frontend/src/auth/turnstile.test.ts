import { afterEach, describe, expect, it } from 'vitest';
import {
  isTurnstileConfigError,
  loadTurnstileScript,
  resolveTurnstileSiteKey,
  TURNSTILE_SCRIPT_URL,
  type TurnstileApi,
} from './turnstile';

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_URL}"]`));
}

describe('resolveTurnstileSiteKey', () => {
  it('trims the configured key and treats a missing one as disabled', () => {
    expect(resolveTurnstileSiteKey('  0x4AAA  ')).toBe('0x4AAA');
    expect(resolveTurnstileSiteKey(undefined)).toBe('');
  });
});

describe('isTurnstileConfigError', () => {
  it('flags the documented configuration codes only', () => {
    for (const code of ['110100', '110110', '110200', '400020', '400021', '400070', ' 110200 ']) {
      expect(isTurnstileConfigError(code)).toBe(true);
    }
    expect(isTurnstileConfigError(110200)).toBe(true);
    for (const code of ['110600', '110620', '200100', '200500', '300010', '600010', '', undefined, null]) {
      expect(isTurnstileConfigError(code)).toBe(false);
    }
  });
});

describe('loadTurnstileScript', () => {
  afterEach(() => {
    injectedScripts().forEach((script) => script.remove());
    delete window.turnstile;
  });

  it('injects the explicit-render script once and resolves with the API', async () => {
    const first = loadTurnstileScript();
    const second = loadTurnstileScript();
    expect(injectedScripts()).toHaveLength(1);

    const api = { render: () => 'id', reset: () => undefined, remove: () => undefined } satisfies TurnstileApi;
    window.turnstile = api;
    injectedScripts()[0].dispatchEvent(new Event('load'));

    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it('allows a new attempt after the script failed to load', async () => {
    const failed = loadTurnstileScript();
    injectedScripts()[0].dispatchEvent(new Event('error'));
    await expect(failed).rejects.toThrow('failed to load');
    expect(injectedScripts()).toHaveLength(0);

    void loadTurnstileScript().catch(() => undefined);
    expect(injectedScripts()).toHaveLength(1);
  });
});
