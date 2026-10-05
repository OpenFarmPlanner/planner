import { describe, expect, it } from 'vitest';
import type { Bed, Crop, Field, Location, PlantingPlan } from '../api/types';
import { deriveLocationTasks } from '../pages/locationDerivedTasks';

const locations: Location[] = [{ id: 1, name: 'Hof Nord' }];
const fields: Field[] = [{ id: 10, name: 'Parzelle A', location: 1 }];
const beds: Bed[] = [{ id: 100, name: 'Beet 1', field: 10 }];

describe('deriveLocationTasks', () => {
  it('keeps an unspecified cultivation type as a planting task', () => {
    const crops: Crop[] = [{ id: 5, name: 'Karotte', growth_duration_days: 60 }];
    const plans: PlantingPlan[] = [{ id: 99, crop: 5, bed: 100, planting_date: '2026-04-12' }];

    const tasks = deriveLocationTasks({
      locations,
      fields,
      beds,
      plantingPlans: plans,
      crops,
      today: new Date('2026-04-01'),
    });

    expect(tasks[1][0].type).toBe('planting');
  });

  it('derives sowing and harvest tasks for direct sowing plans', () => {
    const crops: Crop[] = [
      { id: 5, name: 'Karotte', cultivation_types: ['direct_sowing'], growth_duration_days: 60 },
    ];
    const plans: PlantingPlan[] = [
      { id: 99, crop: 5, bed: 100, planting_date: '2026-04-12', cultivation_type: 'direct_sowing' },
    ];

    const tasks = deriveLocationTasks({
      locations,
      fields,
      beds,
      plantingPlans: plans,
      crops,
      today: new Date('2026-04-01'),
    });

    expect(tasks[1].map((task) => task.type)).toEqual(['sowing', 'harvestStart']);
    expect(tasks[1][0].date).toBe('2026-04-12');
    expect(tasks[1][1].date).toBe('2026-06-11');
  });

  it('derives planting and propagation-start tasks for pre-cultivation', () => {
    const crops: Crop[] = [
      { id: 6, name: 'Salat', cultivation_types: ['pre_cultivation'], propagation_duration_days: 21, growth_duration_days: 35 },
    ];
    const plans: PlantingPlan[] = [
      { id: 1000, crop: 6, bed: 100, planting_date: '2026-05-03', cultivation_type: 'pre_cultivation' },
    ];

    const tasks = deriveLocationTasks({
      locations,
      fields,
      beds,
      plantingPlans: plans,
      crops,
      today: new Date('2026-04-01'),
    });

    expect(tasks[1].map((task) => task.type)).toEqual([
      'propagationStart',
      'planting',
      'harvestStart',
    ]);
    expect(tasks[1][0].date).toBe('2026-04-12');
  });

  it('prefers localized planting plan crop names', () => {
    const crops: Crop[] = [
      { id: 5, name: 'Karotte', cultivation_types: ['direct_sowing'], growth_duration_days: 60 },
    ];
    const plans: PlantingPlan[] = [
      {
        id: 99,
        crop: 5,
        crop_name: 'Karotte',
        crop_display_name: 'Carrot',
        bed: 100,
        planting_date: '2026-04-12',
        cultivation_type: 'direct_sowing',
      },
    ];

    const tasks = deriveLocationTasks({
      locations,
      fields,
      beds,
      plantingPlans: plans,
      crops,
      today: new Date('2026-04-01'),
    });

    expect(tasks[1][0].cropName).toBe('Carrot');
    expect(tasks[1][1].cropName).toBe('Carrot');
  });

  it('skips duplicates and tasks with missing relation data', () => {
    const crops: Crop[] = [{ id: 6, name: 'Salat', cultivation_types: ['direct_sowing'] }];
    const plans: PlantingPlan[] = [
      { id: 1, crop: 6, bed: 100, planting_date: '2026-05-03', cultivation_type: 'direct_sowing' },
      { id: 1, crop: 6, bed: 100, planting_date: '2026-05-03', cultivation_type: 'direct_sowing' },
      { id: 2, crop: 6, bed: 9999, planting_date: '2026-05-03', cultivation_type: 'direct_sowing' },
    ];

    const tasks = deriveLocationTasks({
      locations,
      fields,
      beds,
      plantingPlans: plans,
      crops,
      today: new Date('2026-04-01'),
    });

    expect(tasks[1]).toHaveLength(1);
  });

  it('uses the timing a Sorte inherits from its general Kultur', () => {
    const crops: Crop[] = [
      {
        id: 7,
        name: 'Pastinake',
        variety: 'Halblange',
        crop_species: 3,
        general_crop: 8,
        inherited_fields: ['cultivation_types', 'propagation_duration_days', 'growth_duration_days'],
        effective_values: {
          cultivation_types: ['pre_cultivation'],
          propagation_duration_days: 21,
          growth_duration_days: 35,
        },
      },
    ];
    const plans: PlantingPlan[] = [
      { id: 1001, crop: 7, bed: 100, planting_date: '2026-05-03', cultivation_type: 'pre_cultivation' },
    ];

    const tasks = deriveLocationTasks({
      locations,
      fields,
      beds,
      plantingPlans: plans,
      crops,
      today: new Date('2026-04-01'),
    });

    expect(tasks[1].map((task) => task.type)).toEqual([
      'propagationStart',
      'planting',
      'harvestStart',
    ]);
    expect(tasks[1][0].date).toBe('2026-04-12');
    expect(tasks[1][2].date).toBe('2026-06-07');
  });
});
