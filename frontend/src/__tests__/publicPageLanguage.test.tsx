/**
 * Public SEO pages take their language from the URL alone: `/ueber` is
 * German and `/en/about` English for everyone, the switcher links to the
 * counterpart URL, and internal links stay within the page's language.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import i18n from '../i18n/config';
import { LANGUAGE_STORAGE_KEY, readStoredLanguagePreference } from '../i18n/languages';
import RouteLanguageSync from '../i18n/RouteLanguageSync';
import LanguageSynchronizer from '../i18n/LanguageSynchronizer';
import { PublicLanguageSwitcher } from '../i18n/LanguageSwitcher';
import LegalLinks from '../components/legal/LegalLinks';
import ImprintPage from '../pages/public/ImprintPage';
import RouteSeo from '../seo/RouteSeo';
import theme from '../theme';

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

function renderAt(path: string, page: React.ReactElement) {
  return render(
    <ThemeProvider theme={theme}>
      <LanguageSynchronizer />
      <MemoryRouter initialEntries={[path]}>
        <RouteLanguageSync />
        <RouteSeo />
        <LocationProbe />
        <Routes>
          <Route path="*" element={page} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

afterEach(async () => {
  window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  document.head.querySelectorAll('link[rel="alternate"], link[rel="canonical"]').forEach((node) => node.remove());
  await i18n.changeLanguage('de');
});

describe('public page language', () => {
  it('renders an English URL in English even when German is the stored preference', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    renderAt('/en/legal-notice', <ImprintPage />);

    await waitFor(() => expect(i18n.resolvedLanguage).toBe('en'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Imprint');
    expect(document.documentElement.lang).toBe('en');
    // Visiting a URL never rewrites the user's own preference.
    expect(readStoredLanguagePreference()).toBe('de');
  });

  it('renders a German URL in German even when English is the stored preference', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderAt('/impressum', <ImprintPage />);

    await waitFor(() => expect(i18n.resolvedLanguage).toBe('de'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Impressum');
  });

  it('keeps the switcher links in the DOM as real counterpart links', async () => {
    renderAt('/en/legal-notice', <PublicLanguageSwitcher />);

    // Without opening the menu: crawlers must be able to follow them.
    await waitFor(() => expect(document.querySelector('a[hreflang="de"]')).not.toBeNull());
    const german = document.querySelector('a[role="menuitemradio"][hreflang="de"]');
    const english = document.querySelector('a[role="menuitemradio"][hreflang="en"]');
    expect(german).toHaveAttribute('href', '/impressum');
    expect(german).toHaveAttribute('hreflang', 'de');
    expect(english).toHaveAttribute('href', '/en/legal-notice');
  });

  it('navigates to the counterpart URL when switching and remembers the choice', async () => {
    const user = userEvent.setup();
    renderAt('/impressum', <PublicLanguageSwitcher />);

    await user.click(screen.getByRole('button', { name: /Deutsch/ }));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'English' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/en/legal-notice'));
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('en'));
    expect(readStoredLanguagePreference()).toBe('en');
  });

  it('points internal links at the URLs of the page language', async () => {
    renderAt('/en/about', <LegalLinks />);

    await waitFor(() => expect(i18n.resolvedLanguage).toBe('en'));
    expect(screen.getByRole('link', { name: 'Imprint' })).toHaveAttribute('href', '/en/legal-notice');
    expect(screen.getByRole('link', { name: /Privacy/ })).toHaveAttribute('href', '/en/privacy');
    expect(screen.getByRole('link', { name: /Terms/ })).toHaveAttribute('href', '/en/terms');
  });

  it('sets a self canonical and reciprocal hreflang alternates at runtime', async () => {
    renderAt('/en/about', <div />);

    await waitFor(() =>
      expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
        'href',
        'https://openfarmplanner.org/en/about',
      ),
    );
    const alternates = [...document.head.querySelectorAll('link[rel="alternate"][hreflang]')].map(
      (element) => `${element.getAttribute('hreflang')}=${element.getAttribute('href')}`,
    );
    expect(alternates).toEqual([
      'de=https://openfarmplanner.org/ueber',
      'en=https://openfarmplanner.org/en/about',
      'x-default=https://openfarmplanner.org/ueber',
    ]);
    expect(document.title).toBe('About OpenFarmPlanner');
  });

  it('drops hreflang alternates on non-public routes', async () => {
    const stale = document.createElement('link');
    stale.setAttribute('rel', 'alternate');
    stale.setAttribute('hreflang', 'de');
    stale.setAttribute('href', 'https://openfarmplanner.org/ueber');
    document.head.appendChild(stale);

    renderAt('/login', <div />);

    await waitFor(() => expect(document.head.querySelectorAll('link[rel="alternate"][hreflang]')).toHaveLength(0));
  });
});
