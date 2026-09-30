import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VarietiesComparisonTable } from '../crops/VarietiesComparisonTable';
import type { Crop } from '../api/types';

const crop = (overrides: Partial<Crop> = {}): Crop => ({
  id: 1,
  name: 'Tomate',
  ...overrides,
} as Crop);

/** The general crop every variety inherits from when it sets nothing itself. */
const BASE = crop({
  id: 100,
  name: 'Tomate',
  crop_family: 'Nachtschatten',
  nutrient_demand: 'medium',
  growth_duration_days: 90,
});

const renderTable = (varieties: { crop: Crop; label: string }[], cropCrop: Crop = BASE) => {
  const onSelect = vi.fn();
  const view = render(
    <VarietiesComparisonTable varieties={varieties} cropCrop={cropCrop} onSelect={onSelect} />,
  );
  return { ...view, onSelect };
};

const headerCells = (): string[] =>
  within(screen.getAllByRole('row')[0])
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent ?? '');

const bodyRows = (): HTMLElement[] => screen.getAllByRole('row').slice(1);
const rowFor = (label: string): HTMLElement =>
  screen.getByText(label).closest('tr') as HTMLElement;

/**
 * The variety comparison table on a crop's detail page. Only the fields that
 * actually differ become columns, so the table's shape is its content -- and
 * the comparison it makes changes depending on how many varieties there are.
 *
 * `varietyComparisonFields.test.ts` covers which values differ and how each
 * is formatted; what is covered here is the table's own decisions.
 */
describe('VarietiesComparisonTable', () => {
  describe('with several varieties', () => {
    const TWO = [
      { crop: crop({ id: 1, growth_duration_days: 80 }), label: 'Matina' },
      { crop: crop({ id: 2, growth_duration_days: 110 }), label: 'Berner Rose' },
    ];

    it('lists one row per variety', () => {
      renderTable(TWO);

      expect(bodyRows()).toHaveLength(2);
      expect(screen.getByText('Matina')).toBeInTheDocument();
      expect(screen.getByText('Berner Rose')).toBeInTheDocument();
    });

    it('gives a column only to fields that actually differ', () => {
      renderTable(TWO);

      // Both varieties inherit the crop's family and nutrient demand, so
      // columns for those would be identical down the table and say nothing.
      expect(headerCells()).toEqual(['Sorte', 'Wachstumszeit (Tage)']);
    });

    it('compares the varieties against each other, not against the crop', () => {
      // Both differ from the crop's 90 days, and from each other. What makes
      // the column appear is the difference between the two varieties.
      renderTable(TWO);

      expect(headerCells()).toContain('Wachstumszeit (Tage)');
      // The cell carries the unit, so the number is readable without the
      // column header beside it once the table scrolls sideways.
      expect(within(rowFor('Matina')).getByText('80 Tage')).toBeInTheDocument();
      expect(within(rowFor('Berner Rose')).getByText('110 Tage')).toBeInTheDocument();
    });

    it('offers no columns at all when the varieties agree on everything', () => {
      renderTable([
        { crop: crop({ id: 1, growth_duration_days: 80 }), label: 'Matina' },
        { crop: crop({ id: 2, growth_duration_days: 80 }), label: 'Zwilling' },
      ]);

      // Two varieties that differ in nothing: the name column alone, and no
      // sole-variety notice either, since that explains a different case.
      // Note both differ from the *crop* (90 days) -- with two varieties
      // present that is not what the comparison is about.
      expect(headerCells()).toEqual(['Sorte']);
      expect(
        screen.queryByText('Keine Abweichungen von den allgemeinen Kulturdaten'),
      ).not.toBeInTheDocument();
    });

    it('shows a variety’s inherited value rather than a blank', () => {
      // Berner Rose sets no family of its own, so the crop's stands.
      renderTable([
        { crop: crop({ id: 1, crop_family: 'Solanaceae', growth_duration_days: 80 }), label: 'Matina' },
        { crop: crop({ id: 2, growth_duration_days: 80 }), label: 'Berner Rose' },
      ]);

      expect(headerCells()).toContain('Pflanzenfamilie');
      expect(within(rowFor('Berner Rose')).getByText('Nachtschatten')).toBeInTheDocument();
    });
  });

  describe('with a single variety', () => {
    it('compares it against the general crop instead', () => {
      // There is no second variety to diff against, so the crop stands in as
      // one -- otherwise a lone variety would always show an empty table.
      renderTable([{ crop: crop({ id: 1, growth_duration_days: 80 }), label: 'Matina' }]);

      expect(headerCells()).toEqual(['Sorte', 'Wachstumszeit (Tage)']);
      expect(within(rowFor('Matina')).getByText('80 Tage')).toBeInTheDocument();
    });

    it('lists every field it departs from the crop on', () => {
      renderTable([
        {
          crop: crop({ id: 1, growth_duration_days: 80, nutrient_demand: 'high' }),
          label: 'Matina',
        },
      ]);

      expect(headerCells()).toContain('Wachstumszeit (Tage)');
      expect(headerCells()).toContain('Nährstoffbedarf');
    });

    it('says so plainly when it departs from the crop on nothing', () => {
      // An empty table would look like a fault. This is the one case where
      // "nothing differs" is itself the answer worth printing.
      renderTable([{ crop: crop({ id: 1 }), label: 'Matina' }]);

      expect(
        screen.getByText('Keine Abweichungen von den allgemeinen Kulturdaten'),
      ).toBeInTheDocument();
    });

    it('keeps the name column beside that notice', () => {
      renderTable([{ crop: crop({ id: 1 }), label: 'Matina' }]);

      // The variety still has to be identifiable, even with nothing to say
      // about it.
      expect(within(rowFor('Matina')).getByText('Matina')).toBeInTheDocument();
      expect(headerCells()[0]).toBe('Sorte');
    });

    it('drops the notice as soon as something does differ', () => {
      renderTable([{ crop: crop({ id: 1, growth_duration_days: 80 }), label: 'Matina' }]);

      expect(
        screen.queryByText('Keine Abweichungen von den allgemeinen Kulturdaten'),
      ).not.toBeInTheDocument();
    });
  });

  describe('opening a variety', () => {
    const ONE = [{ crop: crop({ id: 7, growth_duration_days: 80 }), label: 'Matina' }];

    it('opens the variety whose row was clicked', async () => {
      const user = userEvent.setup();
      const { onSelect } = renderTable([
        { crop: crop({ id: 7, growth_duration_days: 80 }), label: 'Matina' },
        { crop: crop({ id: 8, growth_duration_days: 110 }), label: 'Berner Rose' },
      ]);

      await user.click(rowFor('Berner Rose'));

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('is reachable with the keyboard', () => {
      renderTable(ONE);

      // The row is the control here; there is no link inside it to tab to,
      // so the row itself has to be a tab stop.
      expect(rowFor('Matina')).toHaveAttribute('tabindex', '0');
    });

    it('opens on Enter', async () => {
      const user = userEvent.setup();
      const { onSelect } = renderTable(ONE);

      rowFor('Matina').focus();
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    });

    it('ignores other keys, so arrow keys still scroll the table', async () => {
      const user = userEvent.setup();
      const { onSelect } = renderTable(ONE);

      rowFor('Matina').focus();
      await user.keyboard('{ArrowDown}{Space}{Escape}');

      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('the name column', () => {
    it('stays put while the comparison scrolls sideways', () => {
      renderTable([{ crop: crop({ id: 1, growth_duration_days: 80 }), label: 'Matina' }]);

      // The table grows a column per differing field and scrolls on a
      // phone; without a sticky name the rows lose their labels.
      const nameCell = screen.getByText('Matina').closest('td') as HTMLElement;
      expect(nameCell).toHaveStyle({ position: 'sticky', left: '0px' });
    });

    it('sits above the scrolling cells rather than under them', () => {
      renderTable([{ crop: crop({ id: 1, growth_duration_days: 80 }), label: 'Matina' }]);

      const nameCell = screen.getByText('Matina').closest('td') as HTMLElement;
      expect(nameCell).toHaveStyle({ zIndex: '2' });
    });
  });
});
