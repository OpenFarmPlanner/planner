import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonSetupDialog } from '../SeasonSetupDialog';
import type { SeasonSetupStatus } from '../../api/types';

const { statusMock, applyMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  applyMock: vi.fn(),
}));

vi.mock('../../api/api', async () => {
  const actual = await vi.importActual<typeof import('../../api/api')>('../../api/api');
  return {
    ...actual,
    seasonSetupAPI: {
      status: statusMock,
      apply: applyMock,
    },
  };
});

const baseStatus: SeasonSetupStatus = {
  needs_setup: true,
  unassigned_planting_plan_count: 3,
  start_day: 1,
  start_month: 1,
  computed_start_date: '2026-01-01',
  computed_end_date: '2026-12-31',
};

describe('SeasonSetupDialog', () => {
  beforeEach(() => {
    statusMock.mockReset().mockResolvedValue({ data: baseStatus });
    applyMock.mockReset();
  });

  it('shows the initially-fetched target period', () => {
    render(<SeasonSetupDialog open status={baseStatus} onApplied={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/1\.1\.2026 – 31\.12\.2026/)).toBeInTheDocument();
  });

  it('re-fetches and shows the recomputed period when the month selection changes', async () => {
    statusMock.mockResolvedValue({
      data: { ...baseStatus, computed_start_date: '2025-09-01', computed_end_date: '2026-08-31' },
    });
    const user = userEvent.setup();

    render(<SeasonSetupDialog open status={baseStatus} onApplied={vi.fn()} onCancel={vi.fn()} />);

    // Before any change, the dialog shows the period it was opened with.
    expect(screen.getByText(/1\.1\.2026 – 31\.12\.2026/)).toBeInTheDocument();

    const monthField = screen.getByLabelText('Jährlicher Saisonbeginn');
    await user.click(monthField);
    await user.click(screen.getByRole('option', { name: 'September' }));

    await waitFor(() => expect(statusMock).toHaveBeenCalledWith({ start_day: 1, start_month: 9 }));
    await waitFor(() => expect(screen.getByText(/1\.9\.2025 – 31\.8\.2026/)).toBeInTheDocument());
  });

  it('submits the persisted start_day/start_month on Einrichten', async () => {
    applyMock.mockResolvedValue({ data: { season: { id: 7 }, assigned_planting_plan_count: 3, start_day: 1, start_month: 1 } });
    const onApplied = vi.fn();
    const user = userEvent.setup();

    render(<SeasonSetupDialog open status={baseStatus} onApplied={onApplied} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));

    await waitFor(() => expect(applyMock).toHaveBeenCalledWith({ start_day: 1, start_month: 1 }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(7));
  });

  it('keeps a legacy day for assignment until the new month-only pattern is chosen', async () => {
    const legacy = { ...baseStatus, start_day: 19, start_month: 10 };
    applyMock.mockResolvedValue({ data: { season: { id: 7 } } });
    const user = userEvent.setup();
    render(<SeasonSetupDialog open status={legacy} onApplied={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/gespeicherte Saisonbeginn ist Tag 19 im Oktober/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));
    expect(applyMock).toHaveBeenLastCalledWith({ start_day: 19, start_month: 10 });

    await user.click(screen.getByRole('button', { name: 'Monatsersten verwenden' }));
    await waitFor(() => expect(statusMock).toHaveBeenLastCalledWith({ start_day: 1, start_month: 10 }));
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));
    expect(applyMock).toHaveBeenLastCalledWith({ start_day: 1, start_month: 10 });
  });
});
