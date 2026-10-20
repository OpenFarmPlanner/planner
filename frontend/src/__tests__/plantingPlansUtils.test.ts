import { describe, expect, it } from 'vitest';
import {
  areRowsSemanticallyEqual,
  getAllowedCultivationTypesForCrop,
  isEmptyNewPlantingPlanRow,
  type PlantingPlanRow,
} from '../pages/plantingPlansUtils';

describe('getAllowedCultivationTypesForCrop', () => {
  it('returns only allowed values from cultivation_types', () => {
    const options = getAllowedCultivationTypesForCrop({
      cultivation_types: ['direct_sowing'],
    } as never);

    expect(options).toEqual(['direct_sowing']);
  });

  it('falls back to cultivation_type if cultivation_types is missing', () => {
    const options = getAllowedCultivationTypesForCrop({
      cultivation_type: 'pre_cultivation',
    } as never);

    expect(options).toEqual(['pre_cultivation', 'purchased_transplant']);
  });

  it('uses live inherited cultivation restrictions for a variety', () => {
    const options = getAllowedCultivationTypesForCrop({
      cultivation_types: [],
      cultivation_type: '',
      effective_values: {
        cultivation_types: ['pre_cultivation'],
        cultivation_type: 'pre_cultivation',
      },
    } as never);

    expect(options).toEqual(['pre_cultivation', 'purchased_transplant']);
  });

  it('falls back to every option when crop does not define restrictions', () => {
    const options = getAllowedCultivationTypesForCrop(undefined);

    expect(options).toEqual(['direct_sowing', 'pre_cultivation', 'purchased_transplant']);
  });

  it('allows bought-in plants exactly when transplanting is allowed', () => {
    expect(getAllowedCultivationTypesForCrop({
      cultivation_types: ['direct_sowing', 'pre_cultivation'],
    } as never)).toEqual(['direct_sowing', 'pre_cultivation', 'purchased_transplant']);
    expect(getAllowedCultivationTypesForCrop({
      cultivation_types: ['direct_sowing'],
    } as never)).not.toContain('purchased_transplant');
  });
});

describe('isEmptyNewPlantingPlanRow', () => {
  const emptyRow: PlantingPlanRow = {
    id: -1,
    isNew: true,
    crop: 0,
    bed: 0,
    location_id: undefined,
    field_id: undefined,
    cultivation_type: '',
    planting_date: '',
    quantity: undefined,
    area_m2: undefined,
    plants_count: undefined,
    notes: '',
    note_attachment_count: 0,
  } as PlantingPlanRow;

  it('treats a default new planting plan row as empty', () => {
    expect(isEmptyNewPlantingPlanRow(emptyRow)).toBe(true);
  });

  it('treats selected crop or bed values as user input', () => {
    expect(isEmptyNewPlantingPlanRow({ ...emptyRow, crop: 12 })).toBe(false);
    expect(isEmptyNewPlantingPlanRow({ ...emptyRow, bed: 34 })).toBe(false);
  });

  it('treats entered free-form values as user input', () => {
    expect(isEmptyNewPlantingPlanRow({ ...emptyRow, cultivation_type: 'direct_sowing' })).toBe(false);
    expect(isEmptyNewPlantingPlanRow({ ...emptyRow, planting_date: new Date('2026-04-01') as never })).toBe(false);
    expect(isEmptyNewPlantingPlanRow({ ...emptyRow, notes: 'Needs shade' })).toBe(false);
    expect(isEmptyNewPlantingPlanRow({ ...emptyRow, area_m2: 2.5 })).toBe(false);
    expect(isEmptyNewPlantingPlanRow({ ...emptyRow, area_m2: 'max' as never })).toBe(false);
  });
});

describe('areRowsSemanticallyEqual', () => {
  const row: PlantingPlanRow = {
    id: 1,
    crop: 2,
    bed: 3,
    planting_date: '2026-04-01',
    rotation_status: 'conflict',
    rotation_findings: [],
  };

  it('treats a changed rotation status as a change, so filters and counts refresh', () => {
    expect(areRowsSemanticallyEqual([row], [{ ...row }])).toBe(true);
    expect(areRowsSemanticallyEqual([row], [{ ...row, rotation_status: 'accepted' }])).toBe(false);
    expect(areRowsSemanticallyEqual([row], [{ ...row, rotation_findings: [{ kind: 'no_family' }] as never }])).toBe(false);
  });

  it('compares rotation findings by value, not by array identity', () => {
    const withFindings = { ...row, rotation_findings: [{ kind: 'ok', year: 2025 }] as never };
    const reloaded = { ...row, rotation_findings: [{ kind: 'ok', year: 2025 }] as never };
    expect(areRowsSemanticallyEqual([withFindings], [reloaded])).toBe(true);
  });
});
