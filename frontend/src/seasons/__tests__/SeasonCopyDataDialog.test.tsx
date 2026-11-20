import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Season, SeasonCopyPreview } from '../../api/types';
import { SeasonCopyDataDialog } from '../SeasonCopyDataDialog';

const { copyPreviewMock } = vi.hoisted(() => ({ copyPreviewMock: vi.fn() }));
vi.mock('../../api/api', () => ({ seasonAPI: { copyPreview: copyPreviewMock } }));

const emptyPreview: SeasonCopyPreview = {
  total: 3,
  conflict_count: 0,
  hint_count: 0,
  conflict_free_count: 3,
  skipped_count: 0,
  source_season_id: 1,
  source_season_label: '2025',
  items: [],
};

const conflictFinding = {
  kind: 'family_conflict' as const,
  crop_label: 'Brokkoli',
  family_key: 'Brassicaceae',
  family_name: 'Kreuzblütler',
  previous_plan_id: 4,
  previous_crop_label: 'Brokkoli',
  previous_family_name: 'Kreuzblütler',
  year: 2025,
  break_years: 4,
  earliest_year: 2030,
  break_source: 'family_default' as const,
  settings_crop_id: 1,
  settings_crop_label: 'Brokkoli',
};

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

describe('SeasonCopyDataDialog', () => {
  beforeEach(() => {
    copyPreviewMock.mockReset();
    copyPreviewMock.mockResolvedValue({ data: emptyPreview });
  });

  it('waits for the preceding season and explains when it is missing', async () => {
    copyPreviewMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { code: 'season_copy_no_preceding_source' } },
    });
    render(
      <SeasonCopyDataDialog
        open
        targetSeason={targetSeason}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Lege zuerst die fehlende Saison an');
    expect(screen.getByText('Zielsaison')).toBeVisible();
    expect(screen.getByText('2026')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('explains the busy state on both actions while copying', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => new Promise<{ copied_count: number; target_planting_plan_count: number }>(() => undefined));
    render(
      <SeasonCopyDataDialog
        open
        targetSeason={targetSeason}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await screen.findByText('Vorherige Saison', { exact: true });
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    const cancelButton = screen.getByRole('button', { name: 'Abbrechen' });
    await user.hover(cancelButton.parentElement as HTMLElement);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Aktion wird gerade verarbeitet.');
  });

  it('summarizes rotation conflicts and copies them without a bed by default', async () => {
    const user = userEvent.setup();
    copyPreviewMock.mockResolvedValue({
      data: {
        ...emptyPreview,
        conflict_count: 2,
        hint_count: 1,
        conflict_free_count: 1,
        items: [
          { source_plan_id: 1, crop_label: 'Brokkoli', bed_id: 5, bed_name: 'Beet 5', status: 'conflict', findings: [conflictFinding] },
          { source_plan_id: 2, crop_label: 'Kohlrabi', bed_id: 6, bed_name: 'Beet 6', status: 'conflict', findings: [conflictFinding] },
          {
            source_plan_id: 3,
            crop_label: 'Tomate',
            bed_id: 7,
            bed_name: 'Beet 7',
            status: 'hint',
            findings: [{ ...conflictFinding, kind: 'nutrient_hint' as const, previous_crop_label: 'Kürbis' }],
          },
        ],
      },
    });
    const onConfirm = vi.fn().mockResolvedValue({ copied_count: 3, target_planting_plan_count: 3 });
    render(
      <SeasonCopyDataDialog
        open
        targetSeason={targetSeason}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(await screen.findByText('3 Anbaupläne aus Saison 2025 werden auf dieselben Beete übernommen.')).toBeInTheDocument();
    expect(screen.getByText(
      '2 davon verletzen die Fruchtfolge, weil dieselbe Familie im Folgejahr wieder auf demselben Beet stehen würde. 1 weitere haben einen Hinweis zur Nährstofffolge.',
    )).toBeInTheDocument();
    expect(screen.getByText('Was soll mit den 2 Konflikten passieren?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ohne Beet übernehmen/ })).toBeChecked();
    expect(screen.getByText('Nur die 1 konfliktfreien Anbaupläne werden übernommen.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Nicht übernehmen/ }));
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    expect(onConfirm).toHaveBeenCalledWith(2, 1, 'skip');
  });

  it('leaves the rotation section out when nothing conflicts', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ copied_count: 3, target_planting_plan_count: 3 });
    render(
      <SeasonCopyDataDialog
        open
        targetSeason={targetSeason}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await screen.findByText('Vorherige Saison', { exact: true });
    expect(copyPreviewMock).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    expect(screen.queryByTestId('season-copy-rotation-summary')).not.toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledWith(2, 1);
  });

  it('uses the server’s labels and invalidates a preview if the preceding season changes', async () => {
    const user = userEvent.setup();
    const sourceLabel = 'Saison vor dem Umbau des Bewässerungssystems im Gemeinschaftsgarten';
    const targetLabel = 'Lange Zielsaison für die neue Versuchsfläche und den Gemeinschaftsgarten';
    copyPreviewMock.mockResolvedValue({ data: { ...emptyPreview, source_season_label: sourceLabel } });
    const onConfirm = vi.fn().mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { code: 'season_copy_source_not_preceding' } },
    });
    render(
      <SeasonCopyDataDialog open targetSeason={{ ...targetSeason, label: targetLabel }}
        onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    expect(await screen.findByText(sourceLabel, { exact: true })).toBeVisible();
    expect(screen.getByText(targetLabel, { exact: true })).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Die vorherige Saison hat sich geändert.');
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  });
});
