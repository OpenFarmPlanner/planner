import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import AboutPage from '../pages/public/AboutPage';

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ startGuestDemo: vi.fn() }),
}));

function renderAboutPage() {
  render(
    <MemoryRouter initialEntries={['/ueber']}>
      <AboutPage />
    </MemoryRouter>,
  );
}

describe('AboutPage', () => {
  it('renders the page heading, shares the topbar and footer, and marks the about nav item active', () => {
    renderAboutPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Wie OpenFarmPlanner entstanden ist' })).toBeInTheDocument();

    const header = screen.getByRole('banner');
    const aboutLink = within(header).getByRole('link', { name: 'Über OpenFarmPlanner' });
    expect(aboutLink).toHaveAttribute('aria-current', 'page');

    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('links the home-section anchors back to the landing page', () => {
    renderAboutPage();

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Funktionen' })).toHaveAttribute('href', '/#funktionen');
    expect(within(header).getByRole('link', { name: 'Kulturbibliothek' })).toHaveAttribute('href', '/#kulturbibliothek');
    expect(within(header).getByRole('link', { name: 'Open Source' })).toHaveAttribute('href', '/#open-source');
  });

  it('renders the closing photo card as a figure/figcaption with the name and caption', () => {
    renderAboutPage();

    const figure = screen.getByRole('figure');
    const image = within(figure).getByRole('img', { name: 'Martin liegt lachend auf einem Acker und sät Bohnen' });
    expect(image).toHaveAttribute('src', expect.stringContaining('about-martin.webp'));
    expect(image).toHaveAttribute('loading', 'lazy');

    expect(within(figure).getByText('Martin Stipsitz, Villach')).toBeInTheDocument();
    expect(figure.textContent).toContain('Entspanntes Bohnensäen bei der GeLaWi Zwiebelzopf.');

    const mailLink = screen.getByRole('link', { name: 'info@openfarmplanner.org' });
    expect(mailLink).toHaveAttribute('href', 'mailto:info@openfarmplanner.org');
  });

  it('renders no external link with an empty href while the farm URL is unset', () => {
    renderAboutPage();

    const emptyHrefLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '');
    expect(emptyHrefLinks).toHaveLength(0);
  });
});
