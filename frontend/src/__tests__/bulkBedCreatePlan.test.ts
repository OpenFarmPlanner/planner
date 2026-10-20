import { describe, expect, it } from 'vitest';
import type { Bed, Field } from '../api/types';
import {
  changeBulkBedOrientation,
  evaluateBulkBedForm,
  getBulkBedAreaOverflow,
  getInitialBulkBedFormValues,
  suggestBulkBedCount,
  type BulkBedFormValues,
} from '../components/hierarchy/utils/bulkBedCreatePlan';
import { matchesHierarchyRowPrefill } from '../components/hierarchy/utils/hierarchyRowDraft';

const bed = (id: number, name: string, extra: Partial<Bed> = {}): Bed => ({ id, name, field: 1, ...extra });

const FIELD: Field = { id: 1, name: 'Nord', location: 1, length_m: 20, width_m: 10 };

const baseValues: BulkBedFormValues = {
  orientation: 'length',
  lengthM: 10,
  widthM: 0.75,
  pathM: null,
  count: '3',
  firstName: 'E 1',
};

describe('suggestBulkBedCount', () => {
  it('fills the field width when beds run along the length', () => {
    // floor((10 + 0) / (1.2 + 0)) = 8
    expect(suggestBulkBedCount(FIELD, [], { orientation: 'length', widthM: 1.2, pathM: null }))
      .toEqual({ count: 8, crossSideM: 10, existingBedCount: 0 });
  });

  it('counts paths only between beds', () => {
    // floor((10 + 0.4) / (1.2 + 0.4)) = 6
    expect(suggestBulkBedCount(FIELD, [], { orientation: 'length', widthM: 1.2, pathM: 0.4 })?.count).toBe(6);
  });

  it('fills the field length when beds run along the width', () => {
    // floor((20 + 0.5) / (1.5 + 0.5)) = 10
    expect(suggestBulkBedCount(FIELD, [], { orientation: 'width', widthM: 1.5, pathM: 0.5 }))
      .toEqual({ count: 10, crossSideM: 20, existingBedCount: 0 });
  });

  it('subtracts existing beds and one path per existing bed', () => {
    const beds = [bed(1, 'E 1', { width_m: 1.2 }), bed(2, 'E 2', { width_m: 1.2 }), bed(-1, 'draft', { width_m: 5 })];
    // free = 10 - 2.4 - 2 * 0.4 = 6.8; floor((6.8 + 0.4) / 1.6) = 4
    expect(suggestBulkBedCount(FIELD, beds, { orientation: 'length', widthM: 1.2, pathM: 0.4 }))
      .toEqual({ count: 4, crossSideM: 10, existingBedCount: 2 });
  });

  it('reports no room once the existing beds fill the field', () => {
    const beds = Array.from({ length: 8 }, (_, index) => bed(index + 1, `E ${index + 1}`, { width_m: 1.2 }));
    expect(suggestBulkBedCount(FIELD, beds, { orientation: 'length', widthM: 1.2, pathM: 0.2 })?.count).toBe(0);
  });

  it('is null without the cross side or a bed width', () => {
    expect(suggestBulkBedCount({ ...FIELD, width_m: null }, [], { orientation: 'length', widthM: 1, pathM: null })).toBeNull();
    expect(suggestBulkBedCount(FIELD, [], { orientation: 'length', widthM: null, pathM: null })).toBeNull();
    expect(suggestBulkBedCount(FIELD, [], { orientation: 'length', widthM: 1, pathM: -1 })).toBeNull();
    expect(suggestBulkBedCount(null, [], { orientation: 'length', widthM: 1, pathM: null })).toBeNull();
  });
});

describe('getInitialBulkBedFormValues', () => {
  it('starts with "Beet 1" and the field length for a field without beds', () => {
    expect(getInitialBulkBedFormValues(FIELD, [], 'Beet 1')).toEqual({
      orientation: 'length', lengthM: 20, widthM: null, pathM: null, count: '', firstName: 'Beet 1',
    });
  });

  it('continues after the last bed, takes its width and prefills the suggested count', () => {
    const beds = [bed(1, 'E 2 1', { length_m: 8, width_m: 1 }), bed(2, 'E 2 2', { length_m: 8, width_m: 2 })];
    // free = 10 - 3 = 7; floor(7 / 2) = 3
    expect(getInitialBulkBedFormValues(FIELD, beds, 'Beet 1')).toEqual({
      orientation: 'length', lengthM: 20, widthM: 2, pathM: null, count: '3', firstName: 'E 2 3',
    });
  });

  it('skips names already taken and ignores unsaved rows', () => {
    const beds = [bed(1, 'E 3'), bed(2, 'E 2'), bed(-5, 'draft')];
    expect(getInitialBulkBedFormValues(FIELD, beds, 'Beet 1').firstName).toBe('E 4');
  });

  it('falls back to the last bed length without field dimensions', () => {
    const field = { ...FIELD, length_m: null, width_m: null };
    expect(getInitialBulkBedFormValues(field, [bed(1, 'A', { length_m: 15, width_m: 1 })], 'Beet 1'))
      .toMatchObject({ lengthM: 15, widthM: 1, count: '', firstName: 'A 2' });
  });
});

describe('changeBulkBedOrientation', () => {
  it('moves an untouched length to the other field side', () => {
    expect(changeBulkBedOrientation({ ...baseValues, lengthM: 20 }, FIELD, 'width', false))
      .toMatchObject({ orientation: 'width', lengthM: 10 });
  });

  it('keeps a length the user typed', () => {
    expect(changeBulkBedOrientation({ ...baseValues, lengthM: 7 }, FIELD, 'width', true))
      .toMatchObject({ orientation: 'width', lengthM: 7 });
  });
});

describe('evaluateBulkBedForm', () => {
  it('builds the name series with per-bed and total area', () => {
    const plan = evaluateBulkBedForm(baseValues, []);
    expect(plan.names).toEqual(['E 1', 'E 2', 'E 3']);
    expect(plan.areaPerBedSqm).toBe(7.5);
    expect(plan.totalAreaSqm).toBe(22.5);
    expect(plan.isComplete).toBe(true);
  });

  it('is incomplete while a required input is empty', () => {
    expect(evaluateBulkBedForm({ ...baseValues, count: '' }, []).isComplete).toBe(false);
    expect(evaluateBulkBedForm({ ...baseValues, firstName: ' ' }, []).isComplete).toBe(false);
    expect(evaluateBulkBedForm({ ...baseValues, lengthM: null }, []).isComplete).toBe(false);
    expect(evaluateBulkBedForm({ ...baseValues, lengthM: null }, []).errors).toEqual({});
  });

  it('flags invalid numbers', () => {
    expect(evaluateBulkBedForm({ ...baseValues, count: '0' }, []).errors.count).toEqual({ key: 'wholeNumber', min: 1 });
    expect(evaluateBulkBedForm({ ...baseValues, count: '1.5' }, []).errors.count).toEqual({ key: 'wholeNumber', min: 1 });
    expect(evaluateBulkBedForm({ ...baseValues, widthM: 0 }, []).errors.widthM).toEqual({ key: 'positiveNumber' });
    expect(evaluateBulkBedForm({ ...baseValues, pathM: -0.1 }, []).errors.pathM).toEqual({ key: 'nonNegativeNumber' });
  });

  it('caps the series at 200 beds', () => {
    const plan = evaluateBulkBedForm({ ...baseValues, count: '201' }, []);
    expect(plan.errors.count).toEqual({ key: 'tooMany', max: 200 });
    expect(plan.names).toEqual([]);
  });

  it('reports generated names that already exist in the field without skipping them', () => {
    const plan = evaluateBulkBedForm(baseValues, ['E 2', 'Other']);
    expect(plan.names).toEqual(['E 1', 'E 2', 'E 3']);
    expect(plan.takenNames).toEqual(['E 2']);
  });
});

describe('getBulkBedAreaOverflow', () => {
  const field: Field = { id: 1, name: 'Nord', location: 1, length_m: 10, width_m: 5 };

  it('warns when existing and new beds exceed the field area', () => {
    const beds = [bed(1, 'E 1', { area_sqm: 30 })];
    expect(getBulkBedAreaOverflow(field, beds, 25)).toEqual({ fieldArea: 50, existingArea: 30, newArea: 25 });
  });

  it('stays quiet when everything fits or the field has no area', () => {
    expect(getBulkBedAreaOverflow(field, [bed(1, 'E 1', { area_sqm: 30 })], 20)).toBeNull();
    expect(getBulkBedAreaOverflow({ ...field, length_m: null, width_m: null }, [], 1000)).toBeNull();
    expect(getBulkBedAreaOverflow(field, [], null)).toBeNull();
  });

  it('prefers the stored field area', () => {
    expect(getBulkBedAreaOverflow({ ...field, area_sqm: 100 }, [], 60)).toBeNull();
  });
});

describe('matchesHierarchyRowPrefill', () => {
  const prefill = { name: 'E 2', length_m: 10, width_m: 0.75 };
  const row = { id: -1, type: 'bed' as const, level: 2, isNew: true, name: 'E 2', length_m: 10, width_m: 0.75 };

  it('matches an untouched prefilled row, also with edit-cell string values', () => {
    expect(matchesHierarchyRowPrefill(row, prefill)).toBe(true);
    expect(matchesHierarchyRowPrefill({ ...row, length_m: '10' as never, width_m: '0,75' as never }, prefill)).toBe(true);
  });

  it('does not match once anything was changed or for saved rows', () => {
    expect(matchesHierarchyRowPrefill({ ...row, name: 'E 3' }, prefill)).toBe(false);
    expect(matchesHierarchyRowPrefill({ ...row, width_m: 1 }, prefill)).toBe(false);
    expect(matchesHierarchyRowPrefill({ ...row, length_m: null }, prefill)).toBe(false);
    expect(matchesHierarchyRowPrefill({ ...row, notes: 'x' }, prefill)).toBe(false);
    expect(matchesHierarchyRowPrefill({ ...row, isNew: false }, prefill)).toBe(false);
  });
});
