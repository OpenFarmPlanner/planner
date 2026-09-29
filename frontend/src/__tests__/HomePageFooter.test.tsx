import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import HomePage from '../pages/public/HomePage';

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ startGuestDemo: vi.fn() }),
}));

describe('HomePage footer', () => {
  it('links to the public API reference served by the backend', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const footer = screen.getByRole('contentinfo');
    const apiLink = within(footer).getByRole('link', { name: 'API für Entwickler' });

    expect(apiLink.getAttribute('href')).toMatch(/\/api\/docs\/$/);
  });
});
