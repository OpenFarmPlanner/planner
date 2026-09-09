import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Season } from '../../api/types';
import { SeasonCopyDataDialog } from '../SeasonCopyDataDialog';

const targetSeason: Season = {
  id: 2,
  project: 1,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  custom_label: '',
  label: '2026',
  computed_label: '2026',
  planting_plan_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const sourceSeason: Season = {
  ...targetSeason,
  id: 1,
  start_date: '2025-01-01',
  end_date: '2025-12-31',
  label: '2025',
  computed_label: '2025',
};

describe('SeasonCopyDataDialog', () => {
  it('explains why confirmation is disabled before a source is selected', async () => {
    const user = userEvent.setup();
    render(
      <SeasonCopyDataDialog
        open
        targetSeason={targetSeason}
        seasons={[sourceSeason, targetSeason]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Übernehmen' });
    await user.hover(confirmButton.parentElement as HTMLElement);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bitte zuerst eine Quellsaison auswählen.');
  });

  it('explains the busy state on both actions while copying', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => new Promise<{ copied_count: number; target_planting_plan_count: number }>(() => undefined));
    render(
      <SeasonCopyDataDialog
        open
        targetSeason={targetSeason}
        seasons={[sourceSeason, targetSeason]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByLabelText('Quelle'));
    await user.click(screen.getByRole('option', { name: '2025' }));
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    const cancelButton = screen.getByRole('button', { name: 'Abbrechen' });
    await user.hover(cancelButton.parentElement as HTMLElement);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Aktion wird gerade verarbeitet.');
  });
});
