import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosError } from 'axios';
import { SeasonPeriodEditDialog } from '../SeasonPeriodEditDialog';
import type { Season } from '../../api/types';

const season: Season = {
  id: 5,
  project: 1,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  custom_label: '',
  label: '2026',
  computed_label: '2026',
  planting_plan_count: 3,
  created_at: '',
  updated_at: '',
};

describe('SeasonPeriodEditDialog', () => {
  it('prefills the dates, keeps Save disabled until changed, and focuses Cancel', () => {
    render(
      <SeasonPeriodEditDialog open season={season} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(screen.getByLabelText('Startdatum')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('Enddatum')).toHaveValue('2026-12-31');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
  });

  it('saves the edited period and closes', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <SeasonPeriodEditDialog open season={season} onClose={onClose} onConfirm={onConfirm} />,
    );

    const start = screen.getByLabelText('Startdatum');
    await user.clear(start);
    await user.type(start, '2026-03-01');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onConfirm).toHaveBeenCalledWith(5, { start_date: '2026-03-01', end_date: '2026-12-31' });
    expect(onClose).toHaveBeenCalled();
  });

  it('lists the conflicting planting plans returned by the server and stays open', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: ['season_period_edit_conflict'],
          planting_plan_conflicts: [
            { id: '7', label: 'Tomate in Beet A - 2026-02-10', crop: 'Tomate', planting_date: '2026-02-10' },
          ],
          overlap_conflicts: [],
        },
      },
    } as AxiosError);
    const onClose = vi.fn();
    render(
      <SeasonPeriodEditDialog open season={season} onClose={onClose} onConfirm={onConfirm} />,
    );

    const start = screen.getByLabelText('Startdatum');
    await user.clear(start);
    await user.type(start, '2026-06-01');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText(/Tomate – Pflanztermin/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
