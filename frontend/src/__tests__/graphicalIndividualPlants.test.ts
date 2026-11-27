import { describe, expect, it } from 'vitest';
import type { PlantingPlan } from '../api/types';
import { getIndividualPlantLabels, placeIndividualPlantObjects, projectIndividualPlants } from '../pages/graphicalIndividualPlants';

const season = { start_date: '2026-01-01', end_date: '2026-12-31' };
const bed: PlantingPlan = {
  id: 1, bed: 20, crop: 3, crop_name: 'Beetroot', crop_variety: 'Detroit', placement_mode: 'individual_bed',
  planting_date: '2026-02-15', harvest_date: '2026-04-07', harvest_end_date: '2026-05-03', occupancy_end_date: '2026-05-03',
  individual_positions: [{ id: 'one', x_m: 1, y_m: 1 }, { id: 'two', x_m: 2, y_m: 1 }, { id: 'three', x_m: 3, y_m: 1 }],
};
const onDate = (date: string) => ({ kind: 'date', date, today: false } as const);
const surface = { x: 150, y: 80, width: 200, height: 100 };
const dimensions = { width_m: 10, length_m: 5 };
const growth = () => projectIndividualPlants([bed], onDate('2026-03-03'), season, null).get('bed:20')![0];

describe('individual plants in Graphic', () => {
  it('uses the shared cultivation phases for both placement parents and respects the selected date', () => {
    const direct: PlantingPlan = { ...bed, id: 2, bed: null, parcel: 10, placement_mode: 'individual_parcel' };
    expect(projectIndividualPlants([bed, direct], onDate('2026-02-01'), season, null).size).toBe(0);
    const harvest = projectIndividualPlants([bed, direct], onDate('2026-04-10'), season, null);
    expect(harvest.get('field:10')?.[0].crop.phase).toBe('harvest');
    expect(harvest.get('bed:20')?.[0].crop.phase).toBe('harvest');
    expect(projectIndividualPlants([bed], { kind: 'season' }, season, null).get('bed:20')?.[0].crop.phase).toBeNull();
    expect(projectIndividualPlants([bed], onDate('2026-06-01'), season, 1).get('bed:20')?.[0].crop.phase).toBeNull();
  });

  it('retains an individual task target outside the crop window with the same marker identity and no crop phase', () => {
    const window = { kind: 'range', start: '2026-06-01', end: '2026-06-08' } as const;
    expect(projectIndividualPlants([bed], window, season, null).size).toBe(0);
    const targets = projectIndividualPlants([bed], window, season, null, new Map([[1, []]])).get('bed:20')!;
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ cropProjected: false, crop: { phase: null } });
    const markers = placeIndividualPlantObjects(targets[0], dimensions, surface, 0, 'Beetroot', null);
    expect(markers.map(marker => marker.key)).toEqual(['plant:one', 'plant:two', 'plant:three']);
    expect(projectIndividualPlants([bed], { ...window, start: '2026-04-01' }, season, null)
      .get('bed:20')?.[0]).toMatchObject({ cropProjected: true, crop: { phase: null } });
  });

  it('places each target at the rotated position and retains its index within the plan', () => {
    const plants = placeIndividualPlantObjects(growth(), dimensions, surface, 90, 'Beetroot (Detroit)', 'Growth');
    expect(plants.map(({ key, index, count, rect }) => [key, index, count, rect])).toEqual([
      ['plant:one', 1, 3, { x: 310, y: 90, width: 0, height: 0 }],
      ['plant:two', 2, 3, { x: 310, y: 100, width: 0, height: 0 }],
      ['plant:three', 3, 3, { x: 310, y: 110, width: 0, height: 0 }],
    ]);
  });

  it('shows more labels with more screen space, clear of the individual markers', () => {
    const plants = placeIndividualPlantObjects(growth(), dimensions, surface, 0, 'Beetroot (Detroit)', 'Growth');
    const size = { width: 950, height: 420 };
    const measure = (value: string) => value.length * 6;
    const fit = { x: -55, y: 0, scale: 0.7 };
    const zoom = { x: -1055, y: -600, scale: 8 };
    const fewer = getIndividualPlantLabels(plants, [], fit, size, measure);
    const more = getIndividualPlantLabels(plants, [], zoom, size, measure);
    expect(more.size).toBeGreaterThan(fewer.size);
    for (const plant of plants) {
      const label = more.get(plant.stemId);
      if (!label) continue;
      const x = zoom.x + plant.rect.x * zoom.scale + label.x;
      const y = zoom.y + plant.rect.y * zoom.scale + label.y;
      for (const candidate of plants) {
        const point = { x: zoom.x + candidate.rect.x * zoom.scale, y: zoom.y + candidate.rect.y * zoom.scale };
        expect(point.x >= x && point.x <= x + label.width && point.y >= y && point.y <= y + label.height).toBe(false);
      }
    }
  });

  it('sizes a label from the compact crop name only, without a phase row', () => {
    const [stem] = placeIndividualPlantObjects(growth(), dimensions, surface, 0, 'Apfel (Topaz)', 'Geplante Belegung eines sehr langen Zeitraums');
    stem.rect = { x: 100, y: 100, width: 0, height: 0 };
    const label = getIndividualPlantLabels([stem], [], { x: 0, y: 0, scale: 1 }, { width: 500, height: 400 },
      value => value.length * 6).get(stem.stemId);
    expect(label).toMatchObject({ width: 'Apfel (Topaz)'.length * 6 + 10, height: 17 });
  });

  it('can place a label beside a marker even when the label and marker share a search cell', () => {
    const [stem] = placeIndividualPlantObjects(growth(), dimensions, surface, 0, 'Beetroot', null);
    stem.rect = { x: 69, y: 60, width: 0, height: 0 };
    const beds = [{ x: 85, y: 45, width: 90, height: 50 }];
    const viewport = { x: 0, y: 0, scale: 1 };
    const size = { width: 500, height: 400 };
    const measure = () => 10;
    expect(getIndividualPlantLabels([stem], beds, viewport, size, measure).get(stem.stemId)).toMatchObject({ x: -38 });
    const nearby = { ...stem, stemId: 'nearby', rect: { ...stem.rect, x: 56 } };
    expect(getIndividualPlantLabels([stem, nearby], beds, viewport, size, measure).has(stem.stemId)).toBe(false);
  });
});
