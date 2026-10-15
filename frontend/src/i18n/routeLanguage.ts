/**
 * Language fixed by the current URL.
 *
 * On public SEO pages (`seoConfig.PUBLIC_PAGES`) the language is determined by
 * the URL only: `/ueber` is German and `/en/about` is English for every
 * visitor, regardless of their stored preference, browser language or
 * cookies, so crawlers and visitors always get the version they linked to.
 * Every other route (`null` here) keeps following the user's preference — see
 * `useLanguagePreference`.
 *
 * The store holds the current public page variant (which also tells the
 * language switcher the counterpart URL). A tiny external store rather than
 * React context: the i18n bootstrap (`config.ts`) needs the value before
 * React renders, and `LanguageSynchronizer` and the language switcher can
 * render outside the router.
 */

import { useSyncExternalStore } from 'react';

import { findPublicPageVariant, type PublicPageVariant } from '../seo/seoConfig';
import type { SupportedLanguage } from './languages';

type Listener = () => void;

const listeners = new Set<Listener>();

/** Strip the deployment base path (`VITE_BASE_PATH`) so registry paths match. */
export function toAppRelativePathname(pathname: string, baseUrl: string = import.meta.env.BASE_URL): string {
  const basePath = baseUrl.replace(/\/+$/, '');
  return basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) || '/' : pathname;
}

let currentVariant: PublicPageVariant | null =
  typeof window === 'undefined'
    ? null
    : findPublicPageVariant(toAppRelativePathname(window.location.pathname));

/** The public page variant currently shown, or `null` off public pages. */
export function getCurrentPublicPage(): PublicPageVariant | null {
  return currentVariant;
}

export function getRouteLanguage(): SupportedLanguage | null {
  return currentVariant?.language ?? null;
}

/**
 * Record the route now shown; called by `RouteLanguageSync` on every
 * navigation (`null` clears it, e.g. between tests).
 */
export function setCurrentRoute(pathname: string | null): void {
  const next = pathname === null ? null : findPublicPageVariant(pathname);
  if (next === currentVariant) {
    return;
  }
  currentVariant = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCurrentPublicPage(): PublicPageVariant | null {
  return useSyncExternalStore(subscribe, getCurrentPublicPage, getCurrentPublicPage);
}

export function useRouteLanguage(): SupportedLanguage | null {
  return useCurrentPublicPage()?.language ?? null;
}
