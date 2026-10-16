import { useTranslation } from 'react-i18next';

import { useRouteLanguage } from '../i18n/routeLanguage';
import { publicPagePath, toSeoLanguage, type PublicPageId, type SeoLanguage } from './seoConfig';

/**
 * Language whose public URLs internal links should point to: the current
 * public page's own language, otherwise the rendered UI language (so an
 * English sign-in page links to `/en/terms`).
 */
export function usePublicPageLanguage(): SeoLanguage {
  const routeLanguage = useRouteLanguage();
  const { i18n } = useTranslation();
  return routeLanguage ?? toSeoLanguage(i18n.resolvedLanguage ?? i18n.language);
}

/** Registry path of a public page in the current link language. Never hardcode `/ueber` & co. */
export function usePublicPagePath(id: PublicPageId): string {
  return publicPagePath(id, usePublicPageLanguage());
}
