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
    const aboutLink = within(header).getByRole('link', { name: 'Über das Projekt' });
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

  it('ends the text with a signature, then the photo as a figure/figcaption', () => {
    renderAboutPage();

    expect(screen.getByText('Martin Stipsitz, Villach')).toBeInTheDocument();

    const figure = screen.getByRole('figure');
    const image = within(figure).getByRole('img', { name: 'Martin liegt lachend auf einem Acker und sät Bohnen' });
    expect(image).toHaveAttribute('src', expect.stringContaining('about-martin.webp'));
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(within(figure).getByText('Der Entwickler sät entspannt Bohnen bei der GeLaWi Zwiebelzopf.')).toBeInTheDocument();

    const mailLink = screen.getByRole('link', { name: 'info@openfarmplanner.org' });
    expect(mailLink).toHaveAttribute('href', 'mailto:info@openfarmplanner.org');
  });

  it('links to the GeLaWi Zwiebelzopf farm in a new tab', () => {
    renderAboutPage();

    const link = screen.getByRole('link', { name: 'GeLaWi Zwiebelzopf' });
    expect(link).toHaveAttribute('href', 'https://zwiebelzopf.at');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
