import { describe, expect, it } from 'vitest';
import { FIELD_WORLD_PX_PER_METER } from '../pages/graphicalFieldsGeometry';
import { snapIndividualStem } from '../pages/individualPlantSnapping';

const metre = FIELD_WORLD_PX_PER_METER;
const options = {
  neighbors: [{ key: 'a', point: { x: 0, y: 0 } }],
  spacingMeters: 2, zoom: 1, accepts: () => true,
};

describe('individual stem snapping', () => {
  it.each([0.5, 1, 2, 4])('captures and releases at constant screen distances at zoom %s', zoom => {
    const at = (offsetPx: number) => ({ x: 2 * metre + offsetPx / zoom, y: 0 });
    const captured = snapIndividualStem(at(-7), { ...options, zoom });
    expect(captured).toEqual({
      target: 'a', point: at(0),
      guide: { neighbor: { x: 0, y: 0 }, stem: at(0), meters: 2, snapped: true },
    });
    const near = snapIndividualStem(at(10), { ...options, zoom });
    expect(near.guide).toMatchObject({ snapped: false, stem: at(10) });
    expect(near.guide?.meters).toBeCloseTo(at(10).x / metre);
    expect(snapIndividualStem(at(10), { ...options, zoom, previousKey: 'a' }).target).toBe('a');
    expect(snapIndividualStem(at(13), { ...options, zoom, previousKey: 'a' })).toEqual({
      target: null, point: at(13), guide: null,
    });
  });

  it('keeps the pointer direction and picks the closest valid correction with a stable tie-break', () => {
    const raw = { x: 0, y: 0 };
    const neighbors = [
      { key: 'c', point: { x: 0, y: 2 * metre - 1 } },
      { key: 'b', point: { x: 0, y: -(2 * metre - 1) } },
      { key: 'a', point: { x: -(2 * metre - 2), y: 0 } },
    ];
    expect(snapIndividualStem(raw, { ...options, neighbors })).toMatchObject({ target: 'b', point: { x: 0, y: 1 } });
    expect(snapIndividualStem(raw, { ...options, neighbors: neighbors.toReversed() }).target).toBe('b');
    expect(snapIndividualStem(raw, { ...options, neighbors, previousKey: 'a' }).target).toBe('a');
    expect(snapIndividualStem(raw, { ...options, neighbors, accepts: ({ y }) => y < 0 }).target).toBe('c');
    expect(snapIndividualStem(raw, { ...options, neighbors, accepts: () => false }).point).toBe(raw);
  });

  it('allows a deliberate close placement and drops the snap on Shift', () => {
    const close = { x: 1, y: 0 };
    expect(snapIndividualStem(close, options).point).toBe(close);
    const raw = { x: 3 * metre / 2, y: metre };
    const result = snapIndividualStem(raw, { ...options, previousKey: 'a', bypass: true });
    expect(result).toMatchObject({ point: raw, target: null, guide: { snapped: false } });
    expect(result.guide?.meters).toBeCloseTo(Math.hypot(1.5, 1));
  });

  it.each([null, undefined, 0, -1, Infinity, NaN])('has no snap or guide with recommendation %s', spacingMeters => {
    const raw = { x: metre, y: 0 };
    expect(snapIndividualStem(raw, { ...options, spacingMeters })).toEqual({ point: raw, target: null, guide: null });
  });
});
