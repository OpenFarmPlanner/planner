import { useCallback, useEffect, useState } from 'react';

/**
 * Chrome/Edge/Android fire `beforeinstallprompt` and expose this shape; it is
 * not yet part of the DOM lib types.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type ManualInstallPlatform = 'manual-firefox-android' | 'manual-ios';
export type PwaInstallMode = 'native' | ManualInstallPlatform | 'unavailable';

interface PlatformSignals {
  userAgent: string;
  maxTouchPoints: number;
}

function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // iOS Safari has no `display-mode` media feature; it exposes this
  // non-standard navigator flag instead once launched from the home screen.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  const isStandaloneDisplayMode = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  return isStandaloneDisplayMode || iosStandalone === true;
}

/**
 * Platforms that never fire `beforeinstallprompt` but still allow a manual
 * install. Purely user-agent based, so Chromium never lands here and the
 * native branch cannot flicker into the fallback before its event arrives.
 */
export function detectManualInstallPlatform({ userAgent, maxTouchPoints }: PlatformSignals): ManualInstallPlatform | null {
  // iPadOS 13+ reports a desktop Mac user agent; only touch support tells it apart.
  const isIpadWithMacUserAgent = /macintosh/i.test(userAgent) && maxTouchPoints > 1;
  if (/iphone|ipad|ipod/i.test(userAgent) || isIpadWithMacUserAgent) {
    return 'manual-ios';
  }
  if (/android/i.test(userAgent) && /firefox\//i.test(userAgent)) {
    return 'manual-firefox-android';
  }
  return null;
}

function readPlatformSignals(): PlatformSignals {
  if (typeof navigator === 'undefined') {
    return { userAgent: '', maxTouchPoints: 0 };
  }
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}

interface UsePwaInstallResult {
  /**
   * `native`: `promptInstall` shows the browser's dialog. `manual-*`: the
   * caller shows platform-specific instructions. `unavailable`: installed
   * already, or nothing to offer.
   */
  mode: PwaInstallMode;
  /** Shows the native install prompt. Resolves to whether the user accepted it; does nothing if none is available. */
  promptInstall: () => Promise<boolean>;
}

/**
 * Tracks installability for a manual "Install app" affordance (the landing
 * page's CTA), on top of the browser's own install icon in the address bar.
 *
 * The `beforeinstallprompt` event fires once per page load, at most, and
 * only if the browser has not already decided the app is uninstallable or
 * already installed — there is no way to ask for it again, so it must be
 * captured and held until a caller actually triggers `promptInstall`.
 */
export function usePwaInstall(): UsePwaInstallResult {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isRunningStandalone);
  const [manualPlatform] = useState(() => detectManualInstallPlatform(readPlatformSignals()));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleBeforeInstallPrompt = (event: Event): void => {
      // Suppresses the browser's own mini-infobar so the landing page's
      // button is the only prompt trigger, matching its "big button" intent.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = (): void => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) {
      return false;
    }

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // Spent either way: the browser will not re-fire the event for a prompt
    // that was already shown, accepted or not.
    setDeferredPrompt(null);
    return outcome === 'accepted';
  }, [deferredPrompt]);

  let mode: PwaInstallMode = 'unavailable';
  if (!isInstalled) {
    mode = deferredPrompt ? 'native' : manualPlatform ?? 'unavailable';
  }

  return { mode, promptInstall };
}
