import { describe, expect, it } from 'vitest';
import type { PlantingPlan } from '../api/types';
import { displayedPlanDate, getPlanActivityDates, getPlanColumnDates, planDateDeviation } from '../planting-plans/plantingPlanActualDates';

const plan: PlantingPlan = {
  crop: 1, bed: 2, planting_date: '2026-04-04', harvest_date: '2026-05-04',
  harvest_end_date: '2026-05-14', actual_harvest_end_date: '2026-05-12',
  cultivation_type: 'pre_cultivation', crop_propagation_duration_days: 21,
  actual_propagation_start_date: '2026-03-14', actual_transplanting_date: '2026-04-06',
};

describe('planting-plan dates', () => {
  it('displays only dates from the chosen mode and falls back to plan only in Combined', () => {
    const dates = getPlanColumnDates(plan, 'planting_date');
    expect(displayedPlanDate(dates, 'planned')).toBe('2026-04-04');
    expect(displayedPlanDate(dates, 'actual')).toBe('2026-04-06');
    expect(displayedPlanDate(dates, 'combined')).toBe('2026-04-06');

    const cleared = getPlanColumnDates({ ...plan, actual_transplanting_date: null }, 'planting_date');
    expect(displayedPlanDate(cleared, 'actual')).toBeNull();
    expect(displayedPlanDate(cleared, 'combined')).toBe('2026-04-04');
  });

  it('relates the sowing column to propagation for home-raised plants and sowing for direct planting', () => {
    expect(getPlanColumnDates(plan, 'sowing_date')).toEqual({
      activity: 'propagation', planned: '2026-03-14', actual: '2026-03-14',
    });
    const direct = { ...plan, cultivation_type: 'direct_sowing' as const, actual_sowing_date: '2026-04-02' };
    expect(getPlanColumnDates(direct, 'planting_date')).toEqual({
      activity: 'sowing', planned: '2026-04-04', actual: '2026-04-02',
    });
    expect(getPlanActivityDates(direct).find(date => date.activity === 'transplanting')?.planned).toBeNull();
  });

  it('keeps the calculated succession boundary separate from recorded harvest end', () => {
    const harvestEnd = getPlanActivityDates(plan).find(date => date.activity === 'harvestEnd');
    expect(harvestEnd).toEqual({ activity: 'harvestEnd', planned: '2026-05-14', actual: null });
    expect(getPlanColumnDates({ ...plan, recorded_harvest_end_date: '2026-05-16' }, 'harvest_end_date').actual)
      .toBe('2026-05-16');
  });

  it('compares calendar days across daylight-saving changes with a signed difference', () => {
    expect(planDateDeviation({ activity: 'sowing', planned: '2026-03-28', actual: '2026-03-30' })).toBe(2);
    expect(planDateDeviation({ activity: 'sowing', planned: '2026-03-30', actual: '2026-03-28' })).toBe(-2);
    expect(planDateDeviation({ activity: 'sowing', planned: '2026-03-30', actual: '2026-03-30' })).toBe(0);
    expect(planDateDeviation({ activity: 'sowing', planned: '2026-03-30', actual: null })).toBeNull();
  });
});
