import {
  EMPTY_PUBLIC_CROP_FILTERS,
  countActivePublicCropFilters,
  getPublicCropFilterOptions,
  matchesPublicCropFilters,
  type PublicCropFilterState,
} from '../crop-library/publicCropFilters';
import type { PublicCrop } from '../api/types';

const crop = (overrides: Partial<PublicCrop> = {}): PublicCrop => ({
  id: 1, name: 'Tomate', ...overrides,
} as PublicCrop);

const filters = (overrides: Partial<PublicCropFilterState> = {}): PublicCropFilterState => ({
  ...EMPTY_PUBLIC_CROP_FILTERS, ...overrides,
});

describe('countActivePublicCropFilters', () => {
  it('counts nothing when nothing is set', () => {
    expect(countActivePublicCropFilters(EMPTY_PUBLIC_CROP_FILTERS)).toBe(0);
  });

  it('counts each filled field', () => {
    expect(countActivePublicCropFilters(filters({ cropFamily: 'Nachtschatten', yieldMin: '2' }))).toBe(2);
  });

  it('does not count a field the user cleared back to empty', () => {
    expect(countActivePublicCropFilters(filters({ cropFamily: '' }))).toBe(0);
  });
});

describe('getPublicCropFilterOptions', () => {
  it('offers each distinct value once, sorted', () => {
    const options = getPublicCropFilterOptions([
      crop({ crop_family: 'Nachtschatten' }),
      crop({ crop_family: 'Doldenblütler' }),
      crop({ crop_family: 'Nachtschatten' }),
    ]);

    expect(options.cropFamilyOptions).toEqual(['Doldenblütler', 'Nachtschatten']);
  });

  it('trims values, so a stray space does not create a second option', () => {
    const options = getPublicCropFilterOptions([
      crop({ crop_family: 'Nachtschatten' }),
      crop({ crop_family: '  Nachtschatten  ' }),
    ]);

    expect(options.cropFamilyOptions).toEqual(['Nachtschatten']);
  });

  it('skips crops with the field missing or blank', () => {
    const options = getPublicCropFilterOptions([
      crop({ crop_family: 'Nachtschatten' }),
      crop({ crop_family: '' }),
      crop({}),
    ]);

    expect(options.cropFamilyOptions).toEqual(['Nachtschatten']);
  });

  it('offers varieties and nutrient demands the same way', () => {
    const options = getPublicCropFilterOptions([
      crop({ variety: 'Roma', nutrient_demand: 'high' }),
      crop({ variety: 'Cherry', nutrient_demand: 'high' }),
    ]);

    expect(options.varietyOptions).toEqual(['Cherry', 'Roma']);
    expect(options.nutrientOptions).toEqual(['high']);
  });

  it('has nothing to offer for an empty library', () => {
    expect(getPublicCropFilterOptions([])).toEqual({
      cropFamilyOptions: [], varietyOptions: [], nutrientOptions: [],
    });
  });
});

describe('matchesPublicCropFilters', () => {
  it('matches everything when no filter is set', () => {
    expect(matchesPublicCropFilters(crop(), EMPTY_PUBLIC_CROP_FILTERS)).toBe(true);
  });

  describe('attribute filters', () => {
    it('matches an exact crop family', () => {
      expect(matchesPublicCropFilters(crop({ crop_family: 'Nachtschatten' }), filters({ cropFamily: 'Nachtschatten' }))).toBe(true);
      expect(matchesPublicCropFilters(crop({ crop_family: 'Doldenblütler' }), filters({ cropFamily: 'Nachtschatten' }))).toBe(false);
    });

    it('requires equality, so one family is not matched by a longer one', () => {
      // The options come from the data, so a shorter name can be a prefix of a longer one.
      expect(matchesPublicCropFilters(
        crop({ crop_family: 'Nachtschattengewächse' }), filters({ cropFamily: 'Nachtschatten' }),
      )).toBe(false);
      expect(matchesPublicCropFilters(crop({ variety: 'Roma VF' }), filters({ variety: 'Roma' }))).toBe(false);
    });

    it('excludes a crop with the attribute missing', () => {
      expect(matchesPublicCropFilters(crop({}), filters({ cropFamily: 'Nachtschatten' }))).toBe(false);
    });

    it('filters by variety and nutrient demand too', () => {
      expect(matchesPublicCropFilters(crop({ variety: 'Roma' }), filters({ variety: 'Roma' }))).toBe(true);
      expect(matchesPublicCropFilters(crop({ nutrient_demand: 'high' }), filters({ nutrientDemand: 'low' }))).toBe(false);
    });
  });

  describe('cultivation type', () => {
    it('matches a crop offering that type', () => {
      expect(matchesPublicCropFilters(
        crop({ cultivation_types: ['direct_sowing'] } as Partial<PublicCrop>),
        filters({ cultivationType: 'direct_sowing' }),
      )).toBe(true);
    });

    it('falls back to the legacy single type', () => {
      expect(matchesPublicCropFilters(
        crop({ cultivation_type: 'pre_cultivation' } as Partial<PublicCrop>),
        filters({ cultivationType: 'pre_cultivation' }),
      )).toBe(true);
    });

    it('prefers the list over the legacy field when both are present', () => {
      expect(matchesPublicCropFilters(
        crop({ cultivation_types: ['direct_sowing'], cultivation_type: 'pre_cultivation' } as Partial<PublicCrop>),
        filters({ cultivationType: 'pre_cultivation' }),
      )).toBe(false);
    });

    it('"both" requires the crop to offer both, not either', () => {
      const bothFilter = filters({ cultivationType: 'both' });

      expect(matchesPublicCropFilters(
        crop({ cultivation_types: ['direct_sowing', 'pre_cultivation'] } as Partial<PublicCrop>), bothFilter,
      )).toBe(true);
      expect(matchesPublicCropFilters(
        crop({ cultivation_types: ['direct_sowing'] } as Partial<PublicCrop>), bothFilter,
      )).toBe(false);
    });

    it('excludes a crop with no cultivation type at all', () => {
      expect(matchesPublicCropFilters(crop({}), filters({ cultivationType: 'direct_sowing' }))).toBe(false);
    });
  });

  describe('numeric ranges', () => {
    it('applies a minimum, inclusively', () => {
      expect(matchesPublicCropFilters(crop({ growth_duration_days: 30 }), filters({ growthDaysMin: '30' }))).toBe(true);
      expect(matchesPublicCropFilters(crop({ growth_duration_days: 29 }), filters({ growthDaysMin: '30' }))).toBe(false);
    });

    it('applies a maximum, inclusively', () => {
      expect(matchesPublicCropFilters(crop({ growth_duration_days: 60 }), filters({ growthDaysMax: '60' }))).toBe(true);
      expect(matchesPublicCropFilters(crop({ growth_duration_days: 61 }), filters({ growthDaysMax: '60' }))).toBe(false);
    });

    it('applies both ends together', () => {
      const range = filters({ growthDaysMin: '30', growthDaysMax: '60' });

      expect(matchesPublicCropFilters(crop({ growth_duration_days: 45 }), range)).toBe(true);
      expect(matchesPublicCropFilters(crop({ growth_duration_days: 90 }), range)).toBe(false);
    });

    it('excludes a crop with no value once a bound is set', () => {
      // An unknown duration cannot be shown to satisfy "at least 30 days".
      expect(matchesPublicCropFilters(crop({}), filters({ growthDaysMin: '30' }))).toBe(false);
      expect(matchesPublicCropFilters(crop({}), filters({ growthDaysMax: '30' }))).toBe(false);
    });

    it('still includes a crop with no value when no bound is set', () => {
      expect(matchesPublicCropFilters(crop({}), EMPTY_PUBLIC_CROP_FILTERS)).toBe(true);
    });

    it('filters expected yield the same way', () => {
      expect(matchesPublicCropFilters(crop({ expected_yield: 5 }), filters({ yieldMin: '2', yieldMax: '10' }))).toBe(true);
      expect(matchesPublicCropFilters(crop({ expected_yield: 1 }), filters({ yieldMin: '2' }))).toBe(false);
      expect(matchesPublicCropFilters(crop({ expected_yield: 20 }), filters({ yieldMax: '10' }))).toBe(false);
    });

    it('excludes a crop with no yield once a yield bound is set', () => {
      // The yield range is a second copy of the same logic, so it needs its own guard.
      expect(matchesPublicCropFilters(crop({}), filters({ yieldMin: '2' }))).toBe(false);
      expect(matchesPublicCropFilters(crop({}), filters({ yieldMax: '10' }))).toBe(false);
    });

    it('treats a zero bound as a real bound, not as "unset"', () => {
      // '0' is truthy as a string, so the filter applies.
      expect(matchesPublicCropFilters(crop({ expected_yield: -1 } as Partial<PublicCrop>), filters({ yieldMin: '0' }))).toBe(false);
      expect(matchesPublicCropFilters(crop({ expected_yield: 0 }), filters({ yieldMin: '0' }))).toBe(true);
    });
  });

  it('requires every active filter to match, not just one', () => {
    const both = filters({ cropFamily: 'Nachtschatten', variety: 'Roma' });

    expect(matchesPublicCropFilters(crop({ crop_family: 'Nachtschatten', variety: 'Roma' }), both)).toBe(true);
    expect(matchesPublicCropFilters(crop({ crop_family: 'Nachtschatten', variety: 'Cherry' }), both)).toBe(false);
  });
});
