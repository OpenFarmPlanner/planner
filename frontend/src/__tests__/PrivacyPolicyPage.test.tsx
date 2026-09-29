import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import PrivacyPolicyPage from '../pages/public/PrivacyPolicyPage';

function renderPrivacyPolicyPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <PrivacyPolicyPage />
    </MemoryRouter>,
  );
}

describe('PrivacyPolicyPage', () => {
  it('renders the heading and every section with resolved (non-key) titles', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Datenschutzerklärung' })).toBeInTheDocument();

    const sectionHeadings = screen.getAllByRole('heading', { level: 6 });
    expect(sectionHeadings.length).toBeGreaterThanOrEqual(15);
    for (const heading of sectionHeadings) {
      expect(heading.textContent).not.toMatch(/legal\.privacy\.sections/);
    }
  });

  it('no longer mentions the AI enrichment feature or OpenAI', () => {
    renderPrivacyPolicyPage();

    expect(screen.queryByText(/KI-gestützte Datenanreicherung/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenAI/)).not.toBeInTheDocument();
  });

  it('covers the public library section with resolved content', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByRole('heading', { name: /Öffentliche Kulturbibliothek/ })).toBeInTheDocument();
    expect(screen.getByText(/dauerhaft bestehende Wissensdatenbank/)).toBeInTheDocument();
    expect(screen.getByText(/Eine Entfernung ist nicht als normale Benutzerfunktion vorgesehen/)).toBeInTheDocument();
  });

  it('states that public attribution uses an opt-in public display name, never the email address', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByText(/öffentliche Anzeigename angezeigt/)).toBeInTheDocument();
    expect(screen.getByText(/erfolgt die Veröffentlichung anonym/)).toBeInTheDocument();
    expect(screen.getByText(/zu keinem Zeitpunkt Bestandteil eines öffentlichen Eintrags/)).toBeInTheDocument();
  });

  it('explains that the display name belongs to the account and applies retroactively, and must be unique', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByText(/gehört zu Ihrem Konto, nicht zum einzelnen Eintrag/)).toBeInTheDocument();
    expect(screen.getByText(/Frühere Namen werden dabei nicht an einzelnen Einträgen gespeichert/)).toBeInTheDocument();
    expect(screen.getByText(/Der Anzeigename muss eindeutig sein/)).toBeInTheDocument();
  });

  it('mentions a general, forward-looking note on future collaboration without describing features that do not exist yet', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByText(/kollaborativ weiterentwickelt werden/)).toBeInTheDocument();
    expect(screen.getByText(/nicht über persönliche Kontaktdaten anderer Nutzer/)).toBeInTheDocument();
  });

  it('bases the public library section on publication terms and durable knowledge-base integrity', () => {
    renderPrivacyPolicyPage();

    const legalBasisLines = screen.getAllByText(/Rechtsgrundlage:/);
    const publicLibraryBasis = legalBasisLines.find((el) => el.textContent?.includes('öffentlichen Kulturbibliothek'));
    expect(publicLibraryBasis).toBeDefined();
    expect(publicLibraryBasis?.textContent).toMatch(/Art\. 6 Abs\. 1 lit\. b/);
    expect(publicLibraryBasis?.textContent).toMatch(/Art\. 6 Abs\. 1 lit\. f/);
    expect(publicLibraryBasis?.textContent).toMatch(/personenbezogene Bezüge/);
    expect(publicLibraryBasis?.textContent).toMatch(/Rein sachliche oder anonymisierte Kulturdaten fallen nicht unter die DSGVO/);
    expect(publicLibraryBasis?.textContent).not.toMatch(/lit\. a/);
    expect(publicLibraryBasis?.textContent).not.toMatch(/nicht oder nicht mehr personenbezogene/);
  });

  it('separates cookies from local/session storage into distinct sections', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByRole('heading', { name: /^\d+\. Cookies$/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Lokaler Speicher/ })).toBeInTheDocument();
    expect(screen.getByText(/keine Analyse-, Tracking- oder Marketing-Cookies/)).toBeInTheDocument();
    expect(screen.getByText(/zuletzt geöffnete Projekt/)).toBeInTheDocument();
    expect(screen.getByText(/Session-Storage-Daten werden in der Regel beim Schließen des Browser-Tabs gelöscht/)).toBeInTheDocument();
  });

  it('describes hosting logs and application logs without a separate log-files section', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByText(/Beim Aufruf der Anwendung verarbeitet der Webserver technische Zugriffsdaten/)).toBeInTheDocument();
    expect(screen.getByText(/gekürzte IP-Adresse/)).toBeInTheDocument();
    expect(screen.getByText(/angeforderte Seite bzw\. Ressource/)).toBeInTheDocument();
    expect(screen.getByText(/Referrer-URL, sofern übermittelt/)).toBeInTheDocument();
    expect(screen.getByText(/Webserver-Logfiles werden automatisch nach 7 Tagen gelöscht/)).toBeInTheDocument();
    expect(screen.getByText(/technische Anwendungsprotokolle.*Django- oder Gunicorn-Fehlerlogs/)).toBeInTheDocument();
    expect(screen.getByText(/Fehlerdiagnose sowie dem sicheren und stabilen Betrieb/)).toBeInTheDocument();
    expect(screen.getByText(/sicheren und stabilen Betrieb der Anwendung.*Erwägungsgrund 49 DSGVO/s)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Log-Dateien/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Standardkonfiguration/)).not.toBeInTheDocument();
    expect(screen.queryByText(/können Webserver-Logfiles/)).not.toBeInTheDocument();
  });

  it('does not claim data is never shared with third parties', () => {
    renderPrivacyPolicyPage();

    expect(screen.queryByText(/werden nicht an Dritte weitergegeben/)).not.toBeInTheDocument();
    expect(screen.getByText(/Auftragsverarbeitung/)).toBeInTheDocument();
    expect(screen.getByText(/deren Sichtbarkeit für andere Nutzer wählen/)).toBeInTheDocument();
    expect(screen.queryByText(/perspektivisch über öffentliche APIs oder Datenexporte/)).not.toBeInTheDocument();
  });

  it('lists the right to withdraw consent and cites GDPR article numbers', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByText(/Widerruf einer erteilten Einwilligung/)).toBeInTheDocument();
    expect(screen.getByText(/Art\. 15 DSGVO/)).toBeInTheDocument();
    expect(screen.getByText(/Art\. 7 Abs\. 3 DSGVO/)).toBeInTheDocument();
    expect(
      screen.getByText(/Datenexport und Kontolöschung können Sie direkt in den Kontoeinstellungen ausüben/),
    ).toBeInTheDocument();
    expect(screen.getByText(/nicht über diese Self-Service-Funktionen abgedeckt/)).toBeInTheDocument();
  });

  it('explains the right to lodge a complaint with the competent supervisory authority', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByRole('heading', { name: /Beschwerderecht/ })).toBeInTheDocument();
    expect(screen.getByText(/wenn Sie der Ansicht sind, dass die Verarbeitung Ihrer personenbezogenen Daten/)).toBeInTheDocument();
    expect(screen.getByText(/gewöhnlichen Aufenthaltsorts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes/)).toBeInTheDocument();
    expect(screen.getByText(/Für OpenFarmPlanner ist die österreichische Datenschutzbehörde/)).toBeInTheDocument();
    expect(screen.getByText(/Österreichische Datenschutzbehörde/)).toBeInTheDocument();
    expect(screen.getByText(/Barichgasse 40-42/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/www\.dsb\.gv\.at/)).toBeInTheDocument();
  });

  it('covers WKO checklist details for provision duty and third-country transfer', () => {
    renderPrivacyPolicyPage();

    expect(screen.queryByRole('heading', { name: /Datenschutzbeauftragter/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/kein Datenschutzbeauftragter bestellt/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Bereitstellung personenbezogener Daten/ })).toBeInTheDocument();
    expect(screen.getByText(/ohne diese Daten können wir kein Benutzerkonto bereitstellen/)).toBeInTheDocument();
    expect(screen.getByText(/ohne Veröffentlichung können Sie die übrigen Funktionen weiterhin nutzen/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Drittlandübermittlung/ })).toBeInTheDocument();
    expect(screen.getByText(/außerhalb der Europäischen Union oder des Europäischen Wirtschaftsraums statt/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Automatisierte Entscheidungsfindung/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/einschließlich Profiling im Sinne des Art\. 22 DSGVO/)).not.toBeInTheDocument();
  });

  it('states concrete retention windows visible from account and invitation flows', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByText(/Aktivierungslinks sind derzeit 7 Tage gültig/)).toBeInTheDocument();
    expect(screen.getByText(/E-Mail-Änderungslinks sind derzeit 24 Stunden gültig/)).toBeInTheDocument();
    expect(screen.getByText(/Projekt-Einladungen sind derzeit 14 Tage gültig/)).toBeInTheDocument();
    expect(screen.getByText(/für 14 Tage als „zur Löschung vorgemerkt“/)).toBeInTheDocument();
    expect(screen.getByText(/Projekte bleiben bestehen, solange mindestens ein Mitglied vorhanden ist/)).toBeInTheDocument();
    expect(screen.getByText(/kein Mitglied mehr, löschen wir das Projekt einschließlich der projektspezifischen Daten/)).toBeInTheDocument();
    expect(screen.getByText(/Veröffentlichte Einträge in der öffentlichen Kulturbibliothek sind davon nicht betroffen/)).toBeInTheDocument();
    expect(screen.getByText(/Server-Logfiles des Hosting-Anbieters werden nach 7 Tagen gelöscht/)).toBeInTheDocument();
    expect(screen.getByText(/Eigene Protokolle unserer geplanten Wartungsaufgaben \(Cron-Jobs\) löschen wir automatisiert spätestens nach 14 Tagen/)).toBeInTheDocument();
    expect(screen.getByText(/Passwort-Reset-Links sind derzeit 3 Tage gültig/)).toBeInTheDocument();
    expect(screen.getByText(/unangemeldete Demo-Funktion.*spätestens 8 Stunden nach Sitzungsbeginn automatisch gelöscht/)).toBeInTheDocument();
  });

  it('uses a concrete revision date instead of a generic month/year stamp', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByText(/Stand: 29\. September 2026/)).toBeInTheDocument();
  });

  it('describes Google sign-in as an active recipient without claiming Microsoft is active', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByRole('heading', { name: /Anmeldung mit Google-Konto/ })).toBeInTheDocument();
    expect(screen.getByText(/E-Mail-Adresse, Ihren Vor- und Nachnamen, eine stabile Google-Kontokennung/)).toBeInTheDocument();
    expect(screen.getByText(/übernommen werden davon nur die E-Mail-Adresse und Ihr Vorname/)).toBeInTheDocument();
    expect(screen.getByText(/ruft nach der Anmeldung keine Google-APIs auf/)).toBeInTheDocument();
    expect(screen.getByText(/Google LLC mit Sitz in den USA übermittelt/)).toBeInTheDocument();
    expect(screen.getByText(/unter dem EU-U\.S\. Data Privacy Framework \(DPF\) zertifiziert/)).toBeInTheDocument();
    expect(screen.getByText(/Angemessenheitsbeschluss nach Art\. 45 DSGVO/)).toBeInTheDocument();
    expect(screen.getByText(/Anmeldung mit Microsoft-Konto ist im Quellcode von OpenFarmPlanner vorbereitet, aber derzeit nicht aktiviert/)).toBeInTheDocument();
  });

  it('describes Cloudflare and Turnstile under legitimate interest with an SCC-based US transfer', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByRole('heading', { name: /Cloudflare \(DNS, CDN und Sicherheit\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Bot-Schutz bei der Registrierung \(Cloudflare Turnstile\)/ })).toBeInTheDocument();
    expect(screen.getByText(/Cloudflare als Reverse Proxy vor unseren Server bei Uberspace/)).toBeInTheDocument();
    expect(screen.getByText(/klassische Bilderrätsel sind dafür nicht nötig/)).toBeInTheDocument();
    expect(screen.getByText(/ist keine gesonderte Einwilligung erforderlich/)).toBeInTheDocument();
    expect(screen.getAllByText(/https:\/\/www\.cloudflare\.com\/privacypolicy\//)).toHaveLength(2);
    expect(screen.getByText(/an die Cloudflare, Inc\. mit Sitz in den USA übermittelt/)).toBeInTheDocument();
    expect(screen.getByText(/Standardvertragsklauseln \(Art\. 46 Abs\. 2 lit\. c DSGVO\)/)).toBeInTheDocument();
  });

  it('no longer lists the supplier name among publicly published crop data', () => {
    renderPrivacyPolicyPage();

    expect(screen.queryByText(/Lieferantenname/)).not.toBeInTheDocument();
    expect(screen.getByText(/projektinterne Angaben wie Saatgutlieferanten werden nicht mitveröffentlicht/)).toBeInTheDocument();
  });

  it('explains privacy policy changes and points to the revision date at the end', () => {
    renderPrivacyPolicyPage();

    expect(screen.getByRole('heading', { name: /Änderungen dieser Datenschutzerklärung/ })).toBeInTheDocument();
    expect(screen.getByText(/Verarbeitung personenbezogener Daten durch neue Funktionen/)).toBeInTheDocument();
    expect(screen.getByText(/Den Stand der letzten Änderung finden Sie am Ende dieser Datenschutzerklärung/)).toBeInTheDocument();
    expect(screen.getByText(/Über wesentliche Änderungen informieren wir aktive Nutzer in geeigneter Weise/)).toBeInTheDocument();
    expect(screen.queryByText(/oben auf dieser Seite/)).not.toBeInTheDocument();
  });
});
