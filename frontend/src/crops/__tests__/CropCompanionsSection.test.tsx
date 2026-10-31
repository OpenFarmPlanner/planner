import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { Crop, CropCompanion } from '../../api/types';
import { GLOBAL_SNACKBAR_EVENT, type GlobalSnackbarDetail } from '../../utils/globalSnackbar';
import { CropCompanionsSection } from '../CropCompanionsSection';
import { resetPlantFamiliesCache } from '../plantFamilies';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  families: vi.fn(),
}));

vi.mock('../../api/api', async () => {
  const actual = await vi.importActual<typeof import('../../api/api')>('../../api/api');
  return {
    ...actual,
    cropCompanionAPI: { list: api.list, create: api.create, update: api.update, delete: api.delete },
    plantFamilyAPI: { list: api.families },
  };
});

const TOMATO = { id: 1, name: 'Tomate', variety: '' } as Crop;
const POTATO = { id: 2, name: 'Kartoffel', variety: '' } as Crop;
const BASIL = { id: 3, name: 'Basilikum', variety: '' } as Crop;
const ROMA = { id: 4, name: 'Tomate', variety: 'Roma', general_crop: 1 } as Crop;
const CROPS = [TOMATO, POTATO, BASIL, ROMA];

const relation = (overrides: Partial<CropCompanion>): CropCompanion => ({
  id: 10,
  crop: 1,
  companion_crop: 2,
  companion_family: null,
  companion_text: '',
  kind: 'bad',
  reason: 'shared_pests_diseases',
  note: 'Kraut- und Braunfäule',
  ...overrides,
});

const renderSection = (crop: Crop = TOMATO, onCropSelect = vi.fn()) => {
  render(<CropCompanionsSection crop={crop} crops={CROPS} onCropSelect={onCropSelect} />);
  return { onCropSelect };
};

describe('CropCompanionsSection', () => {
  beforeEach(() => {
    resetPlantFamiliesCache();
    api.families.mockResolvedValue({
      data: [{ botanical_name: 'Brassicaceae', translations: { de: 'Kreuzblütler' }, default_rotation_break_years: 3 }],
    });
    api.list.mockResolvedValue({
      data: [
        relation({}),
        relation({ id: 11, crop: 1, companion_crop: 3, kind: 'good', reason: 'pest_control', note: '' }),
        relation({ id: 12, companion_crop: null, companion_family: 'Brassicaceae', kind: 'good', reason: 'other', note: '' }),
      ],
    });
  });

  it('lists good and bad neighbours with their reason and links to the neighbouring crop', async () => {
    const { onCropSelect } = renderSection();

    const potatoLink = await screen.findByRole('button', { name: 'Kartoffel' });
    expect(screen.getByText('Gleiche Schädlinge oder Krankheiten: Kraut- und Braunfäule')).toBeInTheDocument();
    expect(screen.getByText('Schädlingsabwehr')).toBeInTheDocument();
    expect(await screen.findByText('Kreuzblütler (Pflanzenfamilie)')).toBeInTheDocument();
    expect(screen.getByText('Gute Nachbarn')).toBeInTheDocument();
    expect(screen.getByText('Schlechte Nachbarn')).toBeInTheDocument();

    fireEvent.click(potatoLink);
    expect(onCropSelect).toHaveBeenCalledWith(POTATO);
  });

  it('shows a shared pair from the other side too', async () => {
    renderSection(POTATO);

    expect(await screen.findByRole('button', { name: 'Tomate' })).toBeInTheDocument();
  });

  it("shows a variety its Kultur's neighbours", async () => {
    renderSection(ROMA);

    expect(await screen.findByRole('button', { name: 'Kartoffel' })).toBeInTheDocument();
    expect(screen.getByText('Gilt für alle Sorten von Tomate.')).toBeInTheDocument();
  });

  it('guides to the next action when nothing is recorded yet', async () => {
    api.list.mockResolvedValue({ data: [] });
    renderSection();

    expect(await screen.findByText(/Noch keine Nachbarn erfasst/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nachbar hinzufügen' })).toBeInTheDocument();
  });

  it('adds a neighbour picked from the crops', async () => {
    api.list.mockResolvedValue({ data: [] });
    api.create.mockImplementation(async (draft: CropCompanion) => ({ data: { id: 20, ...draft } }));
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Nachbar hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Basil' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Basilikum' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith({
      crop: 1,
      companion_crop: 3,
      companion_family: null,
      companion_text: '',
      kind: 'good',
      reason: 'other',
      note: '',
    }));
    expect(await screen.findByRole('button', { name: 'Basilikum' })).toBeInTheDocument();
  });

  it('keeps typed text that matches nothing as a free-text neighbour', async () => {
    api.list.mockResolvedValue({ data: [] });
    api.create.mockImplementation(async (draft: CropCompanion) => ({ data: { id: 21, ...draft } }));
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Nachbar hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Salbei' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      companion_crop: null,
      companion_text: 'Salbei',
    })));
  });

  it('reports a neighbour that is already listed on the field', async () => {
    api.create.mockRejectedValue(Object.assign(new Error('400'), {
      isAxiosError: true,
      response: { status: 400, data: { companion: ['This neighbour is already listed.'] } },
    }));
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Nachbar hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Nachbar/ }), { target: { value: 'Salbei' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await within(dialog).findByText('Dieser Nachbar ist bereits erfasst.')).toBeInTheDocument();
  });

  it('removes a neighbour and offers to undo it', async () => {
    api.delete.mockResolvedValue({});
    api.create.mockImplementation(async (draft: CropCompanion) => ({ data: { id: 30, ...draft } }));
    const snackbars: GlobalSnackbarDetail[] = [];
    const listener = (event: Event) => snackbars.push((event as CustomEvent<GlobalSnackbarDetail>).detail);
    window.addEventListener(GLOBAL_SNACKBAR_EVENT, listener);
    renderSection();

    const potatoRow = (await screen.findByRole('button', { name: 'Kartoffel' })).closest('[data-testid="crop-companion-row"]');
    fireEvent.click(within(potatoRow as HTMLElement).getByRole('button', { name: 'Nachbar entfernen' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(10));
    await waitFor(() => expect(snackbars).toHaveLength(1));
    expect(snackbars[0].message).toBe('Kartoffel als Nachbar entfernt.');
    await snackbars[0].onAction?.();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ crop: 1, companion_crop: 2, kind: 'bad' }));
    window.removeEventListener(GLOBAL_SNACKBAR_EVENT, listener);
  });
});
