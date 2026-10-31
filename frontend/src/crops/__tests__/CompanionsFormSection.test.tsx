import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';

import type { Crop, CropCompanion, PublicCropCompanion } from '../../api/types';
import { formRowsToLibraryItems, formRowsToReplaceItems } from '../companions';
import { resetPlantFamiliesCache } from '../plantFamilies';
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

  it("loads the Kultur's neighbours and marks a shared pair", async () => {
    render(<Harness crop={TOMATO} isKulturForm />);

    const row = (await screen.findAllByTestId('crop-companion-form-row'))[0];
    expect(api.listForCrop).toHaveBeenCalledWith(1);
    expect(within(row).getByRole('combobox', { name: /Nachbar/ })).toHaveValue('Kartoffel');
    expect(within(row).getByText('Gilt auch für Kartoffel.')).toBeInTheDocument();
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
  });

  it('adds, edits and removes rows; the changes are saved with the form', async () => {
    render(<Harness crop={TOMATO} isKulturForm />);
    await screen.findAllByTestId('crop-companion-form-row');

    fireEvent.click(screen.getByRole('button', { name: 'Nachbar hinzufügen' }));
    const rows = screen.getAllByTestId('crop-companion-form-row');
    fireEvent.change(within(rows[1]).getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Basil' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Basilikum' }));
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Nachbar entfernen' }));

    expect(screen.getByTestId('dirty')).toHaveTextContent('true');
    expect(payload()).toEqual([{
      companion_crop: 3, companion_family: null, companion_text: '', kind: 'good', reason: 'other', note: '',
    }]);
  });

  it('keeps typed text that matches nothing as a free-text neighbour', async () => {
    api.listForCrop.mockResolvedValue({ data: [] });
    render(<Harness crop={TOMATO} isKulturForm />);
    await waitFor(() => expect(api.listForCrop).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: 'Nachbar hinzufügen' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Salbei' } });

    expect(payload()).toEqual([expect.objectContaining({ companion_crop: null, companion_text: 'Salbei' })]);
  });

  it('reports a row without a neighbour and a neighbour listed twice', async () => {
    render(<Harness crop={TOMATO} isKulturForm />);
    await screen.findAllByTestId('crop-companion-form-row');

    fireEvent.click(screen.getByRole('button', { name: 'Nachbar hinzufügen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nachbar hinzufügen' }));
    const rows = screen.getAllByTestId('crop-companion-form-row');
    fireEvent.change(within(rows[2]).getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Kartoffel' } });
    fireEvent.click(screen.getByRole('button', { name: 'validate' }));

    expect(within(rows[1]).getByText('Bitte wähle einen Nachbarn.')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Dieser Nachbar ist bereits erfasst.')).toBeInTheDocument();
  });

  it("shows a Sorte its Kultur's list read-only", async () => {
    render(<Harness crop={ROMA} isKulturForm={false} />);

    expect(await screen.findByText('Schlechter Nachbar: Kartoffel')).toBeInTheDocument();
    expect(api.listForCrop).toHaveBeenCalledWith(1);
    expect(screen.getByText(/werden im Formular von Tomate bearbeitet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nachbar hinzufügen' })).not.toBeInTheDocument();
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
