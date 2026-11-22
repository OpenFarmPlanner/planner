import { describe, expect, it } from 'vitest';
import type { PlantingPlan } from '../api/types';
import {
  displayedPlanDate, displayedPlanDates, getPlanActivityDates, getPlanColumnDates, planDateDeviation,
} from '../planting-plans/plantingPlanActualDates';

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

  it('uses each clipped perennial period and only the season’s own actual dates', () => {
    const recurring = {
      ...plan,
      actual_harvest_start_date: '2026-05-04',
      recorded_harvest_end_date: '2026-05-12',
      seasonal_harvest: {
        periods: [
          { start_date: '2027-01-01', end_date: '2027-01-10' },
          { start_date: '2027-12-20', end_date: '2027-12-31' },
        ],
        actual_start_date: '2027-01-03',
        actual_end_date: null,
      },
    };
    const start = getPlanColumnDates(recurring, 'harvest_date');
    const end = getPlanColumnDates(recurring, 'harvest_end_date');
    expect(displayedPlanDates(start, 'planned')).toEqual(['2027-01-01', '2027-12-20']);
    expect(displayedPlanDates(start, 'actual')).toEqual(['2027-01-03']);
    expect(displayedPlanDates(start, 'combined')).toEqual(['2027-01-03']);
    expect(displayedPlanDates(end, 'combined')).toEqual(['2027-01-10', '2027-12-31']);
    expect(displayedPlanDates(end, 'actual')).toEqual([]);
    expect(planDateDeviation(start)).toBeNull();
    expect(getPlanColumnDates(recurring, 'planting_date')).toEqual(getPlanColumnDates(plan, 'planting_date'));
  });

  it('shows no harvest dates for a nonbearing season and preserves one-off plans', () => {
    const nonbearing = {
      ...plan,
      seasonal_harvest: { periods: [], actual_start_date: null, actual_end_date: null },
    };
    expect(displayedPlanDates(getPlanColumnDates(nonbearing, 'harvest_date'), 'combined')).toEqual([]);
    expect(displayedPlanDates(getPlanColumnDates(nonbearing, 'harvest_end_date'), 'planned')).toEqual([]);
    expect(displayedPlanDates(getPlanColumnDates({ ...plan, seasonal_harvest: null }, 'harvest_date'), 'combined'))
      .toEqual(['2026-05-04']);
  });

  it('displays copied supplemental activities and leaves their new actual dates empty', () => {
    const copied: PlantingPlan = {
      crop: 1, bed: 2, cultivation_type: 'pre_cultivation',
      planting_date: '2027-04-07', crop_propagation_duration_days: 21,
      planned_propagation_start_date: '2027-03-12', planned_sowing_date: '2027-03-13',
    };
    expect(getPlanColumnDates(copied, 'sowing_date')).toEqual({
      activity: 'propagation', planned: '2027-03-12', actual: null,
    });
    const activities = getPlanActivityDates(copied);
    expect(activities.find(date => date.activity === 'sowing')).toEqual({
      activity: 'sowing', planned: '2027-03-13', actual: null,
    });
    expect(activities.find(date => date.activity === 'transplanting')).toEqual({
      activity: 'transplanting', planned: '2027-04-07', actual: null,
    });
  });

  it('compares calendar days across daylight-saving changes with a signed difference', () => {
    expect(planDateDeviation({ activity: 'sowing', planned: '2026-03-28', actual: '2026-03-30' })).toBe(2);
    expect(planDateDeviation({ activity: 'sowing', planned: '2026-03-30', actual: '2026-03-28' })).toBe(-2);
    expect(planDateDeviation({ activity: 'sowing', planned: '2026-03-30', actual: '2026-03-30' })).toBe(0);
    expect(planDateDeviation({ activity: 'sowing', planned: '2026-03-30', actual: null })).toBeNull();
  });
});
