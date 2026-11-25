import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import HomePage from '../pages/public/HomePage';

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ startGuestDemo: vi.fn() }),
}));

function renderHomePage() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage topbar', () => {
  it('renders a sticky header with the brand link, anchor nav, language switcher and sign-in button', () => {
    renderHomePage();

    const header = screen.getByRole('banner');
    const brandLink = within(header).getByRole('link', { name: 'Zum Seitenanfang' });
    expect(brandLink).toHaveTextContent('OpenFarmPlanner');

    expect(within(header).getByRole('link', { name: 'Funktionen' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Kulturbibliothek' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Open Source' })).toBeInTheDocument();

    const aboutLink = within(header).getByRole('link', { name: 'Über das Projekt' });
    expect(aboutLink).toBeInTheDocument();
    expect(aboutLink).not.toHaveAttribute('aria-current');

    expect(within(header).getByRole('button', { name: /Sprache/ })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('moves the anchor links behind a labelled menu button', async () => {
    const user = userEvent.setup();
    renderHomePage();

    // jsdom applies media queries against its fixed 1024px viewport, where the
    // phone-only menu button is hidden by the `md` breakpoint.
    const header = screen.getByRole('banner');
    const menuButton = within(header).getByLabelText('Menü öffnen');

    await user.click(menuButton);

    const menu = screen.getByRole('menu', { name: 'Hauptnavigation' });
    expect(within(menu).getByRole('menuitem', { name: 'Funktionen' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Kulturbibliothek' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Open Source' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Über das Projekt' })).toBeInTheDocument();
  });
});

describe('HomePage closing section', () => {
  it('links to the about page below the demo call-to-action', () => {
    renderHomePage();

    const link = screen.getByRole('link', { name: 'Mehr über OpenFarmPlanner und wer dahintersteht' });
    expect(link).toHaveAttribute('href', '/ueber');
  });
});

describe('HomePage feature overview (#1583)', () => {
  it('gives graphical planning its own section and groups the season features under four headings', () => {
    renderHomePage();

    const graphical = screen.getByRole('region', { name: 'Deine Flächen so planen, wie sie im Gelände liegen.' });
    expect(within(graphical).getByRole('img', { name: /Schematischer Flächenplan/ })).toBeInTheDocument();
    expect(within(graphical).getByText('Bäume und Sträucher als Einzelpflanzen mit Kronendurchmesser platzieren')).toBeInTheDocument();

    const overview = screen.getByRole('region', { name: 'Alles für deine Saison' });
    const groups = within(overview).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(groups).toEqual([
      'Anbau planen', 'Kulturen und Saatgut', 'Anbau begleiten und auswerten', 'Flexibel und gemeinsam arbeiten',
    ]);
    for (const name of groups) {
      const group = within(overview).getByRole('region', { name: name! });
      expect(within(group).getAllByRole('heading', { level: 4 })).toHaveLength(4);
    }
    expect(within(overview).getByRole('heading', { level: 4, name: 'Mischkultur und Pflanzengesundheit' })).toBeInTheDocument();
  });
});
