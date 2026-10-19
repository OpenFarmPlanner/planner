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
 * Translation keys are grouped into namespaces by functional area; every
 * locale bundle (de, en, fr, es) must define the same keys, with each
 * language's own plural forms (enforced by
 * `src/__tests__/i18nKeyParity.test.ts`).
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  FALLBACK_LANGUAGE,
  normalizeLanguageTag,
  resolveInitialLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from './languages';
import { getRouteLanguage } from './routeLanguage';

// Import translation files
import commonDE from './locales/de/common.json';
import commonEN from './locales/en/common.json';
import commonFR from './locales/fr/common.json';
import commonES from './locales/es/common.json';
import feedbackDE from './locales/de/feedback.json';
import feedbackEN from './locales/en/feedback.json';
import feedbackFR from './locales/fr/feedback.json';
import feedbackES from './locales/es/feedback.json';
import navigationDE from './locales/de/navigation.json';
import navigationEN from './locales/en/navigation.json';
import navigationFR from './locales/fr/navigation.json';
import navigationES from './locales/es/navigation.json';
import homeDE from './locales/de/home.json';
import homeEN from './locales/en/home.json';
import homeFR from './locales/fr/home.json';
import homeES from './locales/es/home.json';
import dashboardDE from './locales/de/dashboard.json';
import dashboardEN from './locales/en/dashboard.json';
import dashboardFR from './locales/fr/dashboard.json';
import dashboardES from './locales/es/dashboard.json';
import locationsDE from './locales/de/locations.json';
import locationsEN from './locales/en/locations.json';
import locationsFR from './locales/fr/locations.json';
import locationsES from './locales/es/locations.json';
import cropsDE from './locales/de/crops.json';
import cropsEN from './locales/en/crops.json';
import cropsFR from './locales/fr/crops.json';
import cropsES from './locales/es/crops.json';
import plantingPlansDE from './locales/de/plantingPlans.json';
import plantingPlansEN from './locales/en/plantingPlans.json';
import plantingPlansFR from './locales/fr/plantingPlans.json';
import plantingPlansES from './locales/es/plantingPlans.json';
import fieldsDE from './locales/de/fields.json';
import fieldsEN from './locales/en/fields.json';
import fieldsFR from './locales/fr/fields.json';
import fieldsES from './locales/es/fields.json';
import bedsDE from './locales/de/beds.json';
import bedsEN from './locales/en/beds.json';
import bedsFR from './locales/fr/beds.json';
import bedsES from './locales/es/beds.json';
import hierarchyDE from './locales/de/hierarchy.json';
import hierarchyEN from './locales/en/hierarchy.json';
import hierarchyFR from './locales/fr/hierarchy.json';
import hierarchyES from './locales/es/hierarchy.json';
import ganttChartDE from './locales/de/ganttChart.json';
import ganttChartEN from './locales/en/ganttChart.json';
import ganttChartFR from './locales/fr/ganttChart.json';
import ganttChartES from './locales/es/ganttChart.json';
import yieldOverviewDE from './locales/de/yieldOverview.json';
import yieldOverviewEN from './locales/en/yieldOverview.json';
import yieldOverviewFR from './locales/fr/yieldOverview.json';
import yieldOverviewES from './locales/es/yieldOverview.json';
import suppliersDE from './locales/de/suppliers.json';
import suppliersEN from './locales/en/suppliers.json';
import suppliersFR from './locales/fr/suppliers.json';
import suppliersES from './locales/es/suppliers.json';
import helpDE from './locales/de/help.json';
import helpEN from './locales/en/help.json';
import helpFR from './locales/fr/help.json';
import helpES from './locales/es/help.json';
import authDE from './locales/de/auth.json';
import authEN from './locales/en/auth.json';
import authFR from './locales/fr/auth.json';
import authES from './locales/es/auth.json';
import accountDE from './locales/de/account.json';
import accountEN from './locales/en/account.json';
import accountFR from './locales/fr/account.json';
import accountES from './locales/es/account.json';
import projectInvitationsDE from './locales/de/projectInvitations.json';
import projectInvitationsEN from './locales/en/projectInvitations.json';
import projectInvitationsFR from './locales/fr/projectInvitations.json';
import projectInvitationsES from './locales/es/projectInvitations.json';
import notificationsDE from './locales/de/notifications.json';
import notificationsEN from './locales/en/notifications.json';
import notificationsFR from './locales/fr/notifications.json';
import notificationsES from './locales/es/notifications.json';

// Configure i18next
i18n
  .use(initReactI18next)
  .init({
    // A public page's URL fixes its language (routeLanguage.ts); everywhere
    // else it is resolved from the stored choice / browser language. English
    // is the last-resort fallback for both the language and for missing keys.
    lng: getRouteLanguage() ?? resolveInitialLanguage(),
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES.map(({ code }) => code),
    
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
      fr: {
        common: commonFR,
        navigation: navigationFR,
        home: homeFR,
        dashboard: dashboardFR,
        locations: locationsFR,
        crops: cropsFR,
        plantingPlans: plantingPlansFR,
        fields: fieldsFR,
        beds: bedsFR,
        hierarchy: hierarchyFR,
        ganttChart: ganttChartFR,
        yieldOverview: yieldOverviewFR,
        suppliers: suppliersFR,
        help: helpFR,
        auth: authFR,
        account: accountFR,
        projectInvitations: projectInvitationsFR,
        notifications: notificationsFR,
        feedback: feedbackFR,
      },
      es: {
        common: commonES,
        navigation: navigationES,
        home: homeES,
        dashboard: dashboardES,
        locations: locationsES,
        crops: cropsES,
        plantingPlans: plantingPlansES,
        fields: fieldsES,
        beds: bedsES,
        hierarchy: hierarchyES,
        ganttChart: ganttChartES,
        yieldOverview: yieldOverviewES,
        suppliers: suppliersES,
        help: helpES,
        auth: authES,
        account: accountES,
        projectInvitations: projectInvitationsES,
        notifications: notificationsES,
        feedback: feedbackES,
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
