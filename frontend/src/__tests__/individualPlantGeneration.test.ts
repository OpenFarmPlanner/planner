import { describe, expect, it } from 'vitest';
import type { Bed, Crop, Field, PlantingPlan } from '../api/types';
import {
  collectOccupiedPlantPositions, generateRegularPlants, getIndividualPlantFrames, individualCropSpacings,
  individualPlacementPeriod, type RegularPlantInputs,
} from '../pages/individualPlantGeneration';

const wholeBed = { width: 2, height: 4 };
const wideBedInputs: RegularPlantInputs = {
  count: 'max', plantSpacing: 0.5, rowSpacing: 1.5, marginWidth: 0.5, marginLength: 0.5, along: 'width',
};

describe('regular individual plant positions', () => {
  it('fills a rectangular bed without leaving its measured bounds or margins', () => {
    const result = generateRegularPlants(wholeBed, wideBedInputs, [], 0);
    expect(result).toMatchObject({ rowCount: 3, maxAdditional: 9, freeSlots: 9n });
    expect(result.positions).toEqual([
      { x_m: 0.5, y_m: 0.5 }, { x_m: 1, y_m: 0.5 }, { x_m: 1.5, y_m: 0.5 },
      { x_m: 0.5, y_m: 2 }, { x_m: 1, y_m: 2 }, { x_m: 1.5, y_m: 2 },
      { x_m: 0.5, y_m: 3.5 }, { x_m: 1, y_m: 3.5 }, { x_m: 1.5, y_m: 3.5 },
    ]);
  });

  it('turns the row orientation and stops at the exact requested number', () => {
    const inputs = { ...wideBedInputs, along: 'length' as const, count: 4 };
    const result = generateRegularPlants(wholeBed, inputs, [], 0);
    expect(result).toMatchObject({ rowCount: 1, maxAdditional: 7, freeSlots: 7n });
    expect(result.positions).toEqual([
      { x_m: 0.5, y_m: 0.5 }, { x_m: 0.5, y_m: 1 },
      { x_m: 0.5, y_m: 1.5 }, { x_m: 0.5, y_m: 2 },
    ]);
  });

  it('skips duplicates and meaningful spacing conflicts and keeps positions at the exact spacing', () => {
    const occupied = [{ x_m: 0.5, y_m: 0.5 }, { x_m: 1.5, y_m: 2.2 }];
    const result = generateRegularPlants(wholeBed, wideBedInputs, occupied, 2);
    expect(result).toMatchObject({ maxAdditional: 6, blockedSlots: 3 });
    expect(result.positions).toContainEqual({ x_m: 1, y_m: 0.5 });
    expect(result.positions).not.toContainEqual({ x_m: 1.5, y_m: 2 });
    expect(occupied).toEqual([{ x_m: 0.5, y_m: 0.5 }, { x_m: 1.5, y_m: 2.2 }]);
  });

  it.each([
    [{ count: 10 }, 'notEnough'],
    [{ count: 1.5 }, 'count'],
    [{ rowSpacing: 0 }, 'spacing'],
    [{ plantSpacing: null }, 'spacing'],
    [{ marginWidth: -0.01 }, 'margin'],
    [{ marginWidth: 1.1 }, 'noFit'],
  ] as const)('rejects unusable input %o before emitting positions', (change, problem) => {
    const result = generateRegularPlants(wholeBed, { ...wideBedInputs, ...change }, [], 0);
    expect(result).toMatchObject({ positions: [], problem });
  });

  it('reports missing measurements and leaves positions empty', () => {
    const result = generateRegularPlants(null, wideBedInputs, [], 0);
    expect(result).toMatchObject({ positions: [], problem: 'dimensions' });
  });

  it('does not materialize a huge grid or truncate a request at the per-plan cap', () => {
    const parcel = { width: 900_000, height: 900_000 };
    const inputs = { ...wideBedInputs, plantSpacing: 0.01, rowSpacing: 0.01 };
    const result = generateRegularPlants(parcel, inputs, [], 750);
    expect(result).toMatchObject({
      problem: 'cap', maxAdditional: 250, positions: [],
    });
    expect(result.freeSlots).toBeGreaterThan(1_000_000_000n);
    expect(generateRegularPlants(parcel, { ...inputs, count: 251 }, [], 750).positions).toHaveLength(0);
    expect(generateRegularPlants(parcel, { ...inputs, count: 250 }, [], 750).positions).toHaveLength(250);
  });

  it('keeps centimetre positions within fractional measured boundaries', () => {
    const input = { ...wideBedInputs, marginWidth: 0, marginLength: 0, plantSpacing: 0.01, rowSpacing: 1 };
    const { positions } = generateRegularPlants({ width: 0.045, height: 0.5 }, input, [], 0);
    expect(positions.at(-1)).toEqual({ x_m: 0.04, y_m: 0 });
  });
});

describe('shared placement geometry and occupancy', () => {
  const plot = { id: 10, location: 1, name: 'North', width_m: 12, length_m: 16 } as Field;
  const bed = { id: 11, name: 'Mixed bed', field: 10, width_m: 2, length_m: 4 } as Bed;
  const period = { start: '2026-05-20', end: '2026-06-30' };

  it('projects bed stems into parcel space, preserving area plans and excluding past placements', () => {
    const frames = getIndividualPlantFrames([plot], [bed], {}).get(10)!;
    const frame = frames.get('bed:11')!;
    const bedStem = { id: 'first', x_m: 0.5, y_m: 1 };
    const plotStem = {
      id: 'second',
      x_m: frame.rect.x + 1.5 / frame.dimensions.width * frame.rect.width,
      y_m: frame.rect.y + 3 / frame.dimensions.height * frame.rect.height,
    };
    const plans: PlantingPlan[] = [
      { id: 1, crop: 5, bed: 11, placement_mode: 'individual_bed', planting_date: '2026-05-20',
        occupancy_end_date: '2026-06-01', individual_positions: [bedStem] },
      { id: 2, crop: 6, bed: null, parcel: 10, planting_date: '2026-05-10',
        occupancy_end_date: '2026-05-20', individual_positions: [plotStem] },
      { id: 3, crop: 7, bed: 11, area_usage_sqm: 3, planting_date: '2026-05-20' },
      { id: 4, crop: 8, bed: null, parcel: 10, planting_date: '2026-05-10',
        occupancy_end_date: '2026-05-19', individual_positions: [plotStem] },
    ];
    const bedOccupied = collectOccupiedPlantPositions({ frames, parent: { kind: 'bed', id: 11 }, plans, period });
    expect(bedOccupied).toHaveLength(2);
    expect(bedOccupied[0]).toEqual(bedStem);
    expect(bedOccupied[1].x_m).toBeCloseTo(1.5);
    expect(bedOccupied[1].y_m).toBeCloseTo(3);

    const plotOccupied = collectOccupiedPlantPositions({
      frames, parent: { kind: 'field', id: 10 }, plans, period, planId: 2,
    });
    expect(plotOccupied).toHaveLength(1);
    expect(plotOccupied[0].x_m).toBeCloseTo(frame.rect.x + frame.rect.width / 4);
    expect(plotOccupied[0].y_m).toBeCloseTo(frame.rect.y + frame.rect.height / 4);
    expect(generateRegularPlants(wholeBed, wideBedInputs, bedOccupied, 0).blockedSlots).toBeGreaterThan(0);
  });

  it('uses effective crop values for different in-row and between-row spacing', () => {
    const crop = {
      name: 'Bean', distance_within_row_cm: 25,
      effective_values: { row_spacing_cm: 80, growth_duration_days: 30, harvest_duration_days: 10 },
    } as Crop;
    expect(individualCropSpacings(crop)).toEqual({ plantSpacing: 0.25, rowSpacing: 0.8 });
    expect(individualCropSpacings(undefined)).toEqual({ plantSpacing: null, rowSpacing: null });
    expect(individualPlacementPeriod('2026-05-20', crop)).toEqual({
      start: '2026-05-20', end: '2026-06-29',
    });
  });
});
