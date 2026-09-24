import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { PublicCropSyncFieldChange } from '../api/types';
import { PublicCropSyncPanel } from '../crops/PublicCropSyncPanel';
import { buildDefaultSyncChoices } from '../crops/publicCropSync';

const CHANGES: PublicCropSyncFieldChange[] = [
  { field: 'growth_duration_days', local_value: 60, public_value: 50, pushable: true },
  { field: 'harvest_duration_days', local_value: 20, public_value: 25, pushable: true },
  { field: 'notes', local_value: 'Mein Text', public_value: '', pushable: true },
];

function Harness({
  changes = CHANGES,
  requiresModeration = false,
}: { changes?: PublicCropSyncFieldChange[] | null; requiresModeration?: boolean }) {
  const [choices, setChoices] = useState(() => buildDefaultSyncChoices(changes ?? []));
  return (
    <PublicCropSyncPanel
      changes={changes}
      choices={choices}
      onChoicesChange={setChoices}
      requiresModeration={requiresModeration}
    />
  );
}

const summary = () => screen.getByTestId('public-crop-sync-summary');

describe('PublicCropSyncPanel', () => {
  it('shows both values per differing field and a live summary of the preselection', () => {
    render(<Harness />);

    const row = screen.getByTestId('public-crop-sync-row-growth_duration_days');
    expect(within(row).getByText('Wachstumszeit (Tage)')).toBeInTheDocument();
    expect(within(row).getByText('50')).toBeInTheDocument();
    expect(within(row).getByText('60')).toBeInTheDocument();
    expect(summary()).toHaveTextContent(
      '2 Werte werden in deine Kultur übernommen, 1 Wert wird in der Kulturbibliothek aktualisiert.',
    );
  });

  it('updates the summary when a single choice changes', () => {
    render(<Harness />);

    const row = screen.getByTestId('public-crop-sync-row-growth_duration_days');
    fireEvent.click(within(row).getByRole('button', { name: 'Meinen Wert übernehmen' }));

    expect(summary()).toHaveTextContent(
      '1 Wert wird in deine Kultur übernommen, 2 Werte werden in der Kulturbibliothek aktualisiert.',
    );
  });

  it('hides the part of the summary whose count is zero after a quick action', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Alle aus Bibliothek' }));
    expect(summary()).toHaveTextContent('3 Werte werden in deine Kultur übernommen.');
    expect(summary()).not.toHaveTextContent('Kulturbibliothek');

    fireEvent.click(screen.getByRole('button', { name: 'Alle meine Werte' }));
    expect(summary()).toHaveTextContent('3 Werte werden in der Kulturbibliothek aktualisiert.');
  });

  it('reads as a submission for review when contributions are moderated', () => {
    render(<Harness requiresModeration />);

    expect(summary()).toHaveTextContent('1 Wert wird zur Prüfung eingereicht.');
  });

  it('keeps a field that cannot be pushed on the library side', () => {
    render(<Harness changes={[{ field: 'name', local_value: 'Tomate', public_value: 'Tomato', pushable: false }]} />);

    const row = screen.getByTestId('public-crop-sync-row-name');
    expect(within(row).getByRole('button', { name: 'Meinen Wert übernehmen' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Alle meine Werte' }));
    expect(summary()).toHaveTextContent('1 Wert wird in deine Kultur übernommen.');
  });

  it('shows no choice UI without differences', () => {
    render(<Harness changes={[]} />);

    expect(screen.getByText('Keine Abweichungen zum öffentlichen Eintrag.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alle aus Bibliothek' })).not.toBeInTheDocument();
  });
});
