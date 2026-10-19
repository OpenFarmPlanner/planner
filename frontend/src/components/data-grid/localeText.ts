import type { GridLocaleText } from '@mui/x-data-grid';
import { deDE, enUS, esES, frFR } from '@mui/x-data-grid/locales';
import i18n from 'i18next';

import { FALLBACK_LANGUAGE, normalizeLanguageTag, type SupportedLanguage } from '../../i18n/languages';

const MUI_GRID_LOCALES = {
  de: deDE.components.MuiDataGrid.defaultProps.localeText as GridLocaleText,
  en: enUS.components.MuiDataGrid.defaultProps.localeText as GridLocaleText,
  fr: frFR.components.MuiDataGrid.defaultProps.localeText as GridLocaleText,
  es: esES.components.MuiDataGrid.defaultProps.localeText as GridLocaleText,
} as const satisfies Record<SupportedLanguage, GridLocaleText>;

/**
 * Grid chrome (pagination, filter menus, overlays) in the active UI language.
 *
 * MUI ships the bulk of these strings; only the two overlay labels are
 * overridden, because the app words them differently from the MUI defaults.
 * Read the language at call time rather than at module load so a switch takes
 * effect on the next render instead of needing a reload.
 */
export function getDataGridLocaleText(): Partial<GridLocaleText> {
  const language = normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;
  return {
    ...MUI_GRID_LOCALES[language],
    noRowsLabel: i18n.t('common:messages.noRows'),
    noResultsOverlayLabel: i18n.t('common:messages.noResults'),
  };
}
