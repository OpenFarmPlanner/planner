import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CropFiltersPopover } from '../crops/CropFiltersPopover';
import { PublicCropFiltersPopover } from '../crop-library/components/PublicCropFiltersPopover';
import type { PersistedCropFilters } from '../crops/cropDetailFormatters';
import type { PublicCropFilterState } from '../crop-library/publicCropFilters';

const anchor = (): HTMLElement => {
  const button = document.createElement('button');
  button.textContent = 'Filter';
  document.body.appendChild(button);
  return button;
};

const emptyPrivateFilters: PersistedCropFilters = {
  searchQuery: '',
  selectedFamilyFilter: '',
  selectedCultivationFilter: '',
  selectedNutrientFilter: '',
  selectedSupplierFilter: '',
  growthDaysMin: '',
  growthDaysMax: '',
  yieldMin: '',
  yieldMax: '',
  selectedSowingMonths: [],
};

const emptyPublicFilters: PublicCropFilterState = {
  cropFamily: '',
  cultivationType: '',
  nutrientDemand: '',
  variety: '',
  growthDaysMin: '',
  growthDaysMax: '',
  yieldMin: '',
  yieldMax: '',
};

const monthOptions = [
  { value: 3, label: 'März' },
  { value: 4, label: 'April' },
  { value: 9, label: 'September' },
];

const renderPrivate = (filters: Partial<PersistedCropFilters> = {}) => {
  const onFilterChange = vi.fn();
  const onClose = vi.fn();
  const onReset = vi.fn();
  const view = render(
    <CropFiltersPopover
      anchorEl={anchor()}
      onClose={onClose}
      filters={{ ...emptyPrivateFilters, ...filters }}
      onFilterChange={onFilterChange}
      familyOptions={['Brassicaceae', 'Fabaceae']}
      supplierOptions={[
        { id: '7', name: 'Reinsaat' },
        { id: '9', name: 'Bingenheimer' },
      ]}
      monthOptions={monthOptions}
      onReset={onReset}
    />,
  );
  return { ...view, onFilterChange, onClose, onReset };
};

const renderPublic = (filters: Partial<PublicCropFilterState> = {}) => {
  const onFilterChange = vi.fn();
  const onClose = vi.fn();
  const onReset = vi.fn();
  const view = render(
    <PublicCropFiltersPopover
      anchorEl={anchor()}
      onClose={onClose}
      filters={{ ...emptyPublicFilters, ...filters }}
      onFilterChange={onFilterChange}
      options={{
        cropFamilyOptions: ['Brassicaceae', 'Fabaceae'],
        varietyOptions: ['Nantaise', 'Rodelika'],
        nutrientOptions: ['high', 'low', 'medium'],
      }}
      onReset={onReset}
    />,
  );
  return { ...view, onFilterChange, onClose, onReset };
};

const select = (label: string): HTMLElement => screen.getByLabelText(label);
const numberField = (label: string): HTMLElement => screen.getByLabelText(label);

const pick = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
): Promise<void> => {
  await user.click(select(label));
  await user.click(screen.getByRole('option', { name: option }));
};

/**
 * The two advanced-filter popovers for crop data: one over the project's own
 * crops, one over the public library. Neither holds state and neither draws its
 * own chrome -- `FilterPopoverShell`, `FilterSelectField` and
 * `FilterNumberField` have their own suites -- so what is left, and the only
 * thing these files can get wrong, is the wiring: which state key each field
 * writes, which options it offers, and which of its values reaches the parent.
 * A field pointed at the neighbouring key still renders and still reacts, which
 * is why every assertion names both the key and the value.
 */
describe('CropFiltersPopover', () => {
  it('offers every filter the crop selector supports', () => {
    renderPrivate();
    [
      'Familie',
      'Anbauart',
      'Nährstoffbedarf',
      'Lieferant',
      'Wachstumsdauer min',
      'Wachstumsdauer max',
      'Aussaatzeitraum',
      'Ertrag/m² min',
      'Ertrag/m² max',
    ].forEach((label) => expect(screen.getByLabelText(label)).toBeInTheDocument());
  });

  describe('the family filter', () => {
    it('lists the families the parent supplied, behind an "all" entry', async () => {
      const user = userEvent.setup();
      renderPrivate();
      await user.click(select('Familie'));
      const options = screen.getAllByRole('option').map((option) => option.textContent);
      expect(options).toEqual(['Alle', 'Brassicaceae', 'Fabaceae']);
    });

    it('writes the picked family to selectedFamilyFilter', async () => {
      const user = userEvent.setup();
      const { onFilterChange } = renderPrivate();
      await pick(user, 'Familie', 'Fabaceae');
      expect(onFilterChange).toHaveBeenCalledWith('selectedFamilyFilter', 'Fabaceae');
    });

    it('clears it back to an empty string', async () => {
      const user = userEvent.setup();
      const { onFilterChange } = renderPrivate({ selectedFamilyFilter: 'Fabaceae' });
      await pick(user, 'Familie', 'Alle');
      expect(onFilterChange).toHaveBeenCalledWith('selectedFamilyFilter', '');
    });

    it('shows the family already filtered on', () => {
      renderPrivate({ selectedFamilyFilter: 'Brassicaceae' });
      expect(select('Familie')).toHaveTextContent('Brassicaceae');
    });
  });

  describe('the cultivation-type filter', () => {
    it('offers the three cultivation types in German', async () => {
      const user = userEvent.setup();
      renderPrivate();
      await user.click(select('Anbauart'));
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Alle',
        'Direktsaat',
        'Pflanzung',
        'Beides',
      ]);
    });

    it.each([
      ['Direktsaat', 'direct_sowing'],
      ['Pflanzung', 'pre_cultivation'],
      ['Beides', 'both'],
    ])('writes %s as %s', async (label, value) => {
      const user = userEvent.setup();
      const { onFilterChange } = renderPrivate();
      await pick(user, 'Anbauart', label);
      expect(onFilterChange).toHaveBeenCalledWith('selectedCultivationFilter', value);
    });
  });

  describe('the nutrient-demand filter', () => {
    it('offers the three demand levels in German', async () => {
      const user = userEvent.setup();
      renderPrivate();
      await user.click(select('Nährstoffbedarf'));
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Alle',
        'Niedrig',
        'Mittel',
        'Hoch',
      ]);
    });

    it.each([
      ['Niedrig', 'low'],
      ['Mittel', 'medium'],
      ['Hoch', 'high'],
    ])('writes %s as %s', async (label, value) => {
      const user = userEvent.setup();
      const { onFilterChange } = renderPrivate();
      await pick(user, 'Nährstoffbedarf', label);
      expect(onFilterChange).toHaveBeenCalledWith('selectedNutrientFilter', value);
    });
  });

  describe('the supplier filter', () => {
    it('shows supplier names but reports their ids', async () => {
      const user = userEvent.setup();
      const { onFilterChange } = renderPrivate();
      await pick(user, 'Lieferant', 'Reinsaat');
      expect(onFilterChange).toHaveBeenCalledWith('selectedSupplierFilter', '7');
    });

    it('keeps the order the parent supplied rather than sorting by name', async () => {
      const user = userEvent.setup();
      renderPrivate();
      await user.click(select('Lieferant'));
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Alle',
        'Reinsaat',
        'Bingenheimer',
      ]);
    });
  });

  describe('the numeric bounds', () => {
    /**
     * One `change` with the finished value rather than `user.type`: the field is
     * controlled by a parent that this harness never lets update, so a browser
     * `type="number"` input resets between keystrokes and what arrives is the
     * input's own normalization rather than the wiring under test.
     */
    it.each([
      ['Wachstumsdauer min', 'growthDaysMin' as const, '30', 'numeric'],
      ['Wachstumsdauer max', 'growthDaysMax' as const, '120', 'numeric'],
      ['Ertrag/m² min', 'yieldMin' as const, '1.5', 'decimal'],
      ['Ertrag/m² max', 'yieldMax' as const, '4.25', 'decimal'],
    ])('writes %s to %s', (label, key, typed, inputMode) => {
      const { onFilterChange } = renderPrivate();
      const field = numberField(label);
      expect(field).toHaveAttribute('inputmode', inputMode);
      fireEvent.change(field, { target: { value: typed } });
      expect(onFilterChange).toHaveBeenCalledExactlyOnceWith(key, typed);
    });

    it('shows the bounds already set', () => {
      renderPrivate({ growthDaysMin: '30', yieldMax: '4.25' });
      expect(numberField('Wachstumsdauer min')).toHaveValue(30);
      expect(numberField('Ertrag/m² max')).toHaveValue(4.25);
    });
  });

  describe('the sowing-month filter', () => {
    it('lists the months the parent supplied, without an "all" entry', async () => {
      const user = userEvent.setup();
      renderPrivate();
      await user.click(select('Aussaatzeitraum'));
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'März',
        'April',
        'September',
      ]);
    });

    it('reports month numbers, not labels', async () => {
      const user = userEvent.setup();
      const { onFilterChange } = renderPrivate();
      await user.click(select('Aussaatzeitraum'));
      await user.click(screen.getByRole('option', { name: 'April' }));
      expect(onFilterChange).toHaveBeenCalledWith('selectedSowingMonths', [4]);
    });

    it('adds to the months already picked instead of replacing them', async () => {
      const user = userEvent.setup();
      const { onFilterChange } = renderPrivate({ selectedSowingMonths: [3] });
      await user.click(select('Aussaatzeitraum'));
      await user.click(screen.getByRole('option', { name: 'September' }));
      expect(onFilterChange).toHaveBeenCalledWith('selectedSowingMonths', [3, 9]);
    });

    it('removes a month that is picked again', async () => {
      const user = userEvent.setup();
      const { onFilterChange } = renderPrivate({ selectedSowingMonths: [3, 9] });
      await user.click(select('Aussaatzeitraum'));
      await user.click(screen.getByRole('option', { name: 'März' }));
      expect(onFilterChange).toHaveBeenCalledWith('selectedSowingMonths', [9]);
    });

    it('summarises the picked months by label, in the order they were picked', () => {
      renderPrivate({ selectedSowingMonths: [9, 3] });
      expect(select('Aussaatzeitraum')).toHaveTextContent('September, März');
    });

    /**
     * A month that is no longer offered still has to render as something: the
     * parent builds `monthOptions` from the current locale, so a persisted
     * filter can outlive the list it was picked from.
     */
    it('falls back to the raw number for a month it cannot label', () => {
      renderPrivate({ selectedSowingMonths: [3, 12] });
      expect(select('Aussaatzeitraum')).toHaveTextContent('März, 12');
    });
  });
});

describe('PublicCropFiltersPopover', () => {
  it('offers the public library filters, and no supplier or sowing-month filter', () => {
    renderPublic();
    ['Familie', 'Sorte', 'Anbauart', 'Nährstoffbedarf'].forEach((label) =>
      expect(screen.getByLabelText(label)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Lieferant')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Aussaatzeitraum')).not.toBeInTheDocument();
  });

  it.each([
    ['Familie', 'Fabaceae', 'cropFamily' as const],
    ['Sorte', 'Rodelika', 'variety' as const],
  ])('writes the picked %s to %s', async (label, option, key) => {
    const user = userEvent.setup();
    const { onFilterChange } = renderPublic();
    await pick(user, label, option);
    expect(onFilterChange).toHaveBeenCalledWith(key, option);
  });

  it('lists the varieties the parent supplied, behind an "all" entry', async () => {
    const user = userEvent.setup();
    renderPublic();
    await user.click(select('Sorte'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Alle',
      'Nantaise',
      'Rodelika',
    ]);
  });

  /**
   * Unlike the private popover, the nutrient options come from the data rather
   * than being hardcoded, so the raw enum values have to be mapped to German
   * here -- and the order is the parent's, not the severity order.
   */
  it('labels the data-driven nutrient values in German', async () => {
    const user = userEvent.setup();
    renderPublic();
    await user.click(select('Nährstoffbedarf'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Alle',
      'Hoch',
      'Niedrig',
      'Mittel',
    ]);
  });

  it('writes the raw nutrient value, not its label', async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderPublic();
    await pick(user, 'Nährstoffbedarf', 'Mittel');
    expect(onFilterChange).toHaveBeenCalledWith('nutrientDemand', 'medium');
  });

  it('shows a nutrient value it has no German label for as it came', async () => {
    const user = userEvent.setup();
    render(
      <PublicCropFiltersPopover
        anchorEl={anchor()}
        onClose={vi.fn()}
        filters={emptyPublicFilters}
        onFilterChange={vi.fn()}
        options={{ cropFamilyOptions: [], varietyOptions: [], nutrientOptions: ['very_high'] }}
        onReset={vi.fn()}
      />,
    );
    await user.click(select('Nährstoffbedarf'));
    expect(screen.getByRole('option', { name: 'very_high' })).toBeInTheDocument();
  });

  it.each([
    ['Wachstumsdauer min', 'growthDaysMin' as const, '30', 'numeric'],
    ['Wachstumsdauer max', 'growthDaysMax' as const, '90', 'numeric'],
    ['Ertrag/m² min', 'yieldMin' as const, '2.5', 'decimal'],
    ['Ertrag/m² max', 'yieldMax' as const, '8.75', 'decimal'],
  ])('writes %s to %s', (label, key, typed, inputMode) => {
    const { onFilterChange } = renderPublic();
    const field = numberField(label);
    expect(field).toHaveAttribute('inputmode', inputMode);
    fireEvent.change(field, { target: { value: typed } });
    expect(onFilterChange).toHaveBeenCalledExactlyOnceWith(key, typed);
  });

  it('keeps the reset action the shell provides', async () => {
    const user = userEvent.setup();
    const { onReset } = renderPublic();
    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe('both popovers', () => {
  /**
   * The ids are what ties each `InputLabel` to its select, and the two popovers
   * can be mounted in the same document (the library import dialog opens over
   * the crop selector), so they must not collide.
   */
  it('prefix their field ids so the two sets cannot collide', () => {
    const { container: privateContainer } = renderPrivate();
    expect(privateContainer.ownerDocument.getElementById('crop-family-filter-label')).toHaveTextContent('Familie');
    const { container: publicContainer } = renderPublic();
    expect(publicContainer.ownerDocument.getElementById('public-crop-family-filter-label')).toHaveTextContent('Familie');
  });

  it('render nothing until the parent supplies an anchor', () => {
    render(
      <CropFiltersPopover
        anchorEl={null}
        onClose={vi.fn()}
        filters={emptyPrivateFilters}
        onFilterChange={vi.fn()}
        familyOptions={[]}
        supplierOptions={[]}
        monthOptions={[]}
        onReset={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Familie')).not.toBeInTheDocument();
  });

  it('place the wide filters on their own row', () => {
    renderPrivate();
    const wide = select('Familie').closest('.MuiFormControl-root') as HTMLElement;
    expect(window.getComputedStyle(wide).gridColumn).toBe('1/-1');
    const narrow = select('Anbauart').closest('.MuiFormControl-root') as HTMLElement;
    expect(window.getComputedStyle(narrow).gridColumn).not.toBe('1/-1');
  });
});
