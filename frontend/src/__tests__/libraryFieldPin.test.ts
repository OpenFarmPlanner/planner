import { describe, expect, it } from 'vitest';
import {
  hasLibraryPinFormValue,
  isLibraryFieldPinned,
  isLibraryPinGroupPinned,
  libraryPinnedFieldsForSave,
  setLibraryPinGroup,
} from '../crops/libraryFieldPin';

describe('library field pins in the crop form', () => {
  it('pins a form control as all of its compared model fields', () => {
    const pinned = setLibraryPinGroup([], 'cultivation_types', true);

    expect(pinned).toEqual(['cultivation_type', 'cultivation_types']);
    expect(isLibraryPinGroupPinned(pinned, 'cultivation_types')).toBe(true);
    expect(setLibraryPinGroup(pinned, 'cultivation_types', false)).toEqual([]);
  });

  it('maps a centimeter form field to its SI model field', () => {
    expect(setLibraryPinGroup(['notes'], 'row_spacing_cm', true)).toEqual(['notes', 'row_spacing_m']);
  });

  it('releases the pin of a field the form left empty when saving', () => {
    expect(libraryPinnedFieldsForSave({
      library_pinned_fields: ['expected_yield', 'growth_duration_days', 'seed_rate_value'],
      growth_duration_days: 80,
      expected_yield: undefined,
    })).toEqual(['growth_duration_days', 'seed_rate_value']);
  });

  it('treats a cultivation choice as a value', () => {
    expect(hasLibraryPinFormValue({ cultivation_type: 'pre_cultivation' }, 'cultivation_types')).toBe(true);
    expect(hasLibraryPinFormValue({ notes: '' }, 'notes')).toBe(false);
  });

  it('shows a pin only for a pinned field that carries a value', () => {
    const crop = { library_pinned_fields: ['growth_duration_days', 'notes'], growth_duration_days: 35, notes: '' };

    expect(isLibraryFieldPinned(crop, 'growth_duration_days')).toBe(true);
    expect(isLibraryFieldPinned(crop, 'notes')).toBe(false);
    expect(isLibraryFieldPinned(crop, 'harvest_duration_days')).toBe(false);
  });
});
