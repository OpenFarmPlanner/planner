import { describe, expect, it } from 'vitest';

import type { Crop } from '../../api/types';
import { collectProjectTags, getEffectiveCropTags, normalizeCropTags } from '../cropTags';

describe('normalizeCropTags', () => {
  it('drops list markers, extra spaces and duplicates', () => {
    expect(normalizeCropTags(['• Getreide', '  Baum  /  Sträucher ', 'getreide', ''])).toEqual(['Getreide', 'Baum / Sträucher']);
  });

  it("takes the project's spelling of a known group", () => {
    expect(normalizeCropTags(['kräuter', 'Neu'], ['Kräuter'])).toEqual(['Kräuter', 'Neu']);
  });
});

describe('collectProjectTags', () => {
  it('lists every group once, sorted, in its first spelling', () => {
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
  it("uses a variety's inherited groups when it has none of its own", () => {
    const variety = { tags: [], effective_values: { tags: ['Kräuter'] } } as Partial<Crop>;

    expect(getEffectiveCropTags(variety)).toEqual(['Kräuter']);
  });
});
