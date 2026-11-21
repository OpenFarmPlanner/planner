import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosError } from 'axios';
import { SeasonCreateSuggestionDialog, SeasonSwitcher } from '../SeasonSwitcher';
import type { Season, SeasonCreationOptions } from '../../api/types';
import type { UseActiveSeasonReturn } from '../useActiveSeason';

const { creationOptionsMock } = vi.hoisted(() => ({ creationOptionsMock: vi.fn() }));
vi.mock('../../api/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/api')>();
  return {
    ...actual,
    seasonAPI: { ...actual.seasonAPI, creationOptions: creationOptionsMock },
  };
});

const seasons: Season[] = [
  {
    id: 2,
    project: 1,
    start_date: '2025-09-01',
    end_date: '2026-08-31',
    custom_label: '',
    label: '25/26',
    computed_label: '25/26',
    planting_plan_count: 0,
    created_at: '',
    updated_at: '',
  },
  {
    id: 1,
    project: 1,
    start_date: '2024-09-01',
    end_date: '2025-08-31',
    custom_label: '',
    label: '24/25',
    computed_label: '24/25',
    planting_plan_count: 0,
    created_at: '',
    updated_at: '',
  },
];

const consecutiveCreationOptions: SeasonCreationOptions = {
  start_day: 1,
  start_month: 9,
  last_season: seasons[0],
  due_period: { start_date: '2026-09-01', end_date: '2027-08-31' },
  transition: null,
  seamless_period: null,
  manual_period: null,
  manual_residual: null,
  copy_source_season_id: 2,
  copy_source_label: '25/26',
  copy_preview: { adopt: { total: 0, copied: 0, skipped: 0 }, transition: null, transition_followup: null, manual: null },
};

describe('SeasonSwitcher', () => {
  it('offers and creates the season following the latest existing season', async () => {
    const user = userEvent.setup();
    const createSeason = vi.fn().mockResolvedValue({ ...seasons[0], id: 3, label: '26/27' });
    const switchSeason = vi.fn();
    const controller = {
      seasons,
      activeSeason: seasons[1],
      dueSuggestion: {
        due: true,
        start_date: '2026-09-01',
        end_date: '2027-08-31',
      },
      seasonCreationOptions: consecutiveCreationOptions,
      pendingDeletions: [],
      createSeason,
      switchSeason,
      renameSeason: vi.fn(),
      copyDataInto: vi.fn(),
      deleteSeason: vi.fn(),
      undoPendingDeletion: vi.fn(),
      closePendingDeletionSnackbar: vi.fn(),
    } as unknown as UseActiveSeasonReturn;
    const onOpenCreateSuggestion = vi.fn();

    render(
      <SeasonSwitcher
        controller={controller}
        onOpenProjectSettings={vi.fn()}
        onOpenCreateSuggestion={onOpenCreateSuggestion}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Aktive Saison wechseln' }));
    expect(screen.getByText('Saison 26/27 anlegen')).toBeInTheDocument();
    expect(screen.getByText('1.9.2026 – 31.8.2027')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(onOpenCreateSuggestion).toHaveBeenCalledTimes(1);
    render(
      <SeasonCreateSuggestionDialog
        controller={controller}
        open
        onClose={vi.fn()}
        onEditSeasonPattern={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Saison 26/27 anlegen?' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Daten aus Saison 25\/26 übernehmen/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(createSeason).toHaveBeenCalledWith('2026-09-01', '2027-08-31', 2);
    expect(switchSeason).toHaveBeenCalledWith(3);
  });

  it('creates the suggested season without copying when the dialog option is unchecked', async () => {
    const user = userEvent.setup();
    const createSeason = vi.fn().mockResolvedValue({ ...seasons[0], id: 3, label: '26/27' });
    const controller = {
      seasons,
      activeSeason: seasons[0],
      dueSuggestion: {
        due: true,
        start_date: '2026-09-01',
        end_date: '2027-08-31',
      },
      seasonCreationOptions: consecutiveCreationOptions,
      pendingDeletions: [],
      createSeason,
      switchSeason: vi.fn(),
      renameSeason: vi.fn(),
      copyDataInto: vi.fn(),
      deleteSeason: vi.fn(),
      undoPendingDeletion: vi.fn(),
      closePendingDeletionSnackbar: vi.fn(),
    } as unknown as UseActiveSeasonReturn;

    render(
      <SeasonCreateSuggestionDialog
        controller={controller}
        open
        onClose={vi.fn()}
        onEditSeasonPattern={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /Daten aus Saison 25\/26 übernehmen/ }));
    expect(screen.queryByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(createSeason).toHaveBeenCalledWith('2026-09-01', '2027-08-31', undefined);
  });

  it('waits for the current basis preview and ignores an older actual-date response', async () => {
    const user = userEvent.setup();
    const createSeason = vi.fn().mockResolvedValue({ ...seasons[0], id: 3 });
    const controller = {
      seasons,
      dueSuggestion: { due: true, start_date: '2026-09-01', end_date: '2027-08-31' },
      seasonCreationOptions: consecutiveCreationOptions,
      createSeason,
      switchSeason: vi.fn(),
    } as unknown as UseActiveSeasonReturn;
    const loadPreview = () => {
      let finish!: (value: { data: SeasonCreationOptions }) => void;
      const promise = new Promise<{ data: SeasonCreationOptions }>(resolve => { finish = resolve; });
      return { promise, finish };
    };
    const old = loadPreview();
    const latest = loadPreview();
    creationOptionsMock.mockReset()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    render(<SeasonCreateSuggestionDialog controller={controller} open onClose={vi.fn()} onEditSeasonPattern={vi.fn()} />);

    const basis = screen.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
    const submit = screen.getByRole('button', { name: 'Anlegen' });
    expect(basis).toHaveAccessibleDescription(/vorherigen Saison.*Plantermin/);
    await user.click(basis);
    expect(submit).toBeDisabled();
    await user.click(basis);
    expect(submit).toBeEnabled();
    await user.click(basis);
    expect(submit).toBeDisabled();
    expect(creationOptionsMock).toHaveBeenCalledTimes(2);
    expect(creationOptionsMock).toHaveBeenLastCalledWith({ use_actual_dates: true });
    const response = (copied: number) => ({
      data: {
        ...consecutiveCreationOptions,
        copy_preview: { ...consecutiveCreationOptions.copy_preview, adopt: { total: 3, copied, skipped: 3 - copied } },
      },
    });
    await act(async () => latest.finish(response(2)));
    expect(screen.getByText(/2 von 3 Anbauplänen/)).toBeInTheDocument();
    await act(async () => old.finish(response(1)));
    expect(screen.getByText(/2 von 3 Anbauplänen/)).toBeInTheDocument();
    await user.click(submit);
    expect(createSeason).toHaveBeenCalledExactlyOnceWith('2026-09-01', '2027-08-31', 2, true);
  });

  it('keeps the create dialog open and shows a concrete conflict reason when creation fails', async () => {
    const user = userEvent.setup();
    const createSeason = vi.fn().mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: 'season_unassigned_data_outside_period',
          conflict_count: '1',
          conflicts: [{ label: 'Tomate in Beet A - 2026-12-15' }],
        },
      },
    } as AxiosError);
    const onClose = vi.fn();
    const switchSeason = vi.fn();
    const controller = {
      seasons: [],
      activeSeason: null,
      dueSuggestion: {
        due: true,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      },
      pendingDeletions: [],
      createSeason,
      switchSeason,
      renameSeason: vi.fn(),
      copyDataInto: vi.fn(),
      deleteSeason: vi.fn(),
      undoPendingDeletion: vi.fn(),
      closePendingDeletionSnackbar: vi.fn(),
    } as unknown as UseActiveSeasonReturn;

    render(
      <SeasonCreateSuggestionDialog
        controller={controller}
        open
        onClose={onClose}
        onEditSeasonPattern={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByText(/Tomate in Beet A/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saison 2026 anlegen?' })).toBeInTheDocument();
    expect(createSeason).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(switchSeason).not.toHaveBeenCalled();
  });

  it('can create a season without offering a copy across a missing annual period', async () => {
    const user = userEvent.setup();
    const createSeason = vi.fn().mockResolvedValue({ ...seasons[0], id: 5 });
    const controller = {
      seasons,
      activeSeason: seasons[0],
      dueSuggestion: { due: true, start_date: '2027-09-01', end_date: '2028-08-31' },
      seasonCreationOptions: {
        ...consecutiveCreationOptions,
        due_period: { start_date: '2027-09-01', end_date: '2028-08-31' },
        copy_source_season_id: null,
        copy_source_label: null,
        copy_preview: { adopt: null, transition: null, transition_followup: null, manual: null },
      },
      createSeason,
      switchSeason: vi.fn(),
    } as unknown as UseActiveSeasonReturn;
    render(<SeasonCreateSuggestionDialog controller={controller} open onClose={vi.fn()} onEditSeasonPattern={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Es gibt keine unmittelbar vorherige Saison');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(createSeason).toHaveBeenCalledWith('2027-09-01', '2028-08-31', undefined);
  });

  it('requires an explicit gap decision and creates two seasons for the transition option', async () => {
    const user = userEvent.setup();
    const createSeason = vi.fn();
    const createTransitionSeasons = vi.fn().mockResolvedValue({
      transition_season: { ...seasons[0], id: 3, label: '26' },
      followup_season: { ...seasons[0], id: 4, label: '2027' },
      transition_copied_count: 4,
      followup_copied_count: 8,
      skipped_count: 0,
    });
    const switchSeason = vi.fn();
    const controller = {
      seasons,
      activeSeason: seasons[0],
      createTransitionSeasons,
      dueSuggestion: { due: true, start_date: '2027-01-01', end_date: '2027-12-31' },
      seasonCreationOptions: {
        start_day: 1,
        start_month: 1,
        last_season: { start_date: '2025-09-01', end_date: '2026-08-31', label: '25/26' },
        due_period: { start_date: '2027-01-01', end_date: '2027-12-31' },
        transition: { kind: 'gap', start_date: '2026-09-01', end_date: '2026-12-31' },
        seamless_period: { start_date: '2026-09-01', end_date: '2026-12-31' },
        manual_period: null,
        manual_residual: null,
        copy_source_season_id: 2,
        copy_source_label: '25/26',
        copy_preview: {
          adopt: { total: 3, copied: 2, skipped: 1 },
          transition: { total: 3, copied: 2, skipped: 1 },
          transition_followup: { total: 2, copied: 2, skipped: 0 },
          manual: null,
        },
      },
      pendingDeletions: [],
      createSeason,
      switchSeason,
      renameSeason: vi.fn(),
      copyDataInto: vi.fn(),
      deleteSeason: vi.fn(),
      undoPendingDeletion: vi.fn(),
      closePendingDeletionSnackbar: vi.fn(),
    } as unknown as UseActiveSeasonReturn;

    render(
      <SeasonCreateSuggestionDialog
        controller={controller}
        open
        onClose={vi.fn()}
        onEditSeasonPattern={vi.fn()}
      />,
    );

    expect(screen.getByText(/liegt eine Lücke/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Übergangssaison anlegen/ }));
    expect(screen.getByText(/Es werden zwei Saisonen angelegt/)).toBeInTheDocument();
    expect(screen.getByText(/2 von 3 Anbauplänen aus 25\/26 werden übernommen/)).toBeInTheDocument();

    creationOptionsMock.mockResolvedValueOnce({ data: controller.seasonCreationOptions });
    await user.click(screen.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' }));
    expect(await screen.findByText(/2 von 3 Anbauplänen aus 25\/26 werden übernommen/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(createTransitionSeasons).toHaveBeenCalledWith(true, 2, true);
    expect(createSeason).not.toHaveBeenCalled();
    expect(switchSeason).toHaveBeenCalledWith(4);
  });

  it('previews the copy split for a manually chosen start date and creates one season', async () => {
    const user = userEvent.setup();
    creationOptionsMock.mockResolvedValue({
      data: {
        copy_source_season_id: 2,
        copy_source_label: '25/26',
        copy_preview: { manual: { total: 4, copied: 1, skipped: 3 } },
      },
    });
    const createSeason = vi.fn().mockResolvedValue({ ...seasons[0], id: 9, label: '2026' });
    const switchSeason = vi.fn();
    const controller = {
      seasons,
      activeSeason: seasons[0],
      dueSuggestion: { due: true, start_date: '2027-01-01', end_date: '2027-12-31' },
      seasonCreationOptions: {
        start_day: 1,
        start_month: 1,
        last_season: { start_date: '2025-09-01', end_date: '2026-08-31', label: '25/26' },
        due_period: { start_date: '2027-01-01', end_date: '2027-12-31' },
        transition: { kind: 'gap', start_date: '2026-09-01', end_date: '2026-12-31' },
        seamless_period: { start_date: '2026-09-01', end_date: '2026-12-31' },
        manual_period: null,
        manual_residual: null,
        copy_source_season_id: 2,
        copy_source_label: '25/26',
        copy_preview: { adopt: null, transition: null, transition_followup: null, manual: null },
      },
      pendingDeletions: [],
      createSeason,
      switchSeason,
      renameSeason: vi.fn(),
      copyDataInto: vi.fn(),
      deleteSeason: vi.fn(),
      undoPendingDeletion: vi.fn(),
      closePendingDeletionSnackbar: vi.fn(),
    } as unknown as UseActiveSeasonReturn;

    render(
      <SeasonCreateSuggestionDialog
        controller={controller}
        open
        onClose={vi.fn()}
        onEditSeasonPattern={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /Startdatum manuell anpassen/ }));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    // Prefilled with the date that closes the gap; the user overrides it here.
    expect(dateInput.value).toBe('2026-09-01');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-10-01');

    expect(await screen.findByText(/1 von 4 Anbauplänen aus 25\/26 werden übernommen/)).toBeInTheDocument();
    expect(creationOptionsMock).toHaveBeenCalledWith({ manual_start_date: '2026-10-01' });
    const basis = screen.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
    await user.click(basis);
    expect(await screen.findByText(/1 von 4 Anbauplänen aus 25\/26 werden übernommen/)).toBeInTheDocument();
    expect(creationOptionsMock).toHaveBeenLastCalledWith({ manual_start_date: '2026-10-01', use_actual_dates: true });

    creationOptionsMock.mockRejectedValueOnce(new Error('Preview request failed'));
    await user.click(basis);
    expect(await screen.findByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Daten aus Saison 25\/26 übernehmen/ })).toBeChecked();
    const create = screen.getByRole('button', { name: 'Anlegen' });
    expect(create).toBeDisabled();
    await user.click(create);
    expect(createSeason).not.toHaveBeenCalled();
    await user.click(basis);
    expect(await screen.findByText(/1 von 4 Anbauplänen aus 25\/26 werden übernommen/)).toBeInTheDocument();

    await user.click(create);
    expect(createSeason).toHaveBeenCalledTimes(1);
    expect(createSeason).toHaveBeenCalledWith('2026-10-01', '2027-12-31', 2, true);
    expect(switchSeason).toHaveBeenCalledWith(9);
  });

  it.each([
    {
      kind: 'gap' as const,
      transition: { kind: 'gap' as const, start_date: '2026-09-01', end_date: '2026-12-31' },
      duePeriod: { start_date: '2027-01-01', end_date: '2027-12-31' },
      dueSuggestion: { due: true, start_date: '2027-01-01', end_date: '2027-12-31' },
      confirmation: 'Die Lücke wird vollständig geschlossen.',
    },
    {
      kind: 'overlap' as const,
      transition: { kind: 'overlap' as const, start_date: '2026-01-01', end_date: '2026-08-31' },
      duePeriod: { start_date: '2026-01-01', end_date: '2026-12-31' },
      dueSuggestion: { due: true, start_date: '2026-01-01', end_date: '2026-12-31' },
      confirmation: 'Die Überlappung wird vollständig vermieden.',
    },
  ])('prefills the manual start date with the seamless date ($kind)', async ({
    transition, duePeriod, dueSuggestion, confirmation,
  }) => {
    const user = userEvent.setup();
    creationOptionsMock.mockResolvedValue({
      data: {
        copy_source_season_id: 2,
        copy_source_label: '25/26',
        copy_preview: { manual: { total: 3, copied: 3, skipped: 0 } },
      },
    });
    const createSeason = vi.fn().mockResolvedValue({ ...seasons[0], id: 9, label: '2026' });
    const controller = {
      seasons,
      activeSeason: seasons[0],
      dueSuggestion,
      seasonCreationOptions: {
        start_day: 1,
        start_month: 1,
        last_season: { start_date: '2025-09-01', end_date: '2026-08-31', label: '25/26' },
        due_period: duePeriod,
        transition,
        seamless_period: { start_date: '2026-09-01', end_date: '2026-12-31' },
        manual_period: null,
        manual_residual: null,
        copy_source_season_id: 2,
        copy_source_label: '25/26',
        copy_preview: { adopt: null, transition: null, transition_followup: null, manual: null },
      },
      pendingDeletions: [],
      createSeason,
      switchSeason: vi.fn(),
      renameSeason: vi.fn(),
      copyDataInto: vi.fn(),
      deleteSeason: vi.fn(),
      undoPendingDeletion: vi.fn(),
      closePendingDeletionSnackbar: vi.fn(),
    } as unknown as UseActiveSeasonReturn;

    render(
      <SeasonCreateSuggestionDialog
        controller={controller}
        open
        onClose={vi.fn()}
        onEditSeasonPattern={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /Startdatum manuell anpassen/ }));

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-09-01');
    expect(screen.getByText(confirmation)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(createSeason).toHaveBeenCalledWith('2026-09-01', '2027-12-31', 2);
  });

  it('links from the create dialog to the season-pattern settings without creating a season', async () => {
    const user = userEvent.setup();
    const createSeason = vi.fn();
    const onClose = vi.fn();
    const onEditSeasonPattern = vi.fn();
    const controller = {
      seasons: [],
      activeSeason: null,
      dueSuggestion: { due: true, start_date: '2026-01-01', end_date: '2026-12-31' },
      pendingDeletions: [],
      createSeason,
      switchSeason: vi.fn(),
      renameSeason: vi.fn(),
      copyDataInto: vi.fn(),
      deleteSeason: vi.fn(),
      undoPendingDeletion: vi.fn(),
      closePendingDeletionSnackbar: vi.fn(),
    } as unknown as UseActiveSeasonReturn;

    render(
      <SeasonCreateSuggestionDialog
        controller={controller}
        open
        onClose={onClose}
        onEditSeasonPattern={onEditSeasonPattern}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Projekteinstellungen' }));

    expect(onEditSeasonPattern).toHaveBeenCalledTimes(1);
    expect(createSeason).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
