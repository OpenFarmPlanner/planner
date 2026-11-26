import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParcelRotationSummary, Season, SeasonCopyPreview } from '../../api/types';
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
const confirmName = /übernehmen$/i;

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
    await user.click(screen.getByRole('button', { name: confirmName }));
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

    expect(screen.getByRole('button', { name: confirmName })).toBeDisabled();
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

    await screen.findByText(/\+ 3 neu = /);
    await user.click(screen.getByRole('button', { name: confirmName }));

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

    expect(await screen.findByText('2 Fruchtfolgeverstöße · 1 Hinweis zur Nährstofffolge')).toBeVisible();
    expect(screen.getAllByText('Kreuzblütler · Zuletzt 2025 · Frühestens wieder 2030')).toHaveLength(2);
    expect(screen.getByText('Brokkoli · Beet 5')).toBeVisible();
    expect(screen.getByText('Was soll mit den 2 Konflikten passieren?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ohne Beet übernehmen/ })).toBeChecked();
    expect(screen.getByText('Nur die 1 konfliktfreien Anbaupläne werden übernommen.')).toBeInTheDocument();
    expect(screen.getByTestId('season-copy-totals')).toHaveTextContent('0 bestehend + 3 neu = 3 Anbaupläne2 davon ohne Beet');
    expect(screen.getByRole('button', { name: '3 Anbaupläne übernehmen' })).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: /Nicht übernehmen/ }));
    expect(await screen.findByText('0 bestehend + 1 neu = 1 Anbauplan')).toBeVisible();
    expect(screen.getByText('2 Konflikte werden nicht übernommen')).toBeVisible();
    expect(copyPreviewMock).toHaveBeenLastCalledWith(2, 1, false, true, 'skip');
    await user.click(screen.getByRole('button', { name: '1 Anbauplan übernehmen' }));

    expect(onConfirm).toHaveBeenCalledWith(2, 1, 'skip', false);
  });

  it('skips an individual bed placement when resolving conflicts without a bed', async () => {
    copyPreviewMock.mockResolvedValue({
      data: {
        ...emptyPreview,
        conflict_count: 2,
        conflict_free_count: 1,
        items: [
          {
            source_plan_id: 1, crop_label: 'Stangenbohne', bed_id: 5, bed_name: 'Beet 5',
            status: 'conflict', requires_bed: true, findings: [conflictFinding],
          },
          {
            source_plan_id: 2, crop_label: 'Karotte', bed_id: 6, bed_name: 'Beet 6',
            status: 'conflict', findings: [conflictFinding],
          },
        ],
      },
    });
    render(<SeasonCopyDataDialog seasons={eligibleSeasons} targetSeason={targetSeason}
      onClose={vi.fn()} onConfirm={vi.fn()} />);

    const totals = await screen.findByTestId('season-copy-totals');
    expect(totals).toHaveTextContent('0 bestehend + 2 neu = 2 Anbaupläne');
    expect(totals).toHaveTextContent('1 davon ohne Beet');
    expect(totals).toHaveTextContent('1 Konflikt wird nicht übernommen');
    expect(screen.getByRole('button', { name: '2 Anbaupläne übernehmen' })).toBeEnabled();
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

    await screen.findByText(/\+ 3 neu = /);
    expect(copyPreviewMock).toHaveBeenCalledWith(2, 1, false, true, 'without_bed');
    await user.click(screen.getByRole('button', { name: confirmName }));

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
    await screen.findByText(/\+ 3 neu = /);
    const confirm = screen.getByRole('button', { name: confirmName });
    const dateBasis = screen.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
    await user.click(dateBasis);
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: 'Ausgangssaison' }));
    const choices = screen.getAllByRole('option');
    expect(choices.map(choice => choice.textContent)).toEqual(['2025', olderSeason.label]);
    await user.click(choices[1]!);
    expect(dateBasis).toBeChecked();
    expect(copyPreviewMock).toHaveBeenLastCalledWith(targetSeason.id, olderSeason.id, true, true, 'without_bed');
    expect(await screen.findByText(/Parzellenrotation ist nur/)).toBeVisible();
    expect(confirm).toBeEnabled();

    await act(async () => respondToActual({ data: { ...emptyPreview, total: 12 } }));
    expect(screen.queryByText(/\+ 12 neu = /)).not.toBeInTheDocument();
    rerender(<SeasonCopyDataDialog seasons={seasons} targetSeason={future} onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.queryByText(/Parzellenrotation ist nur/)).not.toBeInTheDocument();
    expect(confirm).toBeDisabled();
    expect(copyPreviewMock).toHaveBeenLastCalledWith(future.id, olderSeason.id, true, true, 'without_bed');
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

    await screen.findByText(/\+ 3 neu = /);
    expect(screen.getByRole('combobox', { name: 'Ausgangssaison' })).toHaveTextContent('2025');
    await user.click(screen.getByRole('button', { name: confirmName }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Diese Saison ist als Quelle nicht mehr verfügbar.');
    expect(screen.getByRole('button', { name: confirmName })).toBeDisabled();
  });

  it('requires an explicit choice when the reviewed group becomes invalid', async () => {
    const user = userEvent.setup();
    const report: ParcelRotationSummary = {
      available: true, eligible: true, enabled: true, fingerprint: 'a'.repeat(64),
      continuing_count: 0, issues: [], moves: [], mappings: [{
        group: 'Nord–Süd', source_parcel_id: 10, source_parcel: 'Nord',
        target_parcel_id: 11, target_parcel: 'Süd',
      }],
    };
    const invalid: ParcelRotationSummary = {
      ...report, available: false, enabled: false, fingerprint: null, mappings: [],
      issues: [{ code: 'unequal_bed_counts', group: 'Nord–Süd', parcels: [
        { name: 'Nord', count: 1 }, { name: 'Süd', count: 2 },
      ] }],
    };
    copyPreviewMock.mockResolvedValueOnce({ data: { ...emptyPreview, parcel_rotation: report } });
    copyPreviewMock.mockResolvedValue({ data: { ...emptyPreview, parcel_rotation: invalid } });
    const onConfirm = vi.fn().mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { code: 'parcel_rotation_preview_changed' } },
    }).mockResolvedValue({ copied_count: 3, target_planting_plan_count: 3 });
    render(<SeasonCopyDataDialog seasons={eligibleSeasons} targetSeason={targetSeason}
      onClose={vi.fn()} onConfirm={onConfirm} />);

    const checkbox = { name: 'Parzellenrotation anwenden' };
    expect(await screen.findByRole('checkbox', checkbox)).toBeChecked();
    const button = screen.getByRole('button', { name: confirmName });
    await user.click(button);
    expect(await screen.findByText(/brauchen gleich viele Beete/)).toBeVisible();
    expect(button).toBeDisabled();
    expect(screen.getByRole('checkbox', checkbox)).toBeChecked();
    await user.click(screen.getByRole('checkbox', checkbox));
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onConfirm).toHaveBeenLastCalledWith(2, 1, undefined, false);
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
    expect(screen.getByRole('img', { name: /ausgewählten Saison.*bisherige Plantermin/ })).toBeVisible();
    await user.click(checkbox);
    expect(copyPreviewMock).toHaveBeenLastCalledWith(2, 1, true, true, 'without_bed');
    expect(screen.getByRole('button', { name: confirmName })).toBeDisabled();
    expect(screen.queryByText(/\+ 3 neu = /)).not.toBeInTheDocument();
    await user.click(checkbox);
    expect(await screen.findByText(/\+ 5 neu = /)).toBeVisible();

    await act(async () => respondToActual({ data: { ...emptyPreview, total: 2, skipped_count: 1 } }));
    expect(screen.queryByText(/\+ 2 neu = /)).not.toBeInTheDocument();
    expect(screen.queryByText(/passt zeitlich nicht/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: confirmName }));
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
    expect(screen.getByRole('button', { name: confirmName })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(copyPreviewMock).toHaveBeenLastCalledWith(2, 1, true, true, 'without_bed');
    expect(await screen.findByText(/1 Anbauplan passt zeitlich nicht/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: confirmName }));
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
    expect(copyPreviewMock).toHaveBeenLastCalledWith(2, 1, true, true, 'without_bed');
    expect(await screen.findByRole('alert')).toHaveTextContent('Diese Saison ist als Quelle nicht mehr verfügbar.');
    expect(screen.getByRole('button', { name: confirmName })).toBeDisabled();
  });

  it('derives totals, capacity warnings and the confirmation from the effective treatment (#1573)', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 17 }, (_, index) => ({
      source_plan_id: index + 1, crop_label: `Kohl ${index + 1}`, bed_id: index + 1, bed_name: `Beet ${index + 1}`,
      status: 'conflict' as const, findings: [conflictFinding],
    }));
    const findings = { ...emptyPreview, total: 17, conflict_count: 17, conflict_free_count: 0, items } as SeasonCopyPreview;
    const rotation: ParcelRotationSummary = {
      available: true, eligible: true, enabled: true, fingerprint: 'b'.repeat(64), continuing_count: 0,
      unchanged_count: 0, issues: [], moves: [], mappings: [{
        group: 'Nord–Süd', source_parcel_id: 10, source_parcel: 'Nord', target_parcel_id: 11, target_parcel: 'Süd',
      }],
    };
    const blocked: ParcelRotationSummary = {
      ...rotation, available: false, enabled: false, fingerprint: null,
      issues: [1, 2, 3, 4, 5].map(number => ({ code: 'bed_capacity' as const, bed: `Beet ${number}`, parcel: 'Süd' })),
    };
    let respondToKeep: (value: { data: SeasonCopyPreview }) => void = () => undefined;
    copyPreviewMock.mockImplementation((_target, _source, _actual, _rotate, mode) => (mode === 'keep'
      ? new Promise(resolve => { respondToKeep = resolve; })
      : Promise.resolve({ data: { ...findings, parcel_rotation: rotation } })));
    const onConfirm = vi.fn().mockResolvedValue({ copied_count: 17, target_planting_plan_count: 37 });
    render(<SeasonCopyDataDialog seasons={eligibleSeasons} targetSeason={{ ...targetSeason, planting_plan_count: 20 }}
      onClose={vi.fn()} onConfirm={onConfirm} />);

    expect(await screen.findByText('17 Fruchtfolgeverstöße')).toBeVisible();
    const totals = screen.getByTestId('season-copy-totals');
    expect(totals).toHaveTextContent('20 bestehend + 17 neu = 37 Anbaupläne');
    expect(totals).toHaveTextContent('17 davon ohne Beet');
    expect(totals).toHaveTextContent('Die 20 bestehenden Anbaupläne bleiben unverändert.');
    expect(screen.queryByTestId('parcel-rotation-issues')).not.toBeInTheDocument();
    expect(screen.getByText('Kohl 3 · Beet 3')).toBeVisible();
    expect(screen.getByText('Kohl 4 · Beet 4')).not.toBeVisible();
    expect(screen.getByText('Kohl 17 · Beet 17')).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: '14 weitere anzeigen' }));
    expect(screen.getByText('Kohl 17 · Beet 17')).toBeVisible();

    await user.click(screen.getByRole('radio', { name: /Vorgeschlagene Beete beibehalten/ }));
    expect(screen.getByText('17 Fruchtfolgeverstöße')).toBeVisible();
    expect(screen.getByRole('radio', { name: /Vorgeschlagene Beete beibehalten/ })).toBeChecked();
    expect(screen.queryByTestId('season-copy-totals')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: confirmName })).toBeDisabled();
    await act(async () => respondToKeep({ data: { ...findings, parcel_rotation: blocked } }));
    expect(screen.getByTestId('parcel-rotation-issues')).toHaveTextContent('Parzellenrotation nicht möglich: 5 Probleme');
    expect(screen.getByTestId('season-copy-totals')).toHaveTextContent('20 bestehend + 17 neu = 37 Anbaupläne');

    await user.click(screen.getByRole('radio', { name: /Nicht übernehmen/ }));
    expect(await screen.findByText('20 bestehend + 0 neu = 20 Anbaupläne')).toBeVisible();
    expect(screen.queryByTestId('parcel-rotation-issues')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Ohne Beet übernehmen/ }));
    await user.click(await screen.findByRole('button', { name: '17 Anbaupläne übernehmen' }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(2, 1, 'without_bed', false, {
      rotate_parcels: true, parcel_rotation_fingerprint: 'b'.repeat(64),
    });
  });
});
