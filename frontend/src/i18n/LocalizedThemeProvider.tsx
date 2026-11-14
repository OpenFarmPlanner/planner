import { useMemo, type ReactNode } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { deDE, enUS, esES, frFR, itIT, ptPT } from '@mui/material/locale';
import { useTranslation } from 'react-i18next';

import theme from '../theme';
import { FALLBACK_LANGUAGE, normalizeLanguageTag, type SupportedLanguage } from './languages';

const CORE_LOCALES = { de: deDE, en: enUS, fr: frFR, es: esES, it: itIT, pt: ptPT } satisfies Record<SupportedLanguage, typeof enUS>;

/** Keep built-in MUI controls in step with the app's selected language. */
export default function LocalizedThemeProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const language = normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;
  const localizedTheme = useMemo(() => createTheme(theme, CORE_LOCALES[language]), [language]);
  return <ThemeProvider theme={localizedTheme}>{children}</ThemeProvider>;
}
