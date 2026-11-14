import { act, render, screen } from '@testing-library/react';
import { Pagination } from '@mui/material';
import { describe, expect, it } from 'vitest';

import i18n from '../i18n/config';
import LocalizedThemeProvider from '../i18n/LocalizedThemeProvider';
import { getDataGridLocaleText } from '../components/data-grid/localeText';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';

describe('Italian built-in controls and formatting', () => {
  it('updates MUI core and DataGrid controls when the active language changes', async () => {
    await i18n.changeLanguage('it');
    render(<LocalizedThemeProvider><Pagination count={3} /></LocalizedThemeProvider>);
    expect(screen.getByRole('button', { name: 'Vai alla pagina successiva' })).toBeEnabled();
    expect(getDataGridLocaleText().columnMenuSortAsc).toBe('Ordinamento crescente');
    await act(async () => { await i18n.changeLanguage('en'); });
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeEnabled();
  });

  it('formats Italian dates and numbers using it-IT', () => {
    const locale = resolveLocaleFromLanguage('it-CH');
    expect(locale).toBe('it-IT');
    expect(new Intl.NumberFormat(locale).format(12345.5)).toBe('12.345,5');
    expect(new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2026, 2, 1))).toBe('marzo');
  });
});
