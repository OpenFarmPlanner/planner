import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PageHelp from '../components/help/PageHelp';

describe('PageHelp', () => {
  it('renders compact planting plans help without structured sections', async () => {
    render(<PageHelp pageKey="plantingPlans" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hilfe anzeigen' }));

    expect(await screen.findByText('Hier planst du, welche Kultur wann auf welchem Beet angebaut wird.')).toBeInTheDocument();
    expect(screen.getByText('Einträge können direkt in der Tabelle erstellt und bearbeitet werden.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Mit „Passende Beete anzeigen“ siehst du Beete, die im Zeitraum frei sind und zur Fruchtfolge passen.', { exact: false })).toBeInTheDocument();

    expect(screen.queryByText('Bedienung')).not.toBeInTheDocument();
    expect(screen.queryByText('Zusammenhang mit anderen Seiten')).not.toBeInTheDocument();
    expect(screen.queryByText('Symbole und Bedienelemente')).not.toBeInTheDocument();
    expect(screen.queryByText('Anbauplan hinzufügen')).not.toBeInTheDocument();
    expect(screen.queryByText(/•/)).not.toBeInTheDocument();
  });

  it('renders compact dashboard help without structured sections', async () => {
    render(<PageHelp pageKey="dashboard" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hilfe anzeigen' }));

    expect(await screen.findByText('Sobald Anbaupläne vorhanden sind, erscheinen hier anstehende Aufgaben für Aussaat, Pflanzung, Anzucht und Ernte.')).toBeInTheDocument();
    expect(screen.queryByText('Bedienung')).not.toBeInTheDocument();
    expect(screen.queryByText('Hinweis')).not.toBeInTheDocument();
    expect(screen.queryByText(/•/)).not.toBeInTheDocument();
  });

  it('renders compact areas list help without obsolete symbol guidance', async () => {
    render(<PageHelp pageKey="areas" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hilfe anzeigen' }));

    expect(await screen.findByText('Hier verwaltest du die Flächenstruktur deines Betriebs – vom Standort über Parzellen bis zu einzelnen Beeten.')).toBeInTheDocument();
    expect(screen.getByText('Neue Standorte, Parzellen und Beete können über das', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('AddIcon')).toBeInTheDocument();
    expect(screen.getByText('hinzugefügt werden, das beim Überfahren eines Elements mit der Maus erscheint.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Einträge können direkt in der Tabelle bearbeitet werden. Über das', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('AgricultureIcon')).toBeInTheDocument();
    expect(screen.getByText('bei einem Beet legst du direkt einen Anbauplan dafür an. Weitere Aktionen wie Umbenennen oder Löschen findest du im Kontextmenü per Rechtsklick.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Bedienung')).not.toBeInTheDocument();
    expect(screen.queryByText('Zusammenhang mit anderen Seiten')).not.toBeInTheDocument();
    expect(screen.queryByText('Symbole und Bedienelemente')).not.toBeInTheDocument();
    expect(screen.queryByText(/•/)).not.toBeInTheDocument();
  });

  it('renders graphical fields help with the per-location edit toggle instead of the obsolete global mode switch', async () => {
    render(<PageHelp pageKey="graphical" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hilfe anzeigen' }));

    expect(await screen.findByText('Aktiviere „Grafik bearbeiten“ bei einem Standort, um dessen Beete und Parzellen zu verschieben und anzuordnen.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Grafik bearbeiten: Beete und Parzellen eines Standorts per Drag-and-Drop verschieben und anordnen')).toBeInTheDocument();
    expect(screen.getByTestId('EditOutlinedIcon')).toBeInTheDocument();
    expect(screen.queryByText('Modus')).not.toBeInTheDocument();
    expect(screen.queryByText('Ansicht')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('renders crops help with vertical more-actions icon and without separate delete symbol', async () => {
    render(<PageHelp pageKey="crops" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hilfe anzeigen' }));

    expect(await screen.findByText('Weitere Aktionen öffnen')).toBeInTheDocument();
    expect(screen.getAllByTestId('MoreVertIcon').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/^•\s*Über\s+erreichst du weitere Aktionen/)).toBeInTheDocument();
    expect(screen.getByText('erreichst du weitere Aktionen wie Versionen, Export oder das Löschen der ausgewählten Kultur.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/⋯/)).not.toBeInTheDocument();
    expect(screen.queryByText('Kultur entfernen')).not.toBeInTheDocument();
    expect(screen.queryByText('Kulturbibliothek öffnen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('PublicIcon')).not.toBeInTheDocument();
    expect(screen.getByText('Entspricht dem aktuellen Stand in der Kulturbibliothek')).toBeInTheDocument();
    expect(screen.getAllByTestId('crop-library-status-circle')).toHaveLength(5);
    expect(screen.getByTestId('PushPinIcon')).toBeInTheDocument();
  });

  it('renders compact calendar help without controls or icon guidance', async () => {
    render(<PageHelp pageKey="calendar" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hilfe anzeigen' }));

    expect(await screen.findByText('Der Anbaukalender visualisiert die zeitliche Planung deiner Anbaupläne. So erkennst du Belegungen, Anzuchtphasen, Erntezeiträume und mögliche Überschneidungen.')).toBeInTheDocument();
    expect(screen.getByText('Fahre über Einträge, um weitere Details anzuzeigen.')).toBeInTheDocument();

    expect(screen.queryByText('Bedienung')).not.toBeInTheDocument();
    expect(screen.queryByText('Zusammenhang mit anderen Seiten')).not.toBeInTheDocument();
    expect(screen.queryByText('Symbole und Bedienelemente')).not.toBeInTheDocument();
    expect(screen.queryByText('Zwischen Ansichten wechseln')).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag & Drop/)).not.toBeInTheDocument();
    expect(screen.queryByText(/•/)).not.toBeInTheDocument();
  });

  it('renders compact seed demand help without supplier or package control guidance', async () => {
    render(<PageHelp pageKey="seedDemand" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hilfe anzeigen' }));

    expect(await screen.findByText('Hier siehst du den berechneten Saatgutbedarf deiner Anbaupläne.')).toBeInTheDocument();

    expect(screen.queryByText('Bedienung')).not.toBeInTheDocument();
    expect(screen.queryByText('Zusammenhang mit anderen Seiten')).not.toBeInTheDocument();
    expect(screen.queryByText('Symbole und Bedienelemente')).not.toBeInTheDocument();
    expect(screen.queryByText('Lieferant pro Kultur festlegen')).not.toBeInTheDocument();
    expect(screen.queryByText('Empfohlene Packungskombinationen prüfen')).not.toBeInTheDocument();
    expect(screen.queryByText(/•/)).not.toBeInTheDocument();
  });

  it('renders compact suppliers help without icon guidance', async () => {
    render(<PageHelp pageKey="suppliers" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hilfe anzeigen' }));

    expect(await screen.findByText('Hier verwaltest du deine Lieferanten.')).toBeInTheDocument();
    expect(screen.getByText('Lieferanten können in Kulturen hinterlegt werden, um kulturspezifische Artikel- und Verpackungsinformationen zu erfassen.')).toBeInTheDocument();

    expect(screen.queryByText('Bedienung')).not.toBeInTheDocument();
    expect(screen.queryByText('Symbole und Bedienelemente')).not.toBeInTheDocument();
    expect(screen.queryByText('Lieferanten hinzufügen')).not.toBeInTheDocument();
    expect(screen.queryByText('Lieferantendaten ändern')).not.toBeInTheDocument();
    expect(screen.queryByText('Lieferanten entfernen')).not.toBeInTheDocument();
    expect(screen.queryByText(/•/)).not.toBeInTheDocument();
  });
});
