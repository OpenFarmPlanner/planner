import { describe, expect, it } from 'vitest';
import type { Crop, PlantingPlan } from '../api/types';
import { getPlanPropagationInfo, getPlanSowingSchedule, getPlantingDateFromSowingDate } from '../pages/planSowingDate';

const anzuchtCrop: Crop = {
  id: 1,
  name: 'Tomate',
  cultivation_types: ['pre_cultivation'],
  propagation_duration_days: 28,
};

const directCrop: Crop = {
  id: 2,
  name: 'Karotte',
  cultivation_types: ['direct_sowing'],
};

const anzuchtCropWithoutDuration: Crop = {
  id: 3,
  name: 'Mystery-Anzucht',
  cultivation_types: ['pre_cultivation'],
};

describe('getPlanSowingSchedule', () => {
  it('returns null when the plan has no planting date yet', () => {
    const plan: PlantingPlan = { crop: 1, planting_date: null };
    expect(getPlanSowingSchedule(plan, anzuchtCrop)).toBeNull();
  });

  it('computes the sowing date for Anzucht as planting date minus propagation duration', () => {
    const plan: PlantingPlan = { crop: 1, planting_date: '2026-05-01', cultivation_type: 'pre_cultivation' };
    const schedule = getPlanSowingSchedule(plan, anzuchtCrop);
    expect(schedule).toEqual({
      isPreCultivation: true,
      propagationDurationDays: 28,
      sowingDate: '2026-04-03',
    });
  });

  it('tolerates planting_date still being a Date object, as a DataGrid row mid-edit can hold', () => {
    const plan = {
      crop: 1,
      planting_date: new Date('2026-05-01T00:00:00Z'),
      cultivation_type: 'pre_cultivation',
    } as unknown as PlantingPlan;
    const schedule = getPlanSowingSchedule(plan, anzuchtCrop);
    expect(schedule).toEqual({
      isPreCultivation: true,
      propagationDurationDays: 28,
      sowingDate: '2026-04-03',
    });
  });

  it('equates sowing date and planting date for direct sowing', () => {
    const plan: PlantingPlan = { crop: 2, planting_date: '2026-05-01', cultivation_type: 'direct_sowing' };
    const schedule = getPlanSowingSchedule(plan, directCrop);
    expect(schedule).toEqual({
      isPreCultivation: false,
      propagationDurationDays: null,
      sowingDate: '2026-05-01',
    });
  });

  it('cannot compute a sowing date for Anzucht without an effective propagation duration', () => {
    const plan: PlantingPlan = { crop: 3, planting_date: '2026-05-01', cultivation_type: 'pre_cultivation' };
    const schedule = getPlanSowingSchedule(plan, anzuchtCropWithoutDuration);
    expect(schedule).toEqual({
      isPreCultivation: true,
      propagationDurationDays: null,
      sowingDate: null,
    });
  });

  it('resolves a Sorte\'s propagation duration from its Kultur via effective_values', () => {
    const sorte: Crop = {
      id: 4,
      name: 'San Marzano',
      parent_crop: 1,
      cultivation_types: ['pre_cultivation'],
      effective_values: { propagation_duration_days: 28, cultivation_types: ['pre_cultivation'] },
    };
    const plan: PlantingPlan = { crop: 4, planting_date: '2026-05-01', cultivation_type: 'pre_cultivation' };
    const schedule = getPlanSowingSchedule(plan, sorte);
    expect(schedule).toEqual({
      isPreCultivation: true,
      propagationDurationDays: 28,
      sowingDate: '2026-04-03',
    });
  });

  it('falls back to the plan row\'s denormalized crop fields when the crop itself is unavailable', () => {
    const plan: PlantingPlan = {
      crop: 1,
      planting_date: '2026-05-01',
      cultivation_type: 'pre_cultivation',
      crop_propagation_duration_days: 14,
    };
    const schedule = getPlanSowingSchedule(plan, undefined);
    expect(schedule).toEqual({
      isPreCultivation: true,
      propagationDurationDays: 14,
      sowingDate: '2026-04-17',
    });
  });
});

describe('getPlanPropagationInfo', () => {
  it('works without a planting date, for Anzucht with a resolvable duration', () => {
    const plan = { crop: 1, cultivation_type: 'pre_cultivation' as const };
    expect(getPlanPropagationInfo(plan, anzuchtCrop)).toEqual({
      isPreCultivation: true,
      propagationDurationDays: 28,
    });
  });

  it('reports no propagation duration for Anzucht without one, independent of planting date', () => {
    const plan = { crop: 3, cultivation_type: 'pre_cultivation' as const };
    expect(getPlanPropagationInfo(plan, anzuchtCropWithoutDuration)).toEqual({
      isPreCultivation: true,
      propagationDurationDays: null,
    });
  });

  it('reports direct sowing without a propagation duration', () => {
    const plan = { crop: 2, cultivation_type: 'direct_sowing' as const };
    expect(getPlanPropagationInfo(plan, directCrop)).toEqual({
      isPreCultivation: false,
      propagationDurationDays: null,
    });
  });
});

describe('getPlantingDateFromSowingDate', () => {
  it('shifts the sowing date forward by the propagation duration for Anzucht', () => {
    const plan: PlantingPlan = { crop: 1, planting_date: null, cultivation_type: 'pre_cultivation' };
    expect(getPlantingDateFromSowingDate('2026-04-03', plan, anzuchtCrop)).toBe('2026-05-01');
  });

  it('is the identity for direct sowing', () => {
    const plan: PlantingPlan = { crop: 2, planting_date: null, cultivation_type: 'direct_sowing' };
    expect(getPlantingDateFromSowingDate('2026-05-01', plan, directCrop)).toBe('2026-05-01');
  });

  it('is the identity when the propagation duration cannot be resolved', () => {
    const plan: PlantingPlan = { crop: 3, planting_date: null, cultivation_type: 'pre_cultivation' };
    expect(getPlantingDateFromSowingDate('2026-05-01', plan, anzuchtCropWithoutDuration)).toBe('2026-05-01');
  });
});
