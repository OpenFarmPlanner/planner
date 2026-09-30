import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeasonPatternCard } from '../seasons/SeasonPatternCard';
import type { SeasonPatternPreviewResponse } from '../api/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    seasonPatternAPI: {
      ...actual.seasonPatternAPI,
      get: mocks.get,
      update: mocks.update,
      preview: mocks.preview,
    },
  };
});

const emptyPreview: SeasonPatternPreviewResponse = {
  periods: [],
  reference_season: null,
  transition: null,
};

const preview = (
  overrides: Partial<SeasonPatternPreviewResponse> = {},
): SeasonPatternPreviewResponse => ({ ...emptyPreview, ...overrides });

const renderCard = (onSaved = vi.fn()) => {
  const view = render(<SeasonPatternCard onSaved={onSaved} />);
  return { ...view, onSaved };
};

const saveButton = () => screen.getByRole('button', { name: 'Saison-Muster speichern' });
const cancelButton = () => screen.getByRole('button', { name: 'Abbrechen' });

/** Picks a value from one of the two MUI selects backing the start date. */
const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) => {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.update.mockReset();
  mocks.preview.mockReset();
  mocks.get.mockResolvedValue({ data: { start_day: 1, start_month: 1 } });
  mocks.update.mockResolvedValue({ data: { start_day: 1, start_month: 1 } });
  mocks.preview.mockResolvedValue({ data: emptyPreview });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The project-settings card that sets when a season starts. Every season runs
 * 12 months from that date, so changing it changes which periods the app will
 * offer to create -- which is why the card previews them before saving, and
 * why the preview is refetched on every edit rather than on save.
 */
describe('SeasonPatternCard', () => {
  describe('loading the current pattern', () => {
    it('shows the stored start date and previews it', async () => {
      mocks.get.mockResolvedValue({ data: { start_day: 15, start_month: 9 } });
      renderCard();

      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: 'Tag' })).toHaveTextContent('15'),
      );
      expect(screen.getByRole('combobox', { name: 'Monat' })).toHaveTextContent('September');
      expect(mocks.preview).toHaveBeenCalledWith({ start_day: 15, start_month: 9 });
    });

    it('survives a pattern that cannot be loaded', async () => {
      mocks.get.mockRejectedValue(new Error('offline'));
      renderCard();

      // The card is one of several on the settings page; it must not take the
      // page down with it.
      expect(await screen.findByText('Saison-Muster')).toBeInTheDocument();
      await waitFor(() => expect(mocks.get).toHaveBeenCalled());
      expect(mocks.preview).not.toHaveBeenCalled();
    });

    it('keeps the last preview when a new one cannot be fetched', async () => {
      mocks.preview
        .mockResolvedValueOnce({
          data: preview({
            periods: [{ start_date: '2026-01-01', end_date: '2026-12-31', is_current: true }],
          }),
        })
        .mockRejectedValueOnce(new Error('offline'));
      const user = userEvent.setup();
      renderCard();
      await screen.findByText('2026 (aktuell)');

      await choose(user, 'Monat', 'März');

      // A failed refetch must not blank a preview the user is reading.
      await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2));
      expect(screen.getByText('2026 (aktuell)')).toBeInTheDocument();
    });
  });

  describe('the preview table', () => {
    it('lists each computed period with its year and dates', async () => {
      mocks.preview.mockResolvedValue({
        data: preview({
          periods: [
            { start_date: '2026-01-01', end_date: '2026-12-31', is_current: false },
            { start_date: '2027-01-01', end_date: '2027-12-31', is_current: false },
          ],
        }),
      });
      renderCard();

      const rows = await waitFor(() => {
        const found = screen.getAllByRole('row').slice(1);
        expect(found).toHaveLength(2);
        return found;
      });
      expect(rows[0]).toHaveTextContent('2026');
      expect(rows[0]).toHaveTextContent('1.1.2026 – 31.12.2026');
      expect(rows[1]).toHaveTextContent('2027');
    });

    it('marks the period the project is in right now', async () => {
      mocks.preview.mockResolvedValue({
        data: preview({
          periods: [
            { start_date: '2026-01-01', end_date: '2026-12-31', is_current: true },
            { start_date: '2027-01-01', end_date: '2027-12-31', is_current: false },
          ],
        }),
      });
      renderCard();

      expect(await screen.findByText('2026 (aktuell)')).toBeInTheDocument();
      expect(screen.getByText('2027')).toBeInTheDocument();
    });

    it('names a period by the year it starts in, not the one it ends in', async () => {
      // A September-to-August season belongs to the year it opened.
      mocks.preview.mockResolvedValue({
        data: preview({
          periods: [{ start_date: '2026-09-01', end_date: '2027-08-31', is_current: false }],
        }),
      });
      renderCard();

      // Waiting on the row count would pass on the header alone, so wait for
      // the period itself to arrive first.
      const period = await screen.findByText('1.9.2026 – 31.8.2027');
      expect(within(period.closest('tr') as HTMLElement).getByText('2026')).toBeInTheDocument();
    });

    it('shows the existing season the pattern is measured against', async () => {
      mocks.preview.mockResolvedValue({
        data: preview({
          reference_season: {
            start_date: '2025-01-01',
            end_date: '2025-12-31',
            label: '2025',
          },
        }),
      });
      renderCard();

      // Without it the computed periods look arbitrary; this is where they
      // are counted from.
      expect(await screen.findByText('2025')).toBeInTheDocument();
      expect(screen.getByText('(zuletzt bestehende Saison)')).toBeInTheDocument();
    });

    it('leaves the reference row out when there is no season yet', async () => {
      renderCard();

      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
      expect(screen.queryByText('(zuletzt bestehende Saison)')).not.toBeInTheDocument();
    });

    it('warns about a gap the new pattern would open', async () => {
      mocks.preview.mockResolvedValue({
        data: preview({
          transition: { kind: 'gap', start_date: '2026-01-01', end_date: '2026-08-31' },
        }),
      });
      renderCard();

      // Moving the start date forward leaves months no season covers, and
      // that is the consequence the user has to see before saving.
      expect(await screen.findByText('Lücke')).toBeInTheDocument();
      expect(screen.getByText('1.1.2026 – 31.8.2026', { exact: false })).toBeInTheDocument();
      expect(screen.getByText('Optionen beim Anlegen wählbar')).toBeInTheDocument();
    });

    it('warns about an overlap instead, when that is what it is', async () => {
      mocks.preview.mockResolvedValue({
        data: preview({
          transition: { kind: 'overlap', start_date: '2025-09-01', end_date: '2025-12-31' },
        }),
      });
      renderCard();

      expect(await screen.findByText('Überlappung')).toBeInTheDocument();
      expect(screen.queryByText('Lücke')).not.toBeInTheDocument();
    });

    it('leaves the warning row out when the pattern lines up', async () => {
      renderCard();

      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
      expect(screen.queryByText('Lücke')).not.toBeInTheDocument();
      expect(screen.queryByText('Überlappung')).not.toBeInTheDocument();
    });
  });

  describe('editing the start date', () => {
    it('re-previews on every change, before anything is saved', async () => {
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));

      await choose(user, 'Monat', 'September');

      // The preview is the reason to trust the change; deferring it to save
      // would make the card a blind edit.
      await waitFor(() =>
        expect(mocks.preview).toHaveBeenLastCalledWith({ start_day: 1, start_month: 9 }),
      );
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('keeps the day when only the month changes', async () => {
      mocks.get.mockResolvedValue({ data: { start_day: 15, start_month: 1 } });
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));

      await choose(user, 'Monat', 'März');

      await waitFor(() =>
        expect(mocks.preview).toHaveBeenLastCalledWith({ start_day: 15, start_month: 3 }),
      );
    });

    it('keeps the month when only the day changes', async () => {
      mocks.get.mockResolvedValue({ data: { start_day: 1, start_month: 9 } });
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));

      await choose(user, 'Tag', '15');

      await waitFor(() =>
        expect(mocks.preview).toHaveBeenLastCalledWith({ start_day: 15, start_month: 9 }),
      );
    });
  });

  describe('saving', () => {
    it('offers nothing to save or cancel until something changes', async () => {
      renderCard();

      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
      expect(saveButton()).toBeDisabled();
      expect(cancelButton()).toBeDisabled();
    });

    it('explains why the buttons are disabled', async () => {
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await user.hover(saveButton().parentElement as HTMLElement);

      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Es gibt keine ungespeicherten Änderungen.',
      );
    });

    it('enables both once the date differs from the stored one', async () => {
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');

      await waitFor(() => expect(saveButton()).toBeEnabled());
      expect(cancelButton()).toBeEnabled();
    });

    it('disables them again when the date is changed back', async () => {
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await choose(user, 'Monat', 'Januar');

      // Back where it started is not a change, however it was reached.
      await waitFor(() => expect(saveButton()).toBeDisabled());
    });

    it('sends the edited date and confirms', async () => {
      const user = userEvent.setup();
      const { onSaved } = renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await user.click(saveButton());

      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith({ start_day: 1, start_month: 9 }),
      );
      expect(await screen.findByText('Saison-Muster gespeichert.')).toBeInTheDocument();
      // The due-season suggestion is derived from the pattern, so the app has
      // to be told to recompute it.
      expect(onSaved).toHaveBeenCalled();
    });

    it('treats the saved date as the new baseline', async () => {
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await user.click(saveButton());
      await screen.findByText('Saison-Muster gespeichert.');

      // Otherwise the card would keep offering to save what it just saved.
      expect(saveButton()).toBeDisabled();
    });

    it('reports a refused save and keeps the edit', async () => {
      mocks.update.mockRejectedValue(new Error('nope'));
      const user = userEvent.setup();
      const { onSaved } = renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await user.click(saveButton());

      expect(
        await screen.findByText('Saison-Muster konnte nicht gespeichert werden.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Monat' })).toHaveTextContent('September');
      expect(saveButton()).toBeEnabled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('prefers the reason the server gave', async () => {
      // Field-level extraction is gated on a 400; without the status the
      // helper falls straight through to the generic message.
      mocks.update.mockRejectedValue({
        isAxiosError: true,
        response: { status: 400, data: { start_day: ['Der 31. Februar existiert nicht.'] } },
      });
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await user.click(saveButton());

      expect(await screen.findByText(/Der 31. Februar existiert nicht./)).toBeInTheDocument();
    });

    it('clears a previous failure when the save is retried', async () => {
      mocks.update.mockRejectedValueOnce(new Error('nope'));
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await user.click(saveButton());
      await screen.findByText('Saison-Muster konnte nicht gespeichert werden.');

      await user.click(saveButton());

      await waitFor(() =>
        expect(
          screen.queryByText('Saison-Muster konnte nicht gespeichert werden.'),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByText('Saison-Muster gespeichert.')).toBeInTheDocument();
    });
  });

  describe('cancelling', () => {
    it('restores the stored date and re-previews it', async () => {
      mocks.get.mockResolvedValue({ data: { start_day: 1, start_month: 1 } });
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await user.click(cancelButton());

      expect(screen.getByRole('combobox', { name: 'Monat' })).toHaveTextContent('Januar');
      // The preview has to follow the fields back, or it would keep showing
      // periods for a date the card no longer holds.
      await waitFor(() =>
        expect(mocks.preview).toHaveBeenLastCalledWith({ start_day: 1, start_month: 1 }),
      );
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('restores the last saved date, not the originally loaded one', async () => {
      const user = userEvent.setup();
      renderCard();
      await waitFor(() => expect(mocks.preview).toHaveBeenCalled());

      await choose(user, 'Monat', 'September');
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await user.click(saveButton());
      await screen.findByText('Saison-Muster gespeichert.');

      await choose(user, 'Monat', 'März');
      await waitFor(() => expect(cancelButton()).toBeEnabled());
      await user.click(cancelButton());

      expect(screen.getByRole('combobox', { name: 'Monat' })).toHaveTextContent('September');
    });
  });

  it('says that the change applies only to future seasons', async () => {
    renderCard();

    // The card edits a rule, not the seasons already created from it.
    expect(
      await screen.findByText(
        'Die Änderung wirkt sich nur auf künftig neu angelegte Saisonen aus; bestehende Saisonen bleiben unverändert.',
      ),
    ).toBeInTheDocument();
  });
});
