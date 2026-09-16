import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstallPrompt } from '../useInstallPrompt';

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

describe('useInstallPrompt', () => {
  it('reports not installable until beforeinstallprompt fires', () => {
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.canPromptInstall).toBe(false);
  });

  it('captures beforeinstallprompt, suppressing the browser-native mini-infobar', () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = createBeforeInstallPromptEvent();
    const preventDefault = vi.spyOn(event, 'preventDefault');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.canPromptInstall).toBe(true);
  });

  it('shows the captured prompt and reports acceptance', async () => {
    const { result } = renderHook(() => useInstallPrompt());
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
    expect(result.current.canPromptInstall).toBe(false);
  });

  it('reports dismissal without leaving the prompt available for a retry', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = createBeforeInstallPromptEvent('dismissed');

    act(() => {
      window.dispatchEvent(event);
    });

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });

    expect(accepted).toBe(false);
    expect(result.current.canPromptInstall).toBe(false);
  });

  it('does nothing when asked to prompt with no captured event', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    const accepted = await result.current.promptInstall();

    expect(accepted).toBe(false);
  });

  it('marks the app installed once appinstalled fires, clearing any pending prompt', () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent());
    });
    expect(result.current.canPromptInstall).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canPromptInstall).toBe(false);
  });

  it('reports already installed when launched standalone', () => {
    setStandalone(true);

    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isInstalled).toBe(true);
  });

  it('flags iOS, which never fires beforeinstallprompt', () => {
    setIosUserAgent(true);

    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isIos).toBe(true);
    expect(result.current.canPromptInstall).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useInstallPrompt());
    unmount();

    const removed = removeEventListener.mock.calls.map(([type]) => type);
    expect(removed).toContain('beforeinstallprompt');
    expect(removed).toContain('appinstalled');
  });
});
