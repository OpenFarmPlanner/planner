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

function Harness({ crop, isKulturForm, crops = CROPS }: { crop: Crop; isKulturForm: boolean; crops?: Crop[] }) {
  const state = useCompanionFormRows({ variant: 'project', crop, crops, isKulturForm });
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

  it("loads the Kultur's neighbours into their group and marks a shared pair", async () => {
    render(<Harness crop={TOMATO} isKulturForm />);

    const badGroup = await screen.findByTestId('companion-form-group-bad');
    const row = await within(badGroup).findByTestId('crop-companion-form-row');
    expect(api.listForCrop).toHaveBeenCalledWith(1);
    expect(within(row).getByRole('combobox', { name: /Nachbar/ })).toHaveValue('Kartoffel');
    expect(within(row).getByTestId('companion-shared-pair')).toHaveAccessibleName('Gilt auch für Kartoffel.');
    expect(within(screen.getByTestId('companion-form-group-good')).queryByTestId('crop-companion-form-row')).toBeNull();
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
  });

  it('adds, edits and removes rows; the changes are saved with the form', async () => {
    render(<Harness crop={TOMATO} isKulturForm />);
    await screen.findAllByTestId('crop-companion-form-row');

    fireEvent.click(screen.getByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    const goodRow = within(screen.getByTestId('companion-form-group-good')).getByTestId('crop-companion-form-row');
    fireEvent.change(within(goodRow).getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Basil' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Basilikum' }));
    const badRow = within(screen.getByTestId('companion-form-group-bad')).getByTestId('crop-companion-form-row');
    fireEvent.click(within(badRow).getByRole('button', { name: 'Nachbar entfernen' }));

    expect(screen.getByTestId('dirty')).toHaveTextContent('true');
    expect(payload()).toEqual([{
      companion_crop: 3, companion_family: null, companion_text: '', kind: 'good', reason: 'other', note: '',
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
    fireEvent.change(screen.getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Salbei' } });

    expect(payload()).toEqual([expect.objectContaining({ companion_crop: null, companion_text: 'Salbei', kind: 'bad' })]);
  });

  it('reports a row without a neighbour and a neighbour listed twice', async () => {
    render(<Harness crop={TOMATO} isKulturForm />);
    await screen.findAllByTestId('crop-companion-form-row');

    fireEvent.click(screen.getByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    const goodRows = within(screen.getByTestId('companion-form-group-good')).getAllByTestId('crop-companion-form-row');
    fireEvent.change(within(goodRows[1]).getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Kartoffel' } });
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
    expect(formRowsToLibraryItems(result.current.rows)).toEqual(companions);
    act(() => result.current.setRows([]));
    expect(result.current.dirty).toBe(true);
  });
});

const FAMILIES = [
  { botanical_name: 'Solanaceae', translations: { de: 'Nachtschattengewächse' }, default_rotation_break_years: 3 },
  { botanical_name: 'Brassicaceae', translations: { de: 'Kreuzblütler' }, default_rotation_break_years: 3 },
  { botanical_name: 'Apiaceae', translations: { de: 'Doldenblütler' }, default_rotation_break_years: 3 },
];

const optionsByGroup = (state: ReturnType<typeof useCompanionFormRows>) => state.options.map((option) => (
  [state.optionGroup(option) ?? '–', option.type, option.label]
));

describe('neighbour options grouped by plant family', () => {
  const kultur = (id: number, name: string, family: string | null, extra: Partial<Crop> = {}) => (
    { id, name, variety: '', crop_family: family, ...extra } as Crop
  );
  const tomato = kultur(1, 'Tomate', 'Solanaceae');
  const projectCrops = [
    tomato,
    kultur(2, 'Paprika', 'Solanaceae'),
    kultur(3, 'Kartoffel', 'Solanaceae'),
    kultur(4, 'Kohlrabi', null, { effective_values: { crop_family: 'Brassicaceae' } } as Partial<Crop>),
    kultur(5, 'Basilikum', null),
    { id: 6, name: 'Tomate', variety: 'Roma', crop_family: 'Solanaceae', general_crop: 1 } as Crop,
  ];

  beforeEach(() => {
    resetPlantFamiliesCache();
    api.families.mockResolvedValue({ data: FAMILIES });
    api.listForCrop.mockResolvedValue({ data: [] });
  });

  it('lists each family first, then its crops, families alphabetically and crops without a family last', async () => {
    const { result } = renderHook(() => useCompanionFormRows({
      variant: 'project', crop: tomato, crops: projectCrops, isKulturForm: true,
    }));

    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(4));
    expect(optionsByGroup(result.current)).toEqual([
      ['Doldenblütler', 'family', 'Doldenblütler'],
      ['Kreuzblütler', 'family', 'Kreuzblütler'],
      ['Kreuzblütler', 'crop', 'Kohlrabi'],
      // The crop's own family stays selectable; the crop itself and its Sorten do not.
      ['Nachtschattengewächse', 'family', 'Nachtschattengewächse'],
      ['Nachtschattengewächse', 'crop', 'Kartoffel'],
      ['Nachtschattengewächse', 'crop', 'Paprika'],
      ['–', 'crop', 'Basilikum'],
    ]);
  });

  it('shows the group headings and marks the family option, but the field shows the name only', async () => {
    render(<Harness crop={tomato} crops={projectCrops} isKulturForm />);
    await waitFor(() => expect(api.listForCrop).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Schlechten Nachbarn hinzufügen' }));
    const field = screen.getByRole('combobox', { name: /Nachbar/ });

    fireEvent.mouseDown(field);
    fireEvent.change(field, { target: { value: 'Kart' } });
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('Nachtschattengewächse')).toBeInTheDocument();
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Kartoffel']);

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(await screen.findByText('Ohne Pflanzenfamilie')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Nachtschattengewächse (ganze Familie)' }));

    expect(field).toHaveValue('Nachtschattengewächse');
    expect(payload()).toEqual([expect.objectContaining({ companion_family: 'Solanaceae', kind: 'bad' })]);
  });

  it('offers the other library crop species once each, grouped by family, not the entry\'s own species', async () => {
    const publicCrop = (id: number, name: string, species: number, family: string | null, variety = '') => (
      publicCropToCropFormData({
        id, name, variety, status: 'published', version: 1, crop_species: species, crop_family: family,
      } as PublicCrop)
    );
    const entries = [
      publicCrop(1, 'Tomate', 70, 'Solanaceae'),
      publicCrop(2, 'Tomate', 70, 'Solanaceae', 'Roma'),
      publicCrop(3, 'Kartoffel', 71, 'Solanaceae'),
      publicCrop(4, 'Kartoffel', 71, 'Solanaceae'),
      publicCrop(5, 'Fenchel', 80, null),
    ];

    const { result } = renderHook(() => useCompanionFormRows({
      variant: 'publicLibrary', crop: entries[0], crops: entries, isKulturForm: true, libraryCompanions: [],
    }));

    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(2));
    expect(optionsByGroup(result.current)).toEqual([
      ['Doldenblütler', 'family', 'Doldenblütler'],
      ['Kreuzblütler', 'family', 'Kreuzblütler'],
      ['Nachtschattengewächse', 'family', 'Nachtschattengewächse'],
      ['Nachtschattengewächse', 'species', 'Kartoffel'],
      ['–', 'species', 'Fenchel'],
    ]);
  });
});
