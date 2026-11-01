import { describe, expect, it } from 'vitest';

import type { Crop } from '../../api/types';
import { collectProjectTags, getEffectiveCropTags, normalizeCropTags } from '../cropTags';

describe('normalizeCropTags', () => {
  it('drops list markers, extra spaces and duplicates', () => {
    expect(normalizeCropTags(['• Getreide', '  Baum  /  Sträucher ', 'getreide', ''])).toEqual(['Getreide', 'Baum / Sträucher']);
  });

  it("takes the project's spelling of a known tag", () => {
    expect(normalizeCropTags(['kräuter', 'Neu'], ['Kräuter'])).toEqual(['Kräuter', 'Neu']);
  });
});

describe('collectProjectTags', () => {
  it('lists every tag once, sorted, in its first spelling', () => {
    const crops = [
      { tags: ['Kräuter', 'Blumen'] },
      { tags: ['kräuter'] },
      { tags: [] },
      {},
    ] as Partial<Crop>[];

    expect(collectProjectTags(crops)).toEqual(['Blumen', 'Kräuter']);
  });
});

describe('getEffectiveCropTags', () => {
  it("uses a variety's inherited tags when it has none of its own", () => {
    const variety = { tags: [], effective_values: { tags: ['Kräuter'] } } as Partial<Crop>;

    expect(getEffectiveCropTags(variety)).toEqual(['Kräuter']);
  });
});
