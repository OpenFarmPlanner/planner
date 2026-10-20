import { describe, expect, it } from 'vitest';
import type { Bed, Field } from '../api/types';
import {
  evaluateFieldDuplicate,
  getInitialFieldDuplicateValues,
  previewBedNames,
  replaceFirst,
  type FieldDuplicateFormValues,
} from '../components/hierarchy/utils/fieldDuplicatePlan';

const field = (id: number, name: string, location = 1): Field => ({ id, name, location, length_m: 20, width_m: 10 });
const bed = (id: number, name: string): Bed => ({ id, name, field: 1 });

const SOURCE = field(1, 'Nord 1');
const FIELDS = [SOURCE, field(2, 'Nord 2'), field(3, 'Nord 3', 2)];
const BEDS = [bed(1, 'Nord A'), bed(2, 'Nord B'), bed(3, 'Mitte')];

const values = (patch: Partial<FieldDuplicateFormValues> = {}): FieldDuplicateFormValues => ({
  name: 'Kopie', copyBeds: true, replaceSearch: '', replaceWith: '', ...patch,
});

describe('replaceFirst', () => {
  it('replaces only the first case-sensitive occurrence', () => {
    expect(replaceFirst('Nord nord Nord', 'Nord', 'Süd')).toBe('Süd nord Nord');
    expect(replaceFirst('nord', 'Nord', 'Süd')).toBe('nord');
  });

  it('keeps the name for an empty search', () => {
    expect(replaceFirst('Nord', '', 'x')).toBe('Nord');
  });
});

describe('getInitialFieldDuplicateValues', () => {
  it('counts the source name up past names taken in the same location only', () => {
    expect(getInitialFieldDuplicateValues(SOURCE, FIELDS)).toEqual({
      name: 'Nord 3', copyBeds: true, replaceSearch: '', replaceWith: '',
    });
  });

  it('appends a number to a name without one', () => {
    expect(getInitialFieldDuplicateValues(field(9, 'Garten'), [field(9, 'Garten')]).name).toBe('Garten 2');
  });
});

describe('evaluateFieldDuplicate', () => {
  it('renames the copied beds and allows submitting', () => {
    const plan = evaluateFieldDuplicate(values({ replaceSearch: 'Nord', replaceWith: 'Süd' }), SOURCE, BEDS, FIELDS);
    expect(plan.bedNames).toEqual(['Süd A', 'Süd B', 'Mitte']);
    expect(plan.searchNotFound).toBe(false);
    expect(plan.canSubmit).toBe(true);
  });

  it('copies no beds when unchecked', () => {
    expect(evaluateFieldDuplicate(values({ copyBeds: false }), SOURCE, BEDS, FIELDS).bedNames).toEqual([]);
  });

  it('flags a search text that no bed name contains', () => {
    expect(evaluateFieldDuplicate(values({ replaceSearch: 'Süd' }), SOURCE, BEDS, FIELDS).searchNotFound).toBe(true);
    expect(evaluateFieldDuplicate(values({ replaceSearch: 'nord' }), SOURCE, BEDS, FIELDS).searchNotFound).toBe(true);
  });

  it('blocks an empty or taken name', () => {
    expect(evaluateFieldDuplicate(values({ name: '  ' }), SOURCE, BEDS, FIELDS).canSubmit).toBe(false);
    const taken = evaluateFieldDuplicate(values({ name: ' Nord 2 ' }), SOURCE, BEDS, FIELDS);
    expect(taken.nameTaken).toBe(true);
    expect(taken.canSubmit).toBe(false);
    // Names only clash within the same location.
    expect(evaluateFieldDuplicate(values({ name: 'Nord 3' }), SOURCE, BEDS, FIELDS).nameTaken).toBe(false);
  });

  it('blocks bed names the replacement would merge or empty', () => {
    const merged = evaluateFieldDuplicate(values({ replaceSearch: 'B', replaceWith: 'A' }), SOURCE, BEDS, FIELDS);
    expect(merged.duplicateBedNames).toEqual(['Nord A']);
    expect(merged.canSubmit).toBe(false);

    const emptied = evaluateFieldDuplicate(values({ replaceSearch: 'Mitte' }), SOURCE, BEDS, FIELDS);
    expect(emptied.invalidBedNames).toEqual(['Mitte']);
    expect(emptied.canSubmit).toBe(false);
  });
});

describe('previewBedNames', () => {
  it('shows the first three names and an ellipsis', () => {
    expect(previewBedNames(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(previewBedNames(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', '…']);
  });
});
