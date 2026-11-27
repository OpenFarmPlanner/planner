import { describe, expect, it } from 'vitest';
import type { Field } from '../api/types';
import {
  canvasToStem, individualCountAfterRemoval, individualRemovalBlock, shortStemSpacing, stemToCanvas,
} from '../pages/individualPlantGeometry';

const field: Field = { name: 'Orchard', location: 1, width_m: 12, length_m: 20 };
const surface = { x: 10, y: 34, width: 340, height: 192 };

describe('individual plant geometry', () => {
  it('uses the same metre coordinates through view rotations and parcel movements', () => {
    const stem = { x_m: 2.45, y_m: 16.25 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const draw = stemToCanvas(stem, field, surface, rotation);
      expect(draw).not.toBeNull();
      expect(canvasToStem(draw!, field, surface, rotation)).toEqual(stem);
      const moved = { ...surface, x: surface.x + 40, y: surface.y + 22 };
      expect(stemToCanvas(stem, field, moved, rotation)).toEqual({
        x: draw!.x + 40, y: draw!.y + 22,
      });
    }
  });

  it('clamps drag coordinates to the measured parcel at centimetre precision', () => {
    expect(canvasToStem({ x: 600, y: -20 }, { ...field, width_m: 12.005 }, surface, 0))
      .toEqual({ x_m: 12, y_m: 0 });
    expect(stemToCanvas({ x_m: 2, y_m: 4 }, { ...field, length_m: undefined }, surface, 0)).toBeNull();
  });

  it('checks the centre-to-centre spacing without using the canopy', () => {
    const positions = [{ x_m: 0, y_m: 0 }, { x_m: 3, y_m: 4 }, { x_m: 3, y_m: 5 }];
    expect(shortStemSpacing(positions, 5)).toEqual({ pairs: 1, closest: 1 });
    expect(shortStemSpacing(positions, 1)).toEqual({ pairs: 0, closest: null });
    expect(shortStemSpacing(positions, null)).toEqual({ pairs: 0, closest: null });
  });
});

describe('individual plant removal', () => {
  const stems = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `s${index}`, x_m: index, y_m: 0 }));

  it('lowers an exact total by the removed plants and keeps the total when only positions are removed', () => {
    const plan = { individual_count: 5, individual_positions: stems(2) };
    expect(individualRemovalBlock(plan, 1, 'plant')).toBeNull();
    expect(individualCountAfterRemoval(plan, 1, 'plant')).toBe(4);
    expect(individualCountAfterRemoval(plan, 2, 'position')).toBe(5);
  });

  it('keeps a plan without an exact total counted by its positions and records the total when clearing a position', () => {
    const plan = { individual_count: null, individual_positions: stems(3) };
    expect(individualCountAfterRemoval(plan, 1, 'plant')).toBeNull();
    expect(individualCountAfterRemoval(plan, 1, 'position')).toBe(3);
  });

  it('never removes the last plant of a plan, but still allows clearing its position', () => {
    expect(individualRemovalBlock({ individual_count: null, individual_positions: stems(1) }, 1, 'plant')).toBe('finalPlant');
    expect(individualRemovalBlock({ individual_count: 1, individual_positions: stems(1) }, 1, 'plant')).toBe('finalPlant');
    expect(individualRemovalBlock({ individual_count: null, individual_positions: stems(1) }, 1, 'position')).toBeNull();
  });

  it('blocks a planned-total correction once harvests or losses are recorded', () => {
    const plan = { individual_count: 4, individual_positions: stems(4) };
    expect(individualRemovalBlock({ ...plan, crop_loss_count: 1 }, 1, 'plant')).toBe('actualRecords');
    expect(individualRemovalBlock({ ...plan, actual_harvest: { quantity_kg: 2 } as never }, 1, 'plant')).toBe('actualRecords');
    expect(individualRemovalBlock({ ...plan, crop_loss_count: 1 }, 1, 'position')).toBeNull();
  });
});
