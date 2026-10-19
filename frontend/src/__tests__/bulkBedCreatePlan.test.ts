import { describe, expect, it } from 'vitest';
import type { Bed, Field } from '../api/types';
import {
  evaluateBulkBedForm,
  getBulkBedAreaOverflow,
  getInitialBulkBedFormValues,
  type BulkBedFormValues,
} from '../components/hierarchy/utils/bulkBedCreatePlan';
import { matchesHierarchyRowPrefill } from '../components/hierarchy/utils/hierarchyRowDraft';

const bed = (id: number, name: string, extra: Partial<Bed> = {}): Bed => ({ id, name, field: 1, ...extra });

const baseValues: BulkBedFormValues = {
  mode: 'sequential',
  prefix: 'E',
  start: '1',
  count: '3',
  rows: '1',
  bedsPerRow: '',
  firstRow: '1',
  firstBed: '1',
  lengthM: 10,
  widthM: 0.75,
};

describe('getInitialBulkBedFormValues', () => {
  it('starts with an empty prefix at 1 for a field without beds', () => {
    expect(getInitialBulkBedFormValues([])).toMatchObject({
      mode: 'sequential', prefix: '', start: '1', count: '', lengthM: null, widthM: null,
    });
  });

  it('continues a sequential scheme and takes the last bed\'s dimensions', () => {
    const beds = [bed(1, 'E 1', { length_m: 8, width_m: 1 }), bed(2, 'E 2', { length_m: 10, width_m: 0.75 })];
    expect(getInitialBulkBedFormValues(beds)).toMatchObject({
      mode: 'sequential', prefix: 'E', start: '3', lengthM: 10, widthM: 0.75,
    });
  });

  it('continues a row/bed scheme with the next row', () => {
    const beds = [bed(1, 'E 1 1'), bed(2, 'E 1 2'), bed(3, 'E 2 1'), bed(4, 'E 2 2')];
    expect(getInitialBulkBedFormValues(beds)).toMatchObject({
      mode: 'rowBed', prefix: 'E', firstRow: '3', firstBed: '1', bedsPerRow: '2',
    });
  });

  it('falls back to defaults for mixed names and ignores unsaved rows', () => {
    expect(getInitialBulkBedFormValues([bed(1, 'Nordbeet'), bed(2, 'E 4')])).toMatchObject({ prefix: '', start: '1' });
    expect(getInitialBulkBedFormValues([bed(1, 'E 4'), bed(-5, 'draft')])).toMatchObject({ prefix: 'E', start: '5' });
  });
});

describe('evaluateBulkBedForm', () => {
  it('builds sequential names with per-bed and total area', () => {
    const plan = evaluateBulkBedForm(baseValues, []);
    expect(plan.names).toEqual(['E 1', 'E 2', 'E 3']);
    expect(plan.areaPerBedSqm).toBe(7.5);
    expect(plan.totalAreaSqm).toBe(22.5);
    expect(plan.isComplete).toBe(true);
  });

  it('builds row/bed names', () => {
    const plan = evaluateBulkBedForm({ ...baseValues, mode: 'rowBed', rows: '2', bedsPerRow: '2' }, []);
    expect(plan.names).toEqual(['E 1 1', 'E 1 2', 'E 2 1', 'E 2 2']);
  });

  it('is incomplete while a required input is empty', () => {
    expect(evaluateBulkBedForm({ ...baseValues, count: '' }, []).isComplete).toBe(false);
    expect(evaluateBulkBedForm({ ...baseValues, lengthM: null }, []).isComplete).toBe(false);
    expect(evaluateBulkBedForm({ ...baseValues, lengthM: null }, []).errors).toEqual({});
  });

  it('flags invalid numbers', () => {
    expect(evaluateBulkBedForm({ ...baseValues, count: '0' }, []).errors.count).toEqual({ key: 'wholeNumber', min: 1 });
    expect(evaluateBulkBedForm({ ...baseValues, start: '1.5' }, []).errors.start).toEqual({ key: 'wholeNumber', min: 0 });
    expect(evaluateBulkBedForm({ ...baseValues, widthM: 0 }, []).errors.widthM).toEqual({ key: 'positiveNumber' });
  });

  it('caps the series at 200 beds', () => {
    expect(evaluateBulkBedForm({ ...baseValues, count: '201' }, []).errors.count).toEqual({ key: 'tooMany', max: 200 });
    const rowBed = evaluateBulkBedForm({ ...baseValues, mode: 'rowBed', rows: '21', bedsPerRow: '10' }, []);
    expect(rowBed.errors.bedsPerRow).toEqual({ key: 'tooMany', max: 200 });
    expect(rowBed.names).toEqual([]);
  });

  it('reports generated names that already exist in the field', () => {
    expect(evaluateBulkBedForm(baseValues, ['E 2', 'Other']).takenNames).toEqual(['E 2']);
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
