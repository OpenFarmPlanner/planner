import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
    expect(screen.getByText('· Gleiche Schädlinge oder Krankheiten: Kraut- und Braunfäule')).toBeInTheDocument();
    expect(screen.getByText('· Schädlingsabwehr')).toBeInTheDocument();
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

  it('says "Keine Angabe" without an edit button when nothing is recorded yet', async () => {
    api.list.mockResolvedValue({ data: [] });
    renderSection(ROMA);

    expect(await screen.findByText('Keine Angabe')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('has no edit controls of its own', async () => {
    renderSection();

    await screen.findByRole('button', { name: 'Kartoffel' });
    expect(screen.queryByRole('button', { name: 'Nachbar hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nachbar entfernen' })).not.toBeInTheDocument();
  });
});
