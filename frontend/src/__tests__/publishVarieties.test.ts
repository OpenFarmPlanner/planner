import { describe, expect, it } from 'vitest';
import type { Crop, PublicCrop } from '../api/types';
import {
  buildPublishVarietyCandidates,
  findExistingPublicVariety,
} from '../crops/publishVarieties';

const publicCrop = (id: number, variety: string): PublicCrop => ({
  id,
  status: 'published',
  name: 'Tomate',
  variety,
  crop_species: 1,
  version: 1,
});

const variety = (id: number, name: string, overrides: Partial<Crop> = {}): Crop => ({
  id,
  name: 'Tomate',
  variety: name,
  ...overrides,
});

describe('findExistingPublicVariety', () => {
  it('matches an identical variety name', () => {
    expect(findExistingPublicVariety(variety(1, 'Roma'), [publicCrop(40, 'Roma')])?.id).toBe(40);
  });

  it('ignores casing and surrounding whitespace', () => {
    expect(findExistingPublicVariety(variety(1, '  roma '), [publicCrop(40, 'Roma')])?.id).toBe(40);
    expect(findExistingPublicVariety(variety(1, 'Roma  Rispen'), [publicCrop(40, 'roma rispen')])?.id).toBe(40);
  });

  it('keeps a longer, distinct variety name separate', () => {
    expect(findExistingPublicVariety(variety(1, 'Roma Rispen'), [publicCrop(40, 'Roma')])).toBeNull();
  });

  it('never links two different cultivars that only look alike', () => {
    // Linking points the user's own Sorte at a stranger's entry and flips it
    // to `imported`, so a one-letter difference must stay two Sorten.
    expect(findExistingPublicVariety(variety(1, 'Matina'), [publicCrop(40, 'Marina')])).toBeNull();
    expect(findExistingPublicVariety(variety(1, 'Romo'), [publicCrop(40, 'Roma')])).toBeNull();
  });

  it('ignores general (varietyless) public entries', () => {
    expect(findExistingPublicVariety(variety(1, 'Roma'), [publicCrop(40, '')])).toBeNull();
  });
});

describe('buildPublishVarietyCandidates', () => {
  it('offers the project Sorten with their matching public entry', () => {
    const candidates = buildPublishVarietyCandidates(
      [variety(2, 'Roma'), variety(3, 'Ochsenherz')],
      [publicCrop(40, 'Roma')],
    );

    expect(candidates.map((candidate) => [candidate.cropId, candidate.label, candidate.existingPublicCrop?.id ?? null]))
      .toEqual([[2, 'Roma', 40], [3, 'Ochsenherz', null]]);
  });

  it('skips Sorten that are already connected to the library', () => {
    const candidates = buildPublishVarietyCandidates(
      [
        variety(2, 'Roma', { owned_public_crop_id: 40 }),
        variety(3, 'Ochsenherz', { source_public_crop: 41 }),
        variety(4, 'San Marzano'),
      ],
      [],
    );

    expect(candidates.map((candidate) => candidate.cropId)).toEqual([4]);
  });
});
