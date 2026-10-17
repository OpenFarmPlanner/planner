import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectManualInstallPlatform, usePwaInstall } from '../usePwaInstall';

function setStandalone(value: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: value,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function setIosUserAgent(isIos: boolean): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: isIos ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' : 'Mozilla/5.0 (Macintosh)',
  });
}

function createBeforeInstallPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

beforeEach(() => {
  setStandalone(false);
  setIosUserAgent(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePwaInstall', () => {
  it('reports not installable until beforeinstallprompt fires', () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.mode).toBe('unavailable');
  });

  it('captures beforeinstallprompt, suppressing the browser-native mini-infobar', () => {
    const { result } = renderHook(() => usePwaInstall());
    const event = createBeforeInstallPromptEvent();
    const preventDefault = vi.spyOn(event, 'preventDefault');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe('native');
  });

  it('shows the captured prompt and reports acceptance', async () => {
    const { result } = renderHook(() => usePwaInstall());
    const event = createBeforeInstallPromptEvent('accepted');

    act(() => {
      window.dispatchEvent(event);
    });

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(accepted).toBe(true);
    // Spent: the browser will not re-fire the event for the same prompt.
    expect(result.current.mode).toBe('unavailable');
  });

  it('reports dismissal without leaving the prompt available for a retry', async () => {
    const { result } = renderHook(() => usePwaInstall());
    const event = createBeforeInstallPromptEvent('dismissed');

    act(() => {
      window.dispatchEvent(event);
    });

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });

    expect(accepted).toBe(false);
    expect(result.current.mode).toBe('unavailable');
  });

  it('does nothing when asked to prompt with no captured event', async () => {
    const { result } = renderHook(() => usePwaInstall());

    const accepted = await result.current.promptInstall();

    expect(accepted).toBe(false);
  });

  it('marks the app installed once appinstalled fires, clearing any pending prompt', () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent());
    });
    expect(result.current.mode).toBe('native');

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.mode).toBe('unavailable');
  });

  it('reports already installed when launched standalone', () => {
    setStandalone(true);

    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.mode).toBe('unavailable');
  });

  it('falls back to manual iOS instructions, as iOS never fires beforeinstallprompt', () => {
    setIosUserAgent(true);

    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.mode).toBe('manual-ios');
  });

  it('reports unavailable on iOS once launched standalone', () => {
    setIosUserAgent(true);
    setStandalone(true);

    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.mode).toBe('unavailable');
  });

  it('stops listening once unmounted', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => usePwaInstall());
    unmount();

    const removed = removeEventListener.mock.calls.map(([type]) => type);
    expect(removed).toContain('beforeinstallprompt');
    expect(removed).toContain('appinstalled');
  });
});

const USER_AGENTS = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('detectManualInstallPlatform', () => {
  it.each([
    ['iPhone Safari', USER_AGENTS.iphoneSafari, 0],
    ['iPhone Chrome', USER_AGENTS.iphoneChrome, 5],
    ['iPhone Firefox', USER_AGENTS.iphoneFirefox, 5],
    ['legacy iPad user agent', USER_AGENTS.ipadLegacy, 5],
    ['iPadOS reporting a Mac user agent with touch', USER_AGENTS.macSafari, 5],
  ])('detects iOS/iPadOS: %s', (_label, userAgent, maxTouchPoints) => {
    expect(detectManualInstallPlatform({ userAgent, maxTouchPoints })).toBe('manual-ios');
  });

  it('detects Firefox on Android', () => {
    expect(detectManualInstallPlatform({ userAgent: USER_AGENTS.androidFirefox, maxTouchPoints: 5 }))
      .toBe('manual-firefox-android');
  });

  it.each([
    ['Chrome on Android (native prompt)', USER_AGENTS.androidChrome, 5],
    ['Samsung Internet (native prompt)', USER_AGENTS.androidSamsung, 5],
    ['desktop Safari on a Mac without touch', USER_AGENTS.macSafari, 0],
    ['desktop Firefox on Windows', USER_AGENTS.desktopFirefox, 0],
    ['desktop Firefox on Linux with a touchscreen', USER_AGENTS.linuxFirefox, 10],
    ['desktop Chrome', USER_AGENTS.desktopChrome, 0],
  ])('offers no manual fallback for %s', (_label, userAgent, maxTouchPoints) => {
    expect(detectManualInstallPlatform({ userAgent, maxTouchPoints })).toBeNull();
  });
});
