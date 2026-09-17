import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import TermsOfServicePage from '../pages/public/TermsOfServicePage';

function renderTermsOfServicePage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <TermsOfServicePage />
    </MemoryRouter>,
  );
}

describe('TermsOfServicePage', () => {
  it('renders the heading and every section with resolved (non-key) titles', () => {
    renderTermsOfServicePage();

    expect(screen.getByRole('heading', { level: 1, name: 'Nutzungsbedingungen' })).toBeInTheDocument();

    const sectionHeadings = screen.getAllByRole('heading', { level: 6 });
    expect(sectionHeadings.length).toBeGreaterThanOrEqual(16);
    for (const heading of sectionHeadings) {
      expect(heading.textContent).not.toMatch(/legal\.terms\.sections/);
    }
  });

  it('begins directly with section 1, without a preceding intro paragraph', () => {
    renderTermsOfServicePage();

    expect(screen.queryByText(/bewusst schlank gehalten/)).not.toBeInTheDocument();
    const sectionHeadings = screen.getAllByRole('heading', { level: 6 });
    expect(sectionHeadings[0].textContent).toMatch(/^1\./);
  });

  it('identifies the provider, service scope, and authoritative language version', () => {
    renderTermsOfServicePage();

    expect(screen.getByRole('heading', { name: /Anbieter und Kontakt/ })).toBeInTheDocument();
    expect(screen.getByText(/Martin Stipsitz/)).toBeInTheDocument();
    expect(screen.getByText(/Eine Umsatzsteuer-Identifikationsnummer besteht derzeit nicht/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Leistungsumfang/ })).toBeInTheDocument();
    expect(screen.getByText(/digitale Planungsfunktionen als gehostete Webanwendung/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Kosten und Lieferung/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/kostenpflichtige Funktionen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gesonderter Bedingungen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Zahlungsabwicklung/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Preisen, Versandkosten, Zahlungsmitteln/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Sprachfassungen/ })).toBeInTheDocument();
    expect(screen.getByText(/in deutscher und englischer Sprache bereitgestellt/)).toBeInTheDocument();
    expect(screen.getByText(/ist die englische Fassung maßgeblich/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Vertragssprache/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Die deutsche Fassung ist das Original/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Die Vertragssprache.*ist Deutsch/)).not.toBeInTheDocument();
  });

  it('offers a print action so the terms can be saved or printed from the browser', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderTermsOfServicePage();

    screen.getByRole('button', { name: 'Drucken / als PDF speichern' }).click();

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it('mentions the privacy policy from within the scope section instead of a standalone link', () => {
    renderTermsOfServicePage();

    expect(screen.getByText(/Verarbeitung personenbezogener Daten.*Datenschutzerklärung/)).toBeInTheDocument();
  });

  it('covers liability in plain language, without citing specific paragraphs or statutes', () => {
    renderTermsOfServicePage();

    expect(screen.getByRole('heading', { name: /Haftung/ })).toBeInTheDocument();
    expect(screen.getByText(/nicht garantieren/)).toBeInTheDocument();
    expect(screen.getByText(/verantwortlich, nicht OpenFarmPlanner/)).toBeInTheDocument();
    expect(screen.getByText(/ersetzen keine fachliche Beratung/)).toBeInTheDocument();
    expect(screen.getByText(/haften wir nur eingeschränkt/)).toBeInTheDocument();
    expect(screen.getByText(/Vorsatz und grober Fahrlässigkeit/)).toBeInTheDocument();
    expect(screen.getByText(/Verletzung des Lebens, des Körpers oder der Gesundheit/)).toBeInTheDocument();
    expect(screen.queryByText(/Konsumentenschutzgesetz/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Produkthaftungsgesetz/)).not.toBeInTheDocument();
  });

  it('no longer mentions being free of charge', () => {
    renderTermsOfServicePage();

    expect(screen.queryByText(/derzeit kostenlos/)).not.toBeInTheDocument();
  });

  it('mentions the AGPLv3 open-source license', () => {
    renderTermsOfServicePage();

    expect(screen.getByText(/GNU Affero General Public License/)).toBeInTheDocument();
  });

  it('describes the public crop library as a durable CC BY-SA knowledge base', () => {
    renderTermsOfServicePage();

    expect(screen.getByText(/dauerhaft bestehende Wissensdatenbank/)).toBeInTheDocument();
    expect(screen.getByText(/Creative Commons Attribution-ShareAlike 4\.0 International/)).toBeInTheDocument();
    expect(screen.getByText(/unwiderruflich/)).toBeInTheDocument();
    expect(screen.getByText(/nicht als normale Benutzerfunktion auf Wunsch wieder entfernt/)).toBeInTheDocument();
  });

  it('uses a concrete revision date instead of a generic month/year stamp', () => {
    renderTermsOfServicePage();

    expect(screen.getByText(/Stand: 17\. Juli 2026/)).toBeInTheDocument();
  });
});
