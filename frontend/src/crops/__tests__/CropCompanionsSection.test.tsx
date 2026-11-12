import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Crop, CropCompanion } from '../../api/types';
import { CropCompanionsSection } from '../CropCompanionsSection';
import { resetPlantFamiliesCache } from '../plantFamilies';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  families: vi.fn(),
}));

vi.mock('../../api/api', async () => {
  const actual = await vi.importActual<typeof import('../../api/api')>('../../api/api');
  return {
    ...actual,
    cropCompanionAPI: { list: api.list },
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

const renderSection = (crop: Crop = TOMATO, onCropSelect = vi.fn(), crops = CROPS) => {
  render(<CropCompanionsSection crop={crop} crops={crops} onCropSelect={onCropSelect} />);
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

  it('uses resolved names in the variety hint and both sides of linked neighbours', async () => {
    const crops = CROPS.map(crop => ({ ...crop, crop_display_name: crop.id === 2 ? 'Potato' : 'Tomato' }));
    const select = vi.fn();
    renderSection(crops[3], select, crops);
    const neighbor = await screen.findByRole('button', { name: 'Potato' });
    expect(screen.getByText('Gilt für alle Sorten von Tomato.')).toBeInTheDocument();
    expect(screen.queryByText('Kartoffel')).not.toBeInTheDocument();
    fireEvent.click(neighbor);
    expect(select).toHaveBeenCalledWith(crops[1]);
  });

  it('renders nothing while no neighbour is recorded', async () => {
    api.list.mockResolvedValue({ data: [] });
    renderSection(ROMA);

    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByTestId('crop-companions-section')).not.toBeInTheDocument();
    expect(screen.queryByText('Keine Angabe')).not.toBeInTheDocument();
  });

  it('shows a load error even without neighbours', async () => {
    api.list.mockRejectedValue(new Error('offline'));
    renderSection();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('has no edit controls of its own', async () => {
    renderSection();

    await screen.findByRole('button', { name: 'Kartoffel' });
    expect(screen.queryByRole('button', { name: 'Nachbar hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nachbar entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('offers adding neighbours to an empty editable Kultur', async () => {
    api.list.mockResolvedValue({ data: [] });
    const edit = vi.fn();
    render(<CropCompanionsSection crop={TOMATO} crops={CROPS} onEdit={edit} />);
    const add = await screen.findByRole('button', { name: 'Nachbarn hinzufügen' });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(edit).toHaveBeenCalledWith(TOMATO);
  });

  it('opens the same Kultur from a variety, without offering variety ownership', async () => {
    const edit = vi.fn();
    render(<CropCompanionsSection crop={ROMA} crops={CROPS} onEdit={edit} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(edit).toHaveBeenCalledWith(TOMATO);
  });

  it('presents absence prose as information rather than a negative neighbour', async () => {
    api.list.mockResolvedValue({ data: [relation({ companion_crop: null, companion_text: 'No specific bad neighbors known — all-rounder', reason: 'other', note: '' })] });
    renderSection();
    expect(await screen.findByText('Allgemeiner Hinweis')).toBeInTheDocument();
    expect(screen.getByText('No specific bad neighbors known — all-rounder')).toBeInTheDocument();
    expect(screen.queryByText('Schlechte Nachbarn')).not.toBeInTheDocument();
  });

  it('still offers Add neighbours when there is only general information', async () => {
    api.list.mockResolvedValue({ data: [relation({ companion_crop: null, companion_text: 'No bad neighbors known.', note: '' })] });
    render(<CropCompanionsSection crop={TOMATO} crops={CROPS} onEdit={vi.fn()} />);
    await screen.findByText('Allgemeiner Hinweis');
    expect(screen.getByRole('button', { name: 'Nachbarn hinzufügen' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
