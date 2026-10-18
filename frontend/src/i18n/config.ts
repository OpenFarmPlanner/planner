/**
 * i18n configuration for OpenFarmPlanner.
 *
 * On public SEO pages the URL fixes the language (`routeLanguage.ts`).
 * Elsewhere the startup language comes from `resolveInitialLanguage()`: the
 * user's stored choice, otherwise the browser language, otherwise English. A
 * signed-in user's server-side preference is applied on top once their
 * profile loads (`useLanguagePreference`), so a deliberate choice survives
 * reloads and new sessions and is never silently re-overridden by the browser
 * language.
 *
 * Translation keys are grouped into namespaces by functional area; both
 * locale bundles must define the same keys (enforced by
 * `src/__tests__/i18nKeyParity.test.ts`).
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { FALLBACK_LANGUAGE, normalizeLanguageTag, resolveInitialLanguage, type SupportedLanguage } from './languages';
import { getRouteLanguage } from './routeLanguage';

// Import translation files
import commonDE from './locales/de/common.json';
import commonEN from './locales/en/common.json';
import feedbackDE from './locales/de/feedback.json';
import feedbackEN from './locales/en/feedback.json';
import navigationDE from './locales/de/navigation.json';
import navigationEN from './locales/en/navigation.json';
import homeDE from './locales/de/home.json';
import homeEN from './locales/en/home.json';
import dashboardDE from './locales/de/dashboard.json';
import dashboardEN from './locales/en/dashboard.json';
import locationsDE from './locales/de/locations.json';
import locationsEN from './locales/en/locations.json';
import cropsDE from './locales/de/crops.json';
import cropsEN from './locales/en/crops.json';
import plantingPlansDE from './locales/de/plantingPlans.json';
import plantingPlansEN from './locales/en/plantingPlans.json';
import fieldsDE from './locales/de/fields.json';
import fieldsEN from './locales/en/fields.json';
import bedsDE from './locales/de/beds.json';
import bedsEN from './locales/en/beds.json';
import hierarchyDE from './locales/de/hierarchy.json';
import hierarchyEN from './locales/en/hierarchy.json';
import ganttChartDE from './locales/de/ganttChart.json';
import ganttChartEN from './locales/en/ganttChart.json';
import yieldOverviewDE from './locales/de/yieldOverview.json';
import yieldOverviewEN from './locales/en/yieldOverview.json';
import suppliersDE from './locales/de/suppliers.json';
import suppliersEN from './locales/en/suppliers.json';
import helpDE from './locales/de/help.json';
import authDE from './locales/de/auth.json';
import authEN from './locales/en/auth.json';
import accountDE from './locales/de/account.json';
import accountEN from './locales/en/account.json';
import projectInvitationsDE from './locales/de/projectInvitations.json';
import projectInvitationsEN from './locales/en/projectInvitations.json';
import notificationsDE from './locales/de/notifications.json';
import notificationsEN from './locales/en/notifications.json';
import helpEN from './locales/en/help.json';

// Configure i18next
i18n
  .use(initReactI18next)
  .init({
    // A public page's URL fixes its language (routeLanguage.ts); everywhere
    // else it is resolved from the stored choice / browser language. English
    // is the last-resort fallback for both the language and for missing keys.
    lng: getRouteLanguage() ?? resolveInitialLanguage(),
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: ['de', 'en'],
    
    // Enable debug mode in development
    debug: import.meta.env.DEV && import.meta.env.MODE !== 'test',
    
    // Namespaces for organizing translations
    ns: ['common', 'navigation', 'home', 'dashboard', 'locations', 'crops', 'plantingPlans', 'fields', 'beds', 'hierarchy', 'ganttChart', 'yieldOverview', 'suppliers', 'help', 'auth', 'account', 'projectInvitations', 'notifications', 'feedback'],
    defaultNS: 'common',
    
    // Translation resources
    resources: {
      de: {
        common: commonDE,
        navigation: navigationDE,
        home: homeDE,
        dashboard: dashboardDE,
        locations: locationsDE,
        crops: cropsDE,
        plantingPlans: plantingPlansDE,
        fields: fieldsDE,
        beds: bedsDE,
        hierarchy: hierarchyDE,
        ganttChart: ganttChartDE,
        yieldOverview: yieldOverviewDE,
        suppliers: suppliersDE,
        help: helpDE,
        auth: authDE,
        account: accountDE,
        projectInvitations: projectInvitationsDE,
        notifications: notificationsDE,
        feedback: feedbackDE,
      },
      en: {
        common: commonEN,
        navigation: navigationEN,
        home: homeEN,
        dashboard: dashboardEN,
        locations: locationsEN,
        crops: cropsEN,
        plantingPlans: plantingPlansEN,
        fields: fieldsEN,
        beds: bedsEN,
        hierarchy: hierarchyEN,
        ganttChart: ganttChartEN,
        yieldOverview: yieldOverviewEN,
        suppliers: suppliersEN,
        help: helpEN,
        auth: authEN,
        account: accountEN,
        projectInvitations: projectInvitationsEN,
        notifications: notificationsEN,
        feedback: feedbackEN,
      },
    },
    
    // Interpolation settings
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    
    // React-specific settings
    react: {
      useSuspense: false, // Disable suspense for easier integration
    },
  });

// Keep <html lang> in step from the very first paint. index.html ships a
// static `lang`, so without this the document would claim the wrong language
// until a component mounted and corrected it.
function applyDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

applyDocumentLanguage(i18n.resolvedLanguage ?? i18n.language ?? FALLBACK_LANGUAGE);
i18n.on('languageChanged', applyDocumentLanguage);

/**
 * The UI language currently rendered. Requests that make the backend email
 * someone send it as `?language=`, so the email matches what the user sees
 * (docs/i18n.md, "E-Mails").
 */
export function getCurrentUiLanguage(): SupportedLanguage {
  return normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;
}

export default i18n;
