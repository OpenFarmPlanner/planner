import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsLayout, type SettingsLayoutSection, type SettingsNavPlacement } from '../SettingsLayout';
import { SettingsSection } from '../SettingsSection';

const sections: SettingsLayoutSection[] = [
  { id: 'profile', label: 'Profil' },
  { id: 'language', label: 'Sprache' },
  { id: 'delete-account', label: 'Konto löschen', tone: 'danger' },
];

/** Reports `matches` for MUI's `up('md')` query, i.e. a desktop or a phone viewport. */
const stubViewport = (isDesktop: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
};

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];
  readonly observed: Element[] = [];
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    IntersectionObserverMock.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  /** Reports which of the observed sections are inside the reading band. */
  report(visibleIds: string[]) {
    const entries = this.observed.map((target) => ({
      target,
      isIntersecting: visibleIds.includes(target.id),
    })) as unknown as IntersectionObserverEntry[];
    act(() => this.callback(entries, this as unknown as IntersectionObserver));
  }
}

const renderLayout = (navPlacement: SettingsNavPlacement = 'side', initialEntry = '/app/account-settings') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SettingsLayout sections={sections} navPlacement={navPlacement}>
        <SettingsSection id="profile" title="Profil">Profilinhalt</SettingsSection>
        <SettingsSection id="language" title="Sprache">Sprachinhalt</SettingsSection>
        <SettingsSection id="delete-account" title="Konto löschen" tone="danger">Löschen</SettingsSection>
      </SettingsLayout>
    </MemoryRouter>,
  );

const nav = () => screen.getByRole('navigation', { name: 'Abschnitte' });
const navLink = (name: string) => within(nav()).getByRole('link', { name });

beforeEach(() => {
  IntersectionObserverMock.instances = [];
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
  stubViewport(true);
});

describe('SettingsLayout', () => {
  describe('navigation links', () => {
    it('links to each section with a real anchor', () => {
      renderLayout();

      expect(navLink('Profil')).toHaveAttribute('href', '#profile');
      expect(navLink('Sprache')).toHaveAttribute('href', '#language');
      expect(navLink('Konto löschen')).toHaveAttribute('href', '#delete-account');
      expect(document.getElementById('language')).toHaveTextContent('Sprachinhalt');
    });

    it('gives every section an h2 heading that names its region', () => {
      renderLayout();

      expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
        'Profil',
        'Sprache',
        'Konto löschen',
      ]);
      expect(screen.getByRole('region', { name: 'Sprache' })).toHaveAttribute('id', 'language');
    });
  });

  describe('the active section', () => {
    it('starts on the first section', () => {
      renderLayout();

      expect(navLink('Profil')).toHaveAttribute('aria-current', 'true');
      expect(navLink('Sprache')).not.toHaveAttribute('aria-current');
    });

    it('follows the section scrolled into view', () => {
      renderLayout();
      const observer = IntersectionObserverMock.instances.at(-1) as IntersectionObserverMock;
      expect(observer.observed.map((element) => element.id)).toEqual(['profile', 'language', 'delete-account']);

      observer.report(['language', 'delete-account']);

      // The topmost visible section wins over one peeking in further down.
      expect(navLink('Sprache')).toHaveAttribute('aria-current', 'true');
      expect(navLink('Profil')).not.toHaveAttribute('aria-current');
    });

    it('keeps the last active section while none is in the reading band', () => {
      renderLayout();
      const observer = IntersectionObserverMock.instances.at(-1) as IntersectionObserverMock;

      observer.report(['delete-account']);
      observer.report([]);

      expect(navLink('Konto löschen')).toHaveAttribute('aria-current', 'true');
    });

    it('marks a clicked section active right away', () => {
      renderLayout();

      act(() => navLink('Sprache').click());

      expect(navLink('Sprache')).toHaveAttribute('aria-current', 'true');
    });

    it('opens on the section a deep link names, and scrolls to it', async () => {
      // jsdom has no scrollIntoView.
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        renderLayout('side', '/app/account-settings#language');

        expect(navLink('Sprache')).toHaveAttribute('aria-current', 'true');
        await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
        expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('language'));
      } finally {
        delete (Element.prototype as Partial<Element>).scrollIntoView;
      }
    });

    it('ignores a hash that is not a section', () => {
      renderLayout('side', '/app/account-settings#unknown');

      expect(navLink('Profil')).toHaveAttribute('aria-current', 'true');
    });
  });

  describe('placement', () => {
    it('puts the navigation beside the content on desktop when asked for "side"', () => {
      renderLayout('side');

      expect(nav()).toHaveAttribute('data-placement', 'side');
    });

    it('renders "top" as a tab bar on desktop', () => {
      renderLayout('top');

      expect(nav()).toHaveAttribute('data-placement', 'top');
    });

    it('falls back to the tab bar below md even when asked for "side"', () => {
      stubViewport(false);
      renderLayout('side');

      expect(nav()).toHaveAttribute('data-placement', 'top');
      // Same links, only laid out differently.
      expect(within(nav()).getAllByRole('link')).toHaveLength(3);
    });
  });

  it('keeps every link at least 44px tall for touch', () => {
    renderLayout();

    for (const link of within(nav()).getAllByRole('link')) {
      expect(getComputedStyle(link).minHeight).toBe('44px');
    }
  });
});
