import { describe, expect, it } from 'vitest';
import { plantingPlanDetailPath } from '../planting-plans/plantingPlanDetailRoutes';

describe('plantingPlanDetailPath', () => {
  it('builds a detail path from the table path', () => {
    expect(plantingPlanDetailPath(7)).toBe('/app/planting-plans/7');
    expect(plantingPlanDetailPath(7, '/app/anbauplaene/')).toBe('/app/anbauplaene/7');
  });

  it('replaces the id of an already open detail path instead of nesting', () => {
    expect(plantingPlanDetailPath(7, '/app/planting-plans/5')).toBe('/app/planting-plans/7');
  });
});
