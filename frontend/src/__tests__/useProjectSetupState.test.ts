import { describe, expect, it } from 'vitest';
import { deriveProjectSetupState, type ProjectSetupStateInput } from '../hooks/useProjectSetupState';

const counts = (overrides: Partial<ProjectSetupStateInput> = {}): ProjectSetupStateInput => ({
  fieldsCount: 0,
  bedsCount: 0,
  cropsCount: 0,
  plantingPlansCount: 0,
  ...overrides,
});

describe('the four "has" flags', () => {
  it.each([
    ['hasFields', 'fieldsCount'],
    ['hasBeds', 'bedsCount'],
    ['hasCrops', 'cropsCount'],
    ['hasPlantingPlans', 'plantingPlansCount'],
  ] as const)('%s follows %s', (flag, key) => {
    // Each flag is wired to its own count. They are all booleans over the
    // same shape, so a crossed pair is invisible unless each is moved alone.
    expect(deriveProjectSetupState(counts({ [key]: 1 }))[flag]).toBe(true);

    const others = deriveProjectSetupState(counts({ [key]: 1 }));
    const changed = Object.entries(others).filter(
      ([name, value]) => value === true && name !== flag,
    );
    expect(changed).toEqual([]);
  });

  it('reports nothing set up for an empty project', () => {
    // The state a project is in immediately after it is created, which is
    // what the dashboard's onboarding checklist renders against.
    expect(deriveProjectSetupState(counts())).toEqual({
      hasFields: false,
      hasBeds: false,
      hasCrops: false,
      hasPlantingPlans: false,
      hasSuppliers: false,
      missingForPlantingPlans: ['crops', 'beds'],
    });
  });

  it('reports everything set up for a project in use', () => {
    expect(deriveProjectSetupState({
      fieldsCount: 2,
      bedsCount: 9,
      cropsCount: 14,
      plantingPlansCount: 30,
      suppliersCount: 3,
    })).toEqual({
      hasFields: true,
      hasBeds: true,
      hasCrops: true,
      hasPlantingPlans: true,
      hasSuppliers: true,
      missingForPlantingPlans: [],
    });
  });

  it('treats a count of zero as not set up', () => {
    expect(deriveProjectSetupState(counts({ bedsCount: 0 })).hasBeds).toBe(false);
  });
});

describe('suppliers, which are optional', () => {
  it('is false when the count is left out entirely', () => {
    // Not every caller knows the supplier count; leaving it out must read as
    // "none" rather than crashing or reading as set up.
    expect(deriveProjectSetupState(counts()).hasSuppliers).toBe(false);
  });

  it('is false for a count of zero', () => {
    expect(deriveProjectSetupState(counts({ suppliersCount: 0 })).hasSuppliers).toBe(false);
  });

  it('is true once there is one', () => {
    expect(deriveProjectSetupState(counts({ suppliersCount: 1 })).hasSuppliers).toBe(true);
  });
});

describe('what is still missing before a planting plan can be made', () => {
  it('lists both when the project is empty', () => {
    expect(deriveProjectSetupState(counts()).missingForPlantingPlans).toEqual(['crops', 'beds']);
  });

  it('lists crops first, which is the order the checklist reads in', () => {
    // The order is what the user is asked to do them in, so it is part of the
    // contract rather than incidental.
    expect(deriveProjectSetupState(counts()).missingForPlantingPlans[0]).toBe('crops');
  });

  it('lists only beds when there are crops', () => {
    expect(deriveProjectSetupState(counts({ cropsCount: 1 })).missingForPlantingPlans).toEqual(['beds']);
  });

  it('lists only crops when there are beds', () => {
    expect(deriveProjectSetupState(counts({ bedsCount: 1 })).missingForPlantingPlans).toEqual(['crops']);
  });

  it('lists nothing once both exist', () => {
    expect(
      deriveProjectSetupState(counts({ cropsCount: 1, bedsCount: 1 })).missingForPlantingPlans,
    ).toEqual([]);
  });

  it('ignores fields, which a plan does not need directly', () => {
    // A bed belongs to a field, so having beds already implies fields; the
    // checklist must not ask for something the user has effectively done.
    expect(
      deriveProjectSetupState(counts({ cropsCount: 1, bedsCount: 1, fieldsCount: 0 })).missingForPlantingPlans,
    ).toEqual([]);
  });

  it('ignores existing plans', () => {
    // The list is about what is missing to make one, not whether any exist.
    expect(
      deriveProjectSetupState(counts({ plantingPlansCount: 5 })).missingForPlantingPlans,
    ).toEqual(['crops', 'beds']);
  });

  it('returns a fresh array each time', () => {
    // The callers render it and some sort it in place; a shared array would
    // leak one page's mutation into the next.
    const first = deriveProjectSetupState(counts()).missingForPlantingPlans;
    const second = deriveProjectSetupState(counts()).missingForPlantingPlans;

    expect(first).not.toBe(second);
  });
});
