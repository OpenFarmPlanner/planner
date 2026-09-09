import {
  hasEffectiveCropFormChanges,
  normalizeCropFormData,
} from '../crops/cropFormChangeDetection';
import type { Crop } from '../api/types';

const unchanged = (a: Partial<Crop>, b: Partial<Crop>) => hasEffectiveCropFormChanges(a, b);

describe('hasEffectiveCropFormChanges', () => {
  it('reports no change for an untouched form', () => {
    const crop = { name: 'Salat', growth_duration_days: 30 } as Partial<Crop>;

    expect(unchanged(crop, { ...crop })).toBe(false);
  });

  it('reports a real edit', () => {
    expect(unchanged({ name: 'Salat' }, { name: 'Spinat' })).toBe(true);
  });

  describe('edits that only look like edits', () => {
    it('ignores surrounding whitespace', () => {
      expect(unchanged({ name: 'Salat' }, { name: '  Salat  ' })).toBe(false);
    });

    it('treats an emptied field and an absent one as the same', () => {
      expect(unchanged({ notes: 'x' }, { notes: '' })).toBe(true);
      expect(unchanged({ notes: '' }, {})).toBe(false);
      expect(unchanged({ notes: '   ' }, { notes: null } as Partial<Crop>)).toBe(false);
    });

    it('compares numbers by value, not by how they were typed', () => {
      expect(unchanged(
        { growth_duration_days: 30 },
        { growth_duration_days: '30' } as unknown as Partial<Crop>,
      )).toBe(false);
    });

    it('accepts a comma decimal separator, as German input produces', () => {
      expect(unchanged(
        { expected_yield: 1.5 },
        { expected_yield: '1,5' } as unknown as Partial<Crop>,
      )).toBe(false);
    });

    it('ignores the case a colour was written in', () => {
      expect(unchanged({ display_color: '#AABBCC' }, { display_color: '#aabbcc' })).toBe(false);
    });

    it('ignores the order cultivation types arrive in', () => {
      expect(unchanged(
        { cultivation_types: ['direct', 'pre'] } as Partial<Crop>,
        { cultivation_types: ['pre', 'direct'] } as Partial<Crop>,
      )).toBe(false);
    });

    it('ignores a duplicated cultivation type', () => {
      expect(unchanged(
        { cultivation_types: ['direct'] } as Partial<Crop>,
        { cultivation_types: ['direct', 'direct'] } as Partial<Crop>,
      )).toBe(false);
    });

    it('treats the legacy single cultivation_type as the list form', () => {
      expect(unchanged(
        { cultivation_type: 'direct' } as Partial<Crop>,
        { cultivation_types: ['direct'] } as Partial<Crop>,
      )).toBe(false);
    });

    it('ignores a blank supplier row the user never filled in', () => {
      expect(unchanged(
        {} as Partial<Crop>,
        { supplier_data: [{ supplier_name_input: '', packaging_sizes: [] }] } as unknown as Partial<Crop>,
      )).toBe(false);
    });

    it('ignores the order supplier rows are listed in', () => {
      const a = { supplier_data: [{ supplier_id: 1 }, { supplier_id: 2 }] };
      const b = { supplier_data: [{ supplier_id: 2 }, { supplier_id: 1 }] };

      expect(unchanged(a as unknown as Partial<Crop>, b as unknown as Partial<Crop>)).toBe(false);
    });

    it('ignores a row carrying only a resolved supplier name, with nothing selected', () => {
      // supplier_name is the display name read back off a linked supplier, not
      // something the user types; on its own it is not a filled-in row.
      expect(unchanged(
        {} as Partial<Crop>,
        { supplier_data: [{ supplier_name: 'Bingenheimer' }] } as unknown as Partial<Crop>,
      )).toBe(false);
    });

    it('ignores an all-empty seed rate map', () => {
      expect(unchanged(
        {} as Partial<Crop>,
        { seed_rate_by_cultivation: { direct: { value: null, unit: null } } } as unknown as Partial<Crop>,
      )).toBe(false);
    });

    it('ignores the key order of the seed rate map', () => {
      expect(unchanged(
        { seed_rate_by_cultivation: { a: { value: 1, unit: 'g' }, b: { value: 2, unit: 'g' } } } as unknown as Partial<Crop>,
        { seed_rate_by_cultivation: { b: { value: 2, unit: 'g' }, a: { value: 1, unit: 'g' } } } as unknown as Partial<Crop>,
      )).toBe(false);
    });
  });

  describe('edits it must not miss', () => {
    it('a changed number', () => {
      expect(unchanged({ growth_duration_days: 30 }, { growth_duration_days: 31 })).toBe(true);
    });

    it('a cultivation type added', () => {
      expect(unchanged(
        { cultivation_types: ['direct'] } as Partial<Crop>,
        { cultivation_types: ['direct', 'pre'] } as Partial<Crop>,
      )).toBe(true);
    });

    it('a supplier picked from the list', () => {
      expect(unchanged(
        {} as Partial<Crop>,
        { supplier_data: [{ supplier_id: 7 }] } as unknown as Partial<Crop>,
      )).toBe(true);
    });

    it('a supplier name typed in by hand', () => {
      expect(unchanged(
        {} as Partial<Crop>,
        { supplier_data: [{ supplier_name_input: 'Bingenheimer' }] } as unknown as Partial<Crop>,
      )).toBe(true);
    });

    it('supplier details entered without a supplier selected yet', () => {
      expect(unchanged(
        {} as Partial<Crop>,
        { supplier_data: [{ price: 4.5 }] } as unknown as Partial<Crop>,
      )).toBe(true);
    });

    it('a packaging size changed on a supplier row', () => {
      expect(unchanged(
        { supplier_data: [{ supplier_id: 1, packaging_sizes: [{ size_value: 10, size_unit: 'g' }] }] } as unknown as Partial<Crop>,
        { supplier_data: [{ supplier_id: 1, packaging_sizes: [{ size_value: 25, size_unit: 'g' }] }] } as unknown as Partial<Crop>,
      )).toBe(true);
    });

    it('a seed rate value changed', () => {
      expect(unchanged(
        { seed_rate_by_cultivation: { direct: { value: 1, unit: 'g' } } } as unknown as Partial<Crop>,
        { seed_rate_by_cultivation: { direct: { value: 2, unit: 'g' } } } as unknown as Partial<Crop>,
      )).toBe(true);
    });
  });
});

describe('normalizeCropFormData', () => {
  it('drops an unparsable number rather than keeping the raw text', () => {
    const normalized = normalizeCropFormData(
      { growth_duration_days: 'abc' } as unknown as Partial<Crop>,
    );

    expect(normalized.growth_duration_days).toBeNull();
  });

  it('always yields the same key set, whatever the input holds', () => {
    const fromEmpty = Object.keys(normalizeCropFormData({})).sort();
    const fromFull = Object.keys(normalizeCropFormData({
      name: 'Salat', growth_duration_days: 30, display_color: '#fff',
    } as Partial<Crop>)).sort();

    expect(fromEmpty).toEqual(fromFull);
  });
});
