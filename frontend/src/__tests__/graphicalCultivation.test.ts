import { describe, expect, it } from 'vitest';
import type { PlantingPlan } from '../api/types';
import { getCropReference, indexBedCultivations, projectBedCultivation, stepCropDate } from '../pages/graphicalCultivation';

const season = { start_date: '2025-10-01', end_date: '2026-09-30' };
const plan = (changes: Partial<PlantingPlan> = {}): PlantingPlan => ({
  id: 1, bed: 20, crop: 3, crop_name: 'Lettuce', planting_date: '2026-02-15',
  harvest_date: '2026-04-07', harvest_end_date: '2026-05-03', occupancy_end_date: '2026-05-03',
  ...changes,
});

const project = (plans: PlantingPlan[], date: string) => projectBedCultivation(indexBedCultivations(plans).get(20) ?? [],
  { kind: 'date', date, today: false }, season);

describe('crop reference dates', () => {
  it('uses local today only inside the selected season and keeps valid explicit dates', () => {
    expect(getCropReference(null, season, '2026-02-01')).toEqual({ kind: 'date', date: '2026-02-01', today: true });
    expect(getCropReference({ kind: 'today' }, season, '2027-05-01')).toEqual({
      kind: 'date', date: '2025-10-01', today: false,
    });
    expect(getCropReference({ kind: 'date', date: '2026-03-31' }, season, '2026-02-01')).toEqual({
      kind: 'date', date: '2026-03-31', today: false,
    });
    expect(getCropReference({ kind: 'date', date: '2024-03-31' }, season, '2026-02-01')).toEqual({
      kind: 'date', date: '2026-02-01', today: true,
    });
    expect(getCropReference({ kind: 'season' }, season, '2027-05-01')).toEqual({ kind: 'season' });
    expect(stepCropDate('2025-12-31', 1, season)).toBe('2026-01-01');
    expect(stepCropDate(season.end_date, 1, season)).toBe(season.end_date);
  });
});

describe('bed cultivation projection', () => {
  it('shows growth and harvest in the bed only after planting and through the occupancy end', () => {
    const nursery = plan({ cultivation_type: 'pre_cultivation', actual_propagation_start_date: '2025-11-15',
      actual_sowing_date: '2025-12-01', actual_transplanting_date: '2026-02-17' });
    expect(project([nursery], '2026-02-16')).toEqual([]);
    expect(project([nursery], '2026-03-01')).toMatchObject([{ phase: 'growth', recordedHarvest: false, plan: { planted: '2026-02-17' } }]);
    expect(project([nursery], '2026-04-07')).toMatchObject([{ phase: 'harvest', recordedHarvest: false }]);
    expect(project([nursery], '2026-05-03')).toHaveLength(1);
    expect(project([nursery], '2026-05-04')).toEqual([]);
  });

  it('shows occupancy between the end of harvest and an explicit later clearing date', () => {
    const standing = plan({ clearing_date: '2026-06-09', occupancy_end_date: '2026-06-09' });
    expect(project([standing], '2026-05-15')).toMatchObject([{ phase: 'occupancy' }]);
  });

  it('shows simultaneous partial crops, then sorts the whole-season sequence without assigning phases', () => {
    const previous = plan({ id: 2, planting_date: '2025-08-21', harvest_date: '2025-09-30',
      harvest_end_date: '2025-10-22', occupancy_end_date: '2025-10-22', carried_over: true });
    const simultaneous = plan({ id: 3, planting_date: '2026-04-01', harvest_date: '2026-05-10',
      harvest_end_date: '2026-05-28', occupancy_end_date: '2026-05-28', area_usage_sqm: 2 });
    const parcel = plan({ id: 4, bed: null, parcel: 30 });
    expect(project([previous, simultaneous, plan(), parcel], '2026-04-13').map(entry => entry.phase))
      .toEqual(['harvest', 'growth']);
    const indexed = indexBedCultivations([simultaneous, plan(), previous, parcel]);
    const wholeSeason = projectBedCultivation(indexed.get(20)!, { kind: 'season' }, season);
    expect(wholeSeason.map(item => [item.plan.id, item.phase])).toEqual([[2, null], [1, null], [3, null]]);
  });

  it('keeps an incomplete bed allocation uncertain after its planned start', () => {
    const unreliable = plan({ id: 5, harvest_date: null, harvest_end_date: null, occupancy_end_date: '2026-02-15' });
    expect(project([unreliable], '2026-08-01')).toMatchObject([{ phase: null, plan: { end: null } }]);
    expect(project([unreliable], '2026-02-01')).toEqual([]);
    expect(project([plan({ crop: null })], '2026-03-10')).toMatchObject([{ phase: null }]);
  });

  it('uses supplied recurring windows and recorded harvests, keeping the perennial until clearing', () => {
    const perennial = plan({ planting_date: '2022-09-10', clearing_date: '2026-07-18',
      occupancy_end_date: '2026-07-18', crop_life_cycle: 'perennial',
      seasonal_harvest: { occupancy_start_date: '2022-09-08', actual_start_date: null, actual_end_date: null,
        periods: [{ start_date: '2026-06-06', end_date: '2026-06-22' }] },
      harvest_actual_occurrences: [{
        year: 2026, planned_start_date: '2026-06-06', planned_end_date: '2026-06-22',
        actual_start_date: '2026-06-15', actual_end_date: '2026-06-16',
      }],
    });
    expect(project([perennial], '2026-03-21')).toMatchObject([{ phase: 'occupancy', recordedHarvest: false }]);
    expect(project([perennial], '2026-06-10')).toMatchObject([{ phase: 'harvest', recordedHarvest: false }]);
    expect(project([perennial], '2026-06-16')).toMatchObject([{ phase: 'harvest', recordedHarvest: true }]);
    expect(project([perennial], '2026-07-19')).toEqual([]);
  });
});
