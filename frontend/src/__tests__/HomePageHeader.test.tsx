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

    const aboutLink = within(header).getByRole('link', { name: 'Über OpenFarmPlanner' });
    expect(aboutLink).toBeInTheDocument();
    expect(aboutLink).not.toHaveAttribute('aria-current');

    expect(within(header).getByRole('button', { name: /Sprache/ })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('moves the anchor links behind a labelled menu button', async () => {
    const user = userEvent.setup();
    renderHomePage();

    const header = screen.getByRole('banner');
    const menuButton = within(header).getByRole('button', { name: 'Menü öffnen' });

    await user.click(menuButton);

    const menu = screen.getByRole('menu', { name: 'Hauptnavigation' });
    expect(within(menu).getByRole('menuitem', { name: 'Funktionen' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Kulturbibliothek' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Open Source' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Über OpenFarmPlanner' })).toBeInTheDocument();
  });
});

describe('HomePage closing section', () => {
  it('links to the about page below the demo call-to-action', () => {
    renderHomePage();

    const link = screen.getByRole('link', { name: 'Mehr über OpenFarmPlanner und wer dahintersteht' });
    expect(link).toHaveAttribute('href', '/ueber');
  });
});
