import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ImprintPage from '../pages/public/ImprintPage';

function renderImprintPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ImprintPage />
    </MemoryRouter>,
  );
}

describe('ImprintPage', () => {
  it('cites the Austrian ECG instead of the German TMG', () => {
    renderImprintPage();

    expect(screen.getByText(/§ 5 ECG/)).toBeInTheDocument();
    expect(screen.queryByText(/§ 5 TMG/)).not.toBeInTheDocument();
  });

  it('does not show the development-draft disclaimer in production', () => {
    renderImprintPage();

    expect(screen.queryByText(/Entwurfsstand/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rechtlich final prüfen/)).not.toBeInTheDocument();
  });

  it('shows the Austrian provider address', () => {
    renderImprintPage();

    expect(screen.getAllByText(/Martin Stipsitz/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/9500 Villach/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Österreich/).length).toBeGreaterThan(0);
  });

  it('discloses the media owner, business purpose and residence under § 25 MedienG', () => {
    renderImprintPage();

    expect(screen.getByRole('heading', { name: 'Offenlegung gemäß § 25 MedienG' })).toBeInTheDocument();
    expect(screen.getByText(/Medieninhaber: Martin Stipsitz/)).toBeInTheDocument();
    expect(screen.getByText(/Unternehmensgegenstand: Entwicklung und Betrieb der Open-Source-Webanwendung OpenFarmPlanner/)).toBeInTheDocument();
    expect(screen.getByText(/Wohnort: Villach, Österreich/)).toBeInTheDocument();
  });
});
