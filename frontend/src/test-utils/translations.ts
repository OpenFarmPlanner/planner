/**
 * Synchronous access to the real German translation bundles for use in tests,
 * without needing to await i18next initialization.
 *
 * These are the same namespace files i18n/config.ts loads at runtime, so
 * `translations.navigation.crops` always reflects the copy users actually see.
 */

import crops from '../i18n/locales/de/crops.json';
import home from '../i18n/locales/de/home.json';
import navigation from '../i18n/locales/de/navigation.json';

const translations = {
  navigation,
  crops,
  home,
};

export default translations;
