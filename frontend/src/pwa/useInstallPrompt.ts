import { useCallback, useEffect, useState } from 'react';

/**
 * Chrome/Edge/Android fire `beforeinstallprompt` and expose this shape; it is
 * not yet part of the DOM lib types.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
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

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

interface UseInstallPromptResult {
  /** A native install prompt is available; `promptInstall` will show it. */
  canPromptInstall: boolean;
  /** iOS Safari never fires `beforeinstallprompt` — installing there is a manual "Add to Home Screen" step. */
  isIos: boolean;
  /** The app is already running as an installed/standalone app. */
  isInstalled: boolean;
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
export function useInstallPrompt(): UseInstallPromptResult {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isRunningStandalone);

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

  return {
    canPromptInstall: deferredPrompt !== null,
    isIos: isIosDevice(),
    isInstalled,
    promptInstall,
  };
}
