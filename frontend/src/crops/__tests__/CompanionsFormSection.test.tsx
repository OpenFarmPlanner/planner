import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';

import type { Crop, CropCompanion, PublicCrop, PublicCropCompanion } from '../../api/types';
import { formRowsToLibraryItems, formRowsToReplaceItems } from '../companions';
import { resetPlantFamiliesCache } from '../plantFamilies';
import { publicCropToCropFormData } from '../publicCropFormAdapter';
import { CompanionsSection } from '../sections/CompanionsSection';
import { useCompanionFormRows } from '../useCompanionFormRows';

const api = vi.hoisted(() => ({
  listForCrop: vi.fn(),
  families: vi.fn(),
}));

vi.mock('../../api/api', async () => {
  const actual = await vi.importActual<typeof import('../../api/api')>('../../api/api');
  return {
    ...actual,
    cropCompanionAPI: { listForCrop: api.listForCrop },
    plantFamilyAPI: { list: api.families },
  };
});

const TOMATO = { id: 1, name: 'Tomate', variety: '' } as Crop;
const POTATO = { id: 2, name: 'Kartoffel', variety: '' } as Crop;
const BASIL = { id: 3, name: 'Basilikum', variety: '' } as Crop;
const ROMA = { id: 4, name: 'Tomate', variety: 'Roma', general_crop: 1 } as Crop;
const CROPS = [TOMATO, POTATO, BASIL, ROMA];

const PAIR: CropCompanion = {
  id: 10, crop: 1, companion_crop: 2, companion_family: null, companion_text: '',
  kind: 'bad', reason: 'shared_pests_diseases', note: 'Krautfäule',
};

function Harness({ crop, isKulturForm }: { crop: Crop; isKulturForm: boolean }) {
  const state = useCompanionFormRows({ variant: 'project', crop, crops: CROPS, isKulturForm });
  return (
    <>
      <CompanionsSection state={state} />
      <output data-testid="dirty">{String(state.dirty)}</output>
      <output data-testid="payload">{JSON.stringify(formRowsToReplaceItems(state.rows))}</output>
      <button type="button" onClick={() => state.validate()}>validate</button>
    </>
  );
}

const payload = () => JSON.parse(screen.getByTestId('payload').textContent ?? '[]');

describe('CompanionsSection in the crop form', () => {
  beforeEach(() => {
    resetPlantFamiliesCache();
    api.families.mockResolvedValue({
      data: [{ botanical_name: 'Brassicaceae', translations: { de: 'Kreuzblütler' }, default_rotation_break_years: 3 }],
    });
    api.listForCrop.mockResolvedValue({ data: [PAIR] });
  });

  it('edits only explicitly selected note languages and retains drafts when switching', async () => {
    api.listForCrop.mockResolvedValue({ data: [{ ...PAIR, note_language_code: 'de', notes: { de: 'Quelle', en: 'Source' }, note: 'Quelle' }] });
    render(<Harness crop={TOMATO} isKulturForm />);
    await screen.findByDisplayValue('Quelle');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Sprache der Nachbarnotizen' }));
    fireEvent.click(screen.getByRole('option', { name: 'English' }));
    expect(screen.getByLabelText('Notiz')).toHaveValue('Source');
    fireEvent.change(screen.getByLabelText('Notiz'), { target: { value: 'Updated source' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Sprache der Nachbarnotizen' }));
    fireEvent.click(screen.getByRole('option', { name: 'Deutsch' }));
    expect(screen.getByLabelText('Notiz')).toHaveValue('Quelle');
    expect(screen.getByTestId('dirty')).toHaveTextContent('true');
    expect(payload()[0].notes).toEqual({ en: 'Updated source' });
  });

  it("loads the Kultur's neighbours into their group and marks a shared pair", async () => {
    render(<Harness crop={TOMATO} isKulturForm />);

    const badGroup = await screen.findByTestId('companion-form-group-bad');
    const row = await within(badGroup).findByTestId('crop-companion-form-row');
    expect(api.listForCrop).toHaveBeenCalledWith(1);
    expect(within(row).getByRole('combobox', { name: /^Nachbar$/ })).toHaveValue('Kartoffel');
    expect(within(row).getByTestId('companion-shared-pair')).toHaveAccessibleName('Gilt auch für Kartoffel.');
    // A group without rows shows no heading; its add button stays below the groups.
    expect(screen.queryByTestId('companion-form-group-good')).toBeNull();
    expect(screen.queryByText('Gute Nachbarn')).toBeNull();
    expect(within(badGroup).getByRole('heading', { name: 'Schlechte Nachbarn' })).toBeInTheDocument();
    expect(screen.queryByTestId('companion-form-empty')).toBeNull();
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
  });

  it('shows one muted line and both add buttons while no neighbour is recorded', async () => {
    api.listForCrop.mockResolvedValue({ data: [] });
    render(<Harness crop={TOMATO} isKulturForm />);

    expect(await screen.findByText('Noch keine Nachbarn erfasst.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gute Nachbarn' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Schlechte Nachbarn' })).toBeNull();
    const addGood = screen.getByRole('button', { name: 'Guten Nachbarn hinzufügen' });
    const addBad = screen.getByRole('button', { name: 'Schlechten Nachbarn hinzufügen' });
    // The line sits above the buttons; the buttons carry the kind's colour.
    expect(screen.getByText('Noch keine Nachbarn erfasst.').compareDocumentPosition(addGood) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(addGood).toHaveClass('MuiButton-colorSuccess');
    expect(addBad).toHaveClass('MuiButton-colorWarning');

    fireEvent.click(addGood);

    expect(screen.queryByText('Noch keine Nachbarn erfasst.')).toBeNull();
    const goodGroup = screen.getByTestId('companion-form-group-good');
    expect(within(goodGroup).getByRole('heading', { name: 'Gute Nachbarn' })).toBeInTheDocument();
    expect(screen.queryByTestId('companion-form-group-bad')).toBeNull();
    // The add buttons stay below the groups.
    expect(goodGroup.compareDocumentPosition(addBad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds, edits and removes rows; the changes are saved with the form', async () => {
    render(<Harness crop={TOMATO} isKulturForm />);
    await screen.findAllByTestId('crop-companion-form-row');

    fireEvent.click(screen.getByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    const goodRow = within(screen.getByTestId('companion-form-group-good')).getByTestId('crop-companion-form-row');
    fireEvent.change(within(goodRow).getByRole('combobox', { name: /^Nachbar$/ }), { target: { value: 'Basil' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Basilikum' }));
    const badRow = within(screen.getByTestId('companion-form-group-bad')).getByTestId('crop-companion-form-row');
    fireEvent.click(within(badRow).getByRole('button', { name: 'Nachbar entfernen' }));

    expect(screen.getByTestId('dirty')).toHaveTextContent('true');
    expect(payload()).toEqual([{
      companion_crop: 3, companion_family: null, companion_text: '', kind: 'good', reason: 'other', note: '', note_language_code: 'de',
    }]);
  });

  it('moves a neighbour to the other group', async () => {
    render(<Harness crop={TOMATO} isKulturForm />);
    const row = await screen.findByTestId('crop-companion-form-row');

    fireEvent.click(within(row).getByRole('button', { name: 'Zu den guten Nachbarn verschieben' }));

    expect(within(screen.getByTestId('companion-form-group-good')).getByTestId('crop-companion-form-row')).toBeInTheDocument();
    expect(payload()).toEqual([expect.objectContaining({ companion_crop: 2, kind: 'good' })]);
  });

  it('keeps typed text that matches nothing as a free-text neighbour', async () => {
    api.listForCrop.mockResolvedValue({ data: [] });
    render(<Harness crop={TOMATO} isKulturForm />);
    await waitFor(() => expect(api.listForCrop).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: 'Schlechten Nachbarn hinzufügen' }));
    fireEvent.change(screen.getByRole('combobox', { name: /^Nachbar$/ }), { target: { value: 'Salbei' } });

    expect(payload()).toEqual([expect.objectContaining({ companion_crop: null, companion_text: 'Salbei', kind: 'bad' })]);
  });

  it('reports a row without a neighbour and a neighbour listed twice', async () => {
    render(<Harness crop={TOMATO} isKulturForm />);
    await screen.findAllByTestId('crop-companion-form-row');

    fireEvent.click(screen.getByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    const goodRows = within(screen.getByTestId('companion-form-group-good')).getAllByTestId('crop-companion-form-row');
    fireEvent.change(within(goodRows[1]).getByRole('combobox', { name: /^Nachbar$/ }), { target: { value: 'Kartoffel' } });
    fireEvent.click(screen.getByRole('button', { name: 'validate' }));

    expect(within(goodRows[0]).getByText('Bitte wähle einen Nachbarn.')).toBeInTheDocument();
    expect(within(goodRows[1]).getByText('Dieser Nachbar ist bereits erfasst.')).toBeInTheDocument();
  });

  it("shows a Sorte its Kultur's list read-only", async () => {
    render(<Harness crop={ROMA} isKulturForm={false} />);

    expect(await screen.findByText('Kartoffel')).toBeInTheDocument();
    expect(screen.getByText('· Gleiche Schädlinge oder Krankheiten: Krautfäule')).toBeInTheDocument();
    expect(screen.getByText('Schlechte Nachbarn')).toBeInTheDocument();
    expect(api.listForCrop).toHaveBeenCalledWith(1);
    expect(screen.getByText(/werden im Formular von Tomate bearbeitet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hinzufügen/ })).not.toBeInTheDocument();
  });

  it('tells a Sorte in one sentence when its Kultur has no neighbours', async () => {
    api.listForCrop.mockResolvedValue({ data: [] });
    render(<Harness crop={ROMA} isKulturForm={false} />);

    expect(await screen.findByText(
      'Für Tomate sind noch keine Nachbarn erfasst. Sie gelten für alle Sorten und werden im Formular von Tomate bearbeitet.',
    )).toBeInTheDocument();
    expect(screen.queryByText('Die Nachbarn gelten für alle Sorten von Tomate und werden im Formular von Tomate bearbeitet.'))
      .toBeNull();
    expect(screen.queryByRole('button', { name: /hinzufügen/ })).not.toBeInTheDocument();
  });
});

describe('useCompanionFormRows in the library form', () => {
  beforeEach(() => {
    resetPlantFamiliesCache();
    api.families.mockResolvedValue({ data: [] });
  });

  it('offers library crop species and families and returns library items', () => {
    const entry = { id: 7, name: 'Tomate', variety: '', crop_species: 70 } as Crop;
    const entries = [entry, { id: 8, name: 'Fenchel', variety: '', crop_species: 80 } as Crop];
    const companions: PublicCropCompanion[] = [
      { species: 80, species_name: 'Fenchel', family: null, kind: 'bad', reason: 'allelopathy', note: '' },
    ];

    const { result } = renderHook(() => useCompanionFormRows({
      variant: 'publicLibrary', crop: entry, crops: entries, isKulturForm: true, libraryCompanions: companions,
    }));

    expect(result.current.allowFreeText).toBe(false);
    expect(result.current.options.map((option) => option.label)).toEqual(['Fenchel']);
    expect(formRowsToLibraryItems(result.current.rows)).toEqual(companions.map((item) => ({ ...item, note_language_code: 'de' })));
    act(() => result.current.setRows([]));
    expect(result.current.dirty).toBe(true);
  });
});

const FAMILIES = [
  { botanical_name: 'Solanaceae', translations: { de: 'Nachtschattengewächse' }, default_rotation_break_years: 3 },
  { botanical_name: 'Brassicaceae', translations: { de: 'Kreuzblütler' }, default_rotation_break_years: 3 },
  { botanical_name: 'Apiaceae', translations: { de: 'Doldenblütler' }, default_rotation_break_years: 3 },
];

/** Headings and options of the open list, in their order on screen. */
const openListLines = () => within(screen.getByRole('listbox'))
  .getAllByText((_content, element) => (
    element?.getAttribute('role') === 'option' || Boolean(element?.classList.contains('MuiAutocomplete-groupLabel'))
  ))
  .map((element) => element.textContent);

const openNeighborList = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Nachbar$/ }));
  await screen.findByRole('listbox');
};

describe('neighbour options grouped by plant family', () => {
  beforeEach(() => {
    resetPlantFamiliesCache();
    api.families.mockResolvedValue({ data: FAMILIES });
    api.listForCrop.mockResolvedValue({ data: [] });
  });

  describe('in the project form', () => {
    const POTATO_PLANT = { id: 1, name: 'Kartoffel', variety: '', crop_family: 'Solanaceae' } as Crop;
    const PROJECT_CROPS = [
      POTATO_PLANT,
      { id: 2, name: 'Tomate', variety: '', crop_family: 'Solanaceae' },
      { id: 3, name: 'Aubergine', variety: '', crop_family: 'Solanaceae' },
      { id: 4, name: 'Basilikum', variety: '', crop_family: null },
      // A Sorte is no neighbour; the neighbours are Kulturen.
      { id: 5, name: 'Tomate', variety: 'Roma', crop_family: 'Solanaceae', general_crop: 2 },
      { id: 6, name: 'Rucola', variety: '', crop_family: null, effective_values: { crop_family: 'Brassicaceae' } },
    ] as Crop[];

    function ProjectHarness() {
      const state = useCompanionFormRows({ variant: 'project', crop: POTATO_PLANT, crops: PROJECT_CROPS, isKulturForm: true });
      return (
        <>
          <CompanionsSection state={state} />
          <output data-testid="payload">{JSON.stringify(formRowsToReplaceItems(state.rows))}</output>
        </>
      );
    }

    it('lists each family first, then its crops, and crops without a family last', async () => {
      render(<ProjectHarness />);
      await screen.findByText('Mischkultur');
      await waitFor(() => expect(api.families).toHaveBeenCalled());
      await openNeighborList();

      await waitFor(() => expect(openListLines()).toEqual([
        'Doldenblütler',
        'Doldenblütler (ganze Familie)',
        'Kreuzblütler',
        'Kreuzblütler (ganze Familie)',
        'Rucola',
        'Nachtschattengewächse',
        'Nachtschattengewächse (ganze Familie)',
        'Aubergine',
        'Tomate',
        'Ohne Pflanzenfamilie',
        'Basilikum',
      ]));
    });

    it("keeps the crop's own family pickable and shows only its name once chosen", async () => {
      render(<ProjectHarness />);
      await openNeighborList();

      fireEvent.click(await screen.findByRole('option', { name: 'Nachtschattengewächse (ganze Familie)' }));

      expect(screen.getByRole('combobox', { name: /^Nachbar$/ })).toHaveValue('Nachtschattengewächse');
      expect(payload()).toEqual([expect.objectContaining({ companion_family: 'Solanaceae', companion_crop: null })]);
    });

    it('shows a typed crop under its family heading', async () => {
      render(<ProjectHarness />);
      await openNeighborList();
      await screen.findByRole('option', { name: 'Tomate' });

      fireEvent.change(screen.getByRole('combobox', { name: /^Nachbar$/ }), { target: { value: 'Toma' } });

      await waitFor(() => expect(openListLines()).toEqual(['Nachtschattengewächse', 'Tomate']));
    });

    it('filters on the family name and keeps typed text as free text', async () => {
      render(<ProjectHarness />);
      await openNeighborList();
      await screen.findByRole('option', { name: 'Tomate' });
      const input = screen.getByRole('combobox', { name: /^Nachbar$/ });

      fireEvent.change(input, { target: { value: 'Kreuz' } });
      await waitFor(() => expect(openListLines()).toEqual(['Kreuzblütler', 'Kreuzblütler (ganze Familie)']));

      fireEvent.change(input, { target: { value: 'Salbei' } });
      expect(payload()).toEqual([expect.objectContaining({ companion_text: 'Salbei', companion_family: null })]);
    });
  });

  describe('in the library form', () => {
    const publicCrop = (overrides: Partial<PublicCrop>) => ({ variety: '', crop_family: null, ...overrides }) as PublicCrop;
    const OWN = publicCrop({ id: 1, name: 'Kartoffel', crop_species: 10, crop_family: 'Solanaceae' });
    const ENTRIES = [
      OWN,
      publicCrop({ id: 2, name: 'Kartoffel', crop_species: 10, variety: 'Linda', crop_family: 'Solanaceae' }),
      publicCrop({ id: 3, name: 'Tomate', crop_species: 20, crop_family: 'Solanaceae' }),
      publicCrop({ id: 4, name: 'Tomate', crop_species: 20, variety: 'Roma', crop_family: 'Solanaceae' }),
      // A second species-level entry of one species still offers it only once.
      publicCrop({ id: 5, name: 'Tomate', crop_species: 20, crop_family: 'Solanaceae' }),
      publicCrop({ id: 6, name: 'Basilikum', crop_species: 30 }),
      publicCrop({ id: 7, name: 'Ohne Art', crop_species: null, crop_family: 'Solanaceae' }),
    ];

    function LibraryHarness() {
      const state = useCompanionFormRows({
        variant: 'publicLibrary',
        crop: publicCropToCropFormData(OWN),
        crops: ENTRIES.map(publicCropToCropFormData),
        isKulturForm: true,
      });
      return <CompanionsSection state={state} />;
    }

    it("offers the other species once each, grouped by family, without the entry's own", async () => {
      render(<LibraryHarness />);
      await openNeighborList();

      await waitFor(() => expect(openListLines()).toEqual([
        'Doldenblütler',
        'Doldenblütler (ganze Familie)',
        'Kreuzblütler',
        'Kreuzblütler (ganze Familie)',
        'Nachtschattengewächse',
        'Nachtschattengewächse (ganze Familie)',
        'Tomate',
        'Ohne Pflanzenfamilie',
        'Basilikum',
      ]));
    });
  });
});
