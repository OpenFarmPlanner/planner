import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Crop, PublicCrop } from '../api/types';
import {
  buildPublishVarietyCandidates,
  findExistingPublicVariety,
  publishSelectedVarieties,
} from '../crops/publishVarieties';

const { linkPublicCropMock, publishPublicMock } = vi.hoisted(() => ({
  linkPublicCropMock: vi.fn(),
  publishPublicMock: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      linkPublicCrop: linkPublicCropMock,
      publishPublic: publishPublicMock,
    },
  };
});

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

describe('publishSelectedVarieties', () => {
  beforeEach(() => {
    linkPublicCropMock.mockReset();
    linkPublicCropMock.mockResolvedValue({ data: {} });
    publishPublicMock.mockReset();
    publishPublicMock.mockResolvedValue({ data: {} });
  });

  it('publishes new Sorten and links the ones that already exist', async () => {
    const result = await publishSelectedVarieties({
      varieties: [
        { cropId: 2, publicCropId: 40 },
        { cropId: 3, publicCropId: null },
      ],
      cropSpeciesId: 1,
      originalLanguageCode: 'de',
    });

    expect(linkPublicCropMock).toHaveBeenCalledWith(2, 40);
    expect(publishPublicMock).toHaveBeenCalledWith(3, {
      accepted_public_library_terms: false,
      crop_species_id: 1,
      original_language_code: 'de',
    });
    expect(result).toEqual({ published: 1, linked: 1, alreadyPublic: 0, pendingModeration: 0, failed: 0 });
  });

  it('keeps going when a single Sorte fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    publishPublicMock.mockRejectedValueOnce(new Error('nope'));

    const result = await publishSelectedVarieties({
      varieties: [
        { cropId: 2, publicCropId: null },
        { cropId: 3, publicCropId: null },
      ],
      originalLanguageCode: 'de',
    });

    expect(publishPublicMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ published: 1, linked: 0, alreadyPublic: 0, pendingModeration: 0, failed: 1 });
  });

  it('counts a Sorte the backend rejects as a duplicate as already public, not as a failure', async () => {
    publishPublicMock.mockRejectedValueOnce(Object.assign(new Error('conflict'), {
      isAxiosError: true,
      response: { status: 409, data: { code: 'duplicate_public_crop' } },
    }));

    const result = await publishSelectedVarieties({
      varieties: [{ cropId: 2, publicCropId: null }],
      originalLanguageCode: 'de',
    });

    expect(result).toEqual({ published: 0, linked: 0, alreadyPublic: 1, pendingModeration: 0, failed: 0 });
  });

  it('counts a Sorte queued for moderation separately, not as published', async () => {
    // A new-trust-level account or an API token gets 202 pending_moderation
    // instead of a live publish (see docs/account-trust-levels.md); reporting
    // it as published would claim a co-publish that has not happened.
    publishPublicMock.mockResolvedValueOnce({ data: { operation: 'pending_moderation' } });

    const result = await publishSelectedVarieties({
      varieties: [{ cropId: 2, publicCropId: null }],
      originalLanguageCode: 'de',
    });

    expect(result).toEqual({ published: 0, linked: 0, alreadyPublic: 0, pendingModeration: 1, failed: 0 });
  });

  it('passes the accepted library terms on so a Sorte is not rejected for missing consent', async () => {
    await publishSelectedVarieties({
      varieties: [{ cropId: 2, publicCropId: null }],
      cropSpeciesId: 1,
      originalLanguageCode: 'de',
      acceptedPublicLibraryTerms: true,
    });

    expect(publishPublicMock).toHaveBeenCalledWith(2, expect.objectContaining({
      accepted_public_library_terms: true,
    }));
  });
});
