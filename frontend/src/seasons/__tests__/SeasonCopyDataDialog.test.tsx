import { act, render, screen } from '@testing-library/react';
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
  is_preceding_source: true,
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

const sourceSeason: Season = {
  ...targetSeason, id: 1, label: '2025', start_date: '2025-01-01', end_date: '2025-12-31',
};
const olderSeason: Season = {
  ...sourceSeason, id: 4, label: 'Saison vor dem Umbau des Bewässerungssystems im Gemeinschaftsgarten',
  start_date: '2023-09-01', end_date: '2024-08-31',
};
const eligibleSeasons = [sourceSeason, targetSeason];

describe('SeasonCopyDataDialog', () => {
  beforeEach(() => {
    copyPreviewMock.mockReset();
    copyPreviewMock.mockResolvedValue({ data: emptyPreview });
  });

  it('keeps continuing plans explained when switching to actual dates', async () => {
    const user = userEvent.setup();
    copyPreviewMock.mockResolvedValue({
      data: { ...emptyPreview, total: 1, conflict_free_count: 1, continuing_count: 1 },
    });
    const onConfirm = vi.fn().mockResolvedValue({ copied_count: 1, target_planting_plan_count: 1 });
    render(<SeasonCopyDataDialog seasons={eligibleSeasons} targetSeason={targetSeason} onClose={vi.fn()} onConfirm={onConfirm} />);

    const message = '1 Anbauplan läuft weiter und bleibt in seiner ursprünglichen Saison.';
    expect(await screen.findByText(message)).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' }));
    expect(await screen.findByText(message)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onConfirm).toHaveBeenCalledWith(2, 1, undefined, true);
  });

  it('explains when there is no earlier season and does not request a preview', () => {
    render(
      <SeasonCopyDataDialog
        seasons={[targetSeason]}
        targetSeason={targetSeason}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Es gibt keine frühere Saison');
    expect(screen.getByText('Zielsaison')).toBeVisible();
    expect(screen.getByText('2026')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(copyPreviewMock).not.toHaveBeenCalled();
  });

  it('explains the busy state on both actions while copying', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => new Promise<{ copied_count: number; target_planting_plan_count: number }>(() => undefined));
    render(
      <SeasonCopyDataDialog
        seasons={eligibleSeasons}
        targetSeason={targetSeason}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await screen.findByText(/3 Anbaupläne werden übernommen/);
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
        seasons={eligibleSeasons}
        targetSeason={targetSeason}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(await screen.findByText('3 Anbaupläne aus Saison 2025 werden auf dieselben Beete übernommen.')).toBeInTheDocument();
    expect(screen.getByText(
      '2 davon verletzen die Fruchtfolge, weil dieselbe Familie in der Zielsaison wieder auf demselben Beet stehen würde. 1 weitere haben einen Hinweis zur Nährstofffolge.',
    )).toBeInTheDocument();
    expect(screen.getByText('Was soll mit den 2 Konflikten passieren?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ohne Beet übernehmen/ })).toBeChecked();
    expect(screen.getByText('Nur die 1 konfliktfreien Anbaupläne werden übernommen.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Nicht übernehmen/ }));
    expect(screen.getByText('1 Anbauplan wird übernommen. Danach sind es insgesamt 1.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    expect(onConfirm).toHaveBeenCalledWith(2, 1, 'skip', false);
  });

  it('leaves the rotation section out when nothing conflicts', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ copied_count: 3, target_planting_plan_count: 3 });
    render(
      <SeasonCopyDataDialog
        seasons={eligibleSeasons}
        targetSeason={targetSeason}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await screen.findByText(/3 Anbaupläne werden übernommen/);
    expect(copyPreviewMock).toHaveBeenCalledWith(2, 1, false, true);
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    expect(screen.queryByTestId('season-copy-rotation-summary')).not.toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledWith(2, 1, undefined, false);
  });

  it('lists only earlier project seasons newest first and invalidates superseded source and target previews', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ copied_count: 1, target_planting_plan_count: 1 });
    const future: Season = {
      ...targetSeason, id: 5, label: '2028', start_date: '2028-01-01', end_date: '2028-12-31',
    };
    const foreign = { ...olderSeason, id: 6, project: 8, label: 'Anderes Projekt' };
    const seasons = [olderSeason, foreign, future, ...eligibleSeasons];
    const historicalPreview = {
      ...emptyPreview, source_season_id: olderSeason.id, source_season_label: olderSeason.label,
      total: 1, is_preceding_source: false,
    };
    let respondToActual: (value: { data: SeasonCopyPreview }) => void = () => undefined;
    let respondToNewTarget: (value: { data: SeasonCopyPreview }) => void = () => undefined;
    copyPreviewMock.mockResolvedValueOnce({ data: emptyPreview });
    copyPreviewMock.mockImplementationOnce(() => new Promise(resolve => { respondToActual = resolve; }));
    copyPreviewMock.mockResolvedValueOnce({ data: historicalPreview });
    copyPreviewMock.mockImplementationOnce(() => new Promise(resolve => { respondToNewTarget = resolve; }));

    const { rerender } = render(
      <SeasonCopyDataDialog seasons={seasons} targetSeason={targetSeason} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    await screen.findByText(/3 Anbaupläne werden übernommen/);
    const confirm = screen.getByRole('button', { name: 'Übernehmen' });
    const dateBasis = screen.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
    await user.click(dateBasis);
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: 'Ausgangssaison' }));
    const choices = screen.getAllByRole('option');
    expect(choices.map(choice => choice.textContent)).toEqual(['2025', olderSeason.label]);
    await user.click(choices[1]!);
    expect(dateBasis).toBeChecked();
    expect(copyPreviewMock).toHaveBeenLastCalledWith(targetSeason.id, olderSeason.id, true, true);
    expect(await screen.findByText(/Parzellenrotation ist nur/)).toBeVisible();
    expect(confirm).toBeEnabled();

    await act(async () => respondToActual({ data: { ...emptyPreview, total: 12 } }));
    expect(screen.queryByText(/12 Anbaupläne werden übernommen/)).not.toBeInTheDocument();
    rerender(<SeasonCopyDataDialog seasons={seasons} targetSeason={future} onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.queryByText(/Parzellenrotation ist nur/)).not.toBeInTheDocument();
    expect(confirm).toBeDisabled();
    expect(copyPreviewMock).toHaveBeenLastCalledWith(future.id, olderSeason.id, true, true);
    await act(async () => respondToNewTarget({ data: historicalPreview }));
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(future.id, olderSeason.id, undefined, true);
  });

  it('invalidates the current preview when a selected source becomes unavailable', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { code: 'season_copy_source_not_earlier' } },
    });
    render(<SeasonCopyDataDialog seasons={eligibleSeasons} targetSeason={targetSeason}
      onClose={vi.fn()} onConfirm={onConfirm} />);

    await screen.findByText(/3 Anbaupläne werden übernommen/);
    expect(screen.getByRole('combobox', { name: 'Ausgangssaison' })).toHaveTextContent('2025');
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Diese Saison ist als Quelle nicht mehr verfügbar.');
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  });

  it('loads only the latest date basis when the option changes quickly', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ copied_count: 3, target_planting_plan_count: 3 });
    let respondToActual: (value: { data: SeasonCopyPreview }) => void = () => undefined;
    copyPreviewMock.mockResolvedValueOnce({ data: emptyPreview });
    copyPreviewMock.mockImplementationOnce(() => new Promise(resolve => { respondToActual = resolve; }));
    copyPreviewMock.mockResolvedValueOnce({ data: { ...emptyPreview, total: 5 } });
    render(<SeasonCopyDataDialog seasons={eligibleSeasons} targetSeason={targetSeason} onClose={vi.fn()} onConfirm={onConfirm} />);

    const checkbox = await screen.findByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAccessibleDescription(/ausgewählten Saison.*bisherige Plantermin/);
    await user.click(checkbox);
    expect(copyPreviewMock).toHaveBeenLastCalledWith(2, 1, true, true);
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    expect(screen.queryByText(/3 Anbaupläne werden übernommen/)).not.toBeInTheDocument();
    await user.click(checkbox);
    expect(await screen.findByText(/5 Anbaupläne werden übernommen/)).toBeVisible();

    await act(async () => respondToActual({ data: { ...emptyPreview, total: 2, skipped_count: 1 } }));
    expect(screen.queryByText(/2 Anbaupläne werden übernommen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/passt zeitlich nicht/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(2, 1, undefined, false);
  });

  it('preserves the date basis across a recoverable preview error and sends it after retry', async () => {
    const user = userEvent.setup();
    copyPreviewMock.mockResolvedValueOnce({ data: emptyPreview });
    copyPreviewMock.mockRejectedValueOnce(new Error('temporary network error'));
    copyPreviewMock.mockResolvedValueOnce({ data: { ...emptyPreview, total: 2, skipped_count: 1 } });
    const onConfirm = vi.fn().mockResolvedValue({ copied_count: 2, target_planting_plan_count: 2 });
    render(<SeasonCopyDataDialog seasons={eligibleSeasons} targetSeason={targetSeason} onClose={vi.fn()} onConfirm={onConfirm} />);

    const checkbox = await screen.findByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
    await user.click(checkbox);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(checkbox).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Ausgangssaison' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(copyPreviewMock).toHaveBeenLastCalledWith(2, 1, true, true);
    expect(await screen.findByText(/1 Anbauplan passt zeitlich nicht/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onConfirm).toHaveBeenCalledWith(2, 1, undefined, true);
  });

  it('keeps the original source when changing the date basis', async () => {
    const user = userEvent.setup();
    copyPreviewMock.mockResolvedValueOnce({ data: emptyPreview });
    copyPreviewMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { code: 'season_copy_source_not_earlier' } },
    });
    render(<SeasonCopyDataDialog seasons={eligibleSeasons} targetSeason={targetSeason} onClose={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' }));
    expect(copyPreviewMock).toHaveBeenLastCalledWith(2, 1, true, true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Diese Saison ist als Quelle nicht mehr verfügbar.');
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  });
});
