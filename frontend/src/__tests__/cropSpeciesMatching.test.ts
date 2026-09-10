import {
  findMatchedCropSpeciesAlias,
  formatCropSpeciesMatchLabel,
  getCropSpeciesCanonicalName,
  getCropSpeciesSearchNames,
  getPublicCropSpeciesSearchNames,
  hasStrongCropSpeciesIdentityMatch,
  isCropSpeciesSearchMatch,
  normalizeCropSpeciesSearchValue,
} from '../crops/cropSpeciesMatching';
import type { CropSpecies, PublicCrop } from '../api/types';

describe('normalizeCropSpeciesSearchValue', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeCropSpeciesSearchValue('  Rote   Bete \t')).toBe('rote bete');
  });

  it('lowercases German umlauts and ß', () => {
    expect(normalizeCropSpeciesSearchValue('MÖHRE')).toBe('möhre');
    expect(normalizeCropSpeciesSearchValue('WEISSKOHL')).toBe('weisskohl');
  });

  it('treats null and undefined as empty', () => {
    expect(normalizeCropSpeciesSearchValue(null)).toBe('');
    expect(normalizeCropSpeciesSearchValue(undefined)).toBe('');
  });
});

describe('isCropSpeciesSearchMatch — permissive, for filtering a list', () => {
  it('matches an exact name', () => {
    expect(isCropSpeciesSearchMatch('Möhre', ['Möhre'])).toBe(true);
  });

  it('matches a prefix, so results narrow as the user types', () => {
    expect(isCropSpeciesSearchMatch('kohl', ['Kohlrabi'])).toBe(true);
  });

  it('matches when the search is longer than the name', () => {
    expect(isCropSpeciesSearchMatch('Kohlrabi', ['Kohl'])).toBe(true);
  });

  it('forgives a single typo in a short name', () => {
    expect(isCropSpeciesSearchMatch('Mohre', ['Möhre'])).toBe(true);
  });

  it('forgives two typos once the name is long enough', () => {
    expect(isCropSpeciesSearchMatch('Zuchcini', ['Zucchini'])).toBe(true);
  });

  it('rejects an unrelated name', () => {
    expect(isCropSpeciesSearchMatch('Tomate', ['Möhre'])).toBe(false);
  });

  it('matches any one of several names', () => {
    expect(isCropSpeciesSearchMatch('carrot', ['Möhre', 'carrot'])).toBe(true);
  });

  it('matches nothing for an empty search', () => {
    expect(isCropSpeciesSearchMatch('', ['Möhre'])).toBe(false);
    expect(isCropSpeciesSearchMatch('   ', ['Möhre'])).toBe(false);
  });
});

describe('hasStrongCropSpeciesIdentityMatch — strict, for claiming identity', () => {
  it('accepts an exact name', () => {
    expect(hasStrongCropSpeciesIdentityMatch('Möhre', [{ searchNames: ['Möhre'] }])).toBe(true);
  });

  it('refuses a mere prefix, which is the whole point of the strict matcher', () => {
    // The permissive matcher shows Kohlrabi while the user types "kohl";
    // this one must not conclude that "kohl" *is* Kohlrabi.
    expect(isCropSpeciesSearchMatch('kohl', ['Kohlrabi'])).toBe(true);
    expect(hasStrongCropSpeciesIdentityMatch('kohl', [{ searchNames: ['Kohlrabi'] }])).toBe(false);
  });

  it('refuses a name that merely contains the search', () => {
    expect(hasStrongCropSpeciesIdentityMatch('Kohlrabi', [{ searchNames: ['Kohl'] }])).toBe(false);
  });

  it('still forgives a typo, since that is a misspelling not a different plant', () => {
    expect(hasStrongCropSpeciesIdentityMatch('Mohre', [{ searchNames: ['Möhre'] }])).toBe(true);
  });

  it('is satisfied by any one of the options', () => {
    expect(hasStrongCropSpeciesIdentityMatch('carrot', [
      { searchNames: ['Möhre'] },
      { searchNames: ['carrot'] },
    ])).toBe(true);
  });

  it('claims nothing for an empty search', () => {
    expect(hasStrongCropSpeciesIdentityMatch('', [{ searchNames: ['Möhre'] }])).toBe(false);
  });

  it('claims nothing when there are no options', () => {
    expect(hasStrongCropSpeciesIdentityMatch('Möhre', [])).toBe(false);
  });
});

describe('getCropSpeciesSearchNames', () => {
  it('gathers the canonical name, aliases, translations, synonyms and regional names', () => {
    const species = {
      name: 'Daucus carota',
      display_name: 'Möhre',
      search_names: ['Karotte'],
      translations: [
        { common_name: 'Carrot', synonyms: ['Garden carrot'], regional_names: { at: 'Gelbe Rübe' } },
      ],
    } as unknown as CropSpecies;

    expect(getCropSpeciesSearchNames(species)).toEqual(
      expect.arrayContaining(['Daucus carota', 'Möhre', 'Karotte', 'Carrot', 'Garden carrot', 'Gelbe Rübe']),
    );
  });

  it('drops duplicates that differ only in case or spacing', () => {
    const species = {
      name: 'Möhre',
      display_name: 'möhre',
      search_names: ['  Möhre  '],
    } as unknown as CropSpecies;

    expect(getCropSpeciesSearchNames(species)).toEqual(['Möhre']);
  });

  it('drops empty entries', () => {
    const species = { name: 'Möhre', display_name: '', search_names: ['', '   '] } as unknown as CropSpecies;

    expect(getCropSpeciesSearchNames(species)).toEqual(['Möhre']);
  });

  it('survives a species with no aliases at all', () => {
    expect(getCropSpeciesSearchNames({ name: 'Möhre' } as unknown as CropSpecies)).toEqual(['Möhre']);
  });
});

describe('getPublicCropSpeciesSearchNames', () => {
  it('uses the species names when the crop is linked to one', () => {
    const crop = {
      crop_species: 3,
      crop_species_canonical_name: 'Daucus carota',
      crop_species_name: 'Möhre',
      crop_species_search_names: ['Karotte'],
    } as unknown as PublicCrop;

    expect(getPublicCropSpeciesSearchNames(crop)).toEqual(
      expect.arrayContaining(['Daucus carota', 'Möhre', 'Karotte']),
    );
  });

  it('falls back to the crop’s own name when it is linked to no species', () => {
    const crop = { crop_species: null, name: 'Unbekannte Kultur' } as unknown as PublicCrop;

    expect(getPublicCropSpeciesSearchNames(crop)).toEqual(['Unbekannte Kultur']);
  });
});

describe('getCropSpeciesCanonicalName', () => {
  it('prefers the botanical name', () => {
    expect(getCropSpeciesCanonicalName({ name: 'Daucus carota', display_name: 'Möhre' })).toBe('Daucus carota');
  });

  it('falls back to the display name', () => {
    expect(getCropSpeciesCanonicalName({ name: '', display_name: 'Möhre' })).toBe('Möhre');
  });

  it('yields an empty string when it has neither', () => {
    expect(getCropSpeciesCanonicalName({ name: '', display_name: '' })).toBe('');
  });
});

describe('findMatchedCropSpeciesAlias', () => {
  const canonical = 'Daucus carota';
  const names = [canonical, 'Möhre', 'Karotte'];

  it('names the alias the search actually hit', () => {
    expect(findMatchedCropSpeciesAlias('karot', canonical, names)).toBe('Karotte');
  });

  it('never reports the canonical name as an alias of itself', () => {
    expect(findMatchedCropSpeciesAlias('daucus', canonical, names)).toBeNull();
  });

  it('matches an alias contained in a longer search', () => {
    expect(findMatchedCropSpeciesAlias('Möhre gelb', canonical, names)).toBe('Möhre');
  });

  it('returns null when nothing matches', () => {
    expect(findMatchedCropSpeciesAlias('Tomate', canonical, names)).toBeNull();
  });

  it('returns null for an empty search', () => {
    expect(findMatchedCropSpeciesAlias('', canonical, names)).toBeNull();
  });
});

describe('formatCropSpeciesMatchLabel', () => {
  it('shows the alias in brackets so the user sees why it matched', () => {
    expect(formatCropSpeciesMatchLabel('Daucus carota', 'Karotte')).toBe('Daucus carota (Karotte)');
  });

  it('shows the canonical name alone when nothing else matched', () => {
    expect(formatCropSpeciesMatchLabel('Daucus carota', null)).toBe('Daucus carota');
    expect(formatCropSpeciesMatchLabel('Daucus carota', undefined)).toBe('Daucus carota');
  });
});
