import { useSyncExternalStore } from 'react';

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);

  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

function getSnapshot(): boolean {
  // `navigator.onLine` is absent in non-browser environments (the prerender
  // step, jsdom without a navigator stub). Treating "unknown" as online keeps
  // the indicator from claiming an outage it cannot observe.
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
    return true;
  }
  return navigator.onLine;
}

/**
 * Tracks whether the browser currently reports a network connection.
 *
 * `navigator.onLine` only reports the *link* state: it says the device has a
 * network interface with a route, not that the backend is reachable. That is
 * deliberately all this hook promises — the connection indicator built on it
 * shows "no network", never "the server is down".
 *
 * Subscribed through `useSyncExternalStore` rather than an effect, so a
 * connection change between the first render and the subscription cannot be
 * missed.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
