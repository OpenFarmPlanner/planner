/**
 * Keeps `routeLanguage` and i18next in step with client-side navigation, so
 * moving between `/ueber` and `/en/about` (or from a public page into the
 * app) switches the rendered language before the next paint.
 *
 * Mount once inside the router. Renders nothing.
 */

import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

import { getRouteLanguage, setCurrentRoute } from './routeLanguage';

export default function RouteLanguageSync(): null {
  const { pathname } = useLocation();
  const { i18n } = useTranslation();

  useLayoutEffect(() => {
    setCurrentRoute(pathname);
    const language = getRouteLanguage();
    if (language && i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
  }, [i18n, pathname]);

  return null;
}
