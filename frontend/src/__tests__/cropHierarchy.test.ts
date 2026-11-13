import { describe, expect, it } from 'vitest';
import {
  buildCropHierarchy,
  findSpeciesCrop,
  withGroupGeneralCrops,
  withGroupSiblingCrops,
} from '../crops/cropHierarchy';
import type { Crop } from '../api/types';

describe('buildCropHierarchy', () => {
  it('keeps legacy extra general crops out of the variety rows', () => {
    const rows = buildCropHierarchy([
      { id: 1, name: 'Tomato', crop_species: 10, variety: '' },
      { id: 2, name: 'Tomato (2)', crop_species: 10, variety: '' },
      { id: 3, name: 'Tomato', crop_species: 10, variety: 'Roma' },
    ]);
    expect(rows.filter((row) => row.kind === 'variety').map((row) => row.crop?.id)).toEqual([3]);
    expect(rows.find((row) => row.crop?.id === 2)?.parentId).toBeNull();
    expect(rows.find((row) => row.crop?.id === 2)?.kind).toBe('species');
  });

  it('groups general crop entries and varieties under the same species', () => {
    const crops: Crop[] = [
      { id: 1, name: 'Tomato', crop_species: 10, variety: '', growth_duration_days: 70 },
      { id: 2, name: 'Tomato', crop_species: 10, variety: 'Roma QA' },
      { id: 3, name: 'Tomato', crop_species: 10, variety: 'Moneymaker' },
      { id: 4, name: 'Carrot', crop_species: 20, variety: 'Nantaise' },
    ];

    const rows = buildCropHierarchy(crops);

    expect(rows.map((row) => [row.kind, row.label, row.parentId])).toEqual([
      ['species', 'Tomato', null],
      ['variety', 'Roma QA', 'species:species:10'],
      ['variety', 'Moneymaker', 'species:species:10'],
      ['species', 'Carrot', null],
      ['variety', 'Nantaise', 'species:species:20'],
    ]);
    expect(rows.find((row) => row.label === 'Tomato')?.crop?.id).toBe(1);

    // Carrot has no dedicated general (variety-less) entry — its species row
    // must not fall back to displaying/selecting Carrot's only variety as if
    // it were also the general entry (that would show crop id 4 twice:
    // once as the species node, once as its own variety row).
    const carrotSpeciesRow = rows.find((row) => row.kind === 'species' && row.label === 'Carrot');
    expect(carrotSpeciesRow?.hasGeneralEntry).toBe(false);
    expect(carrotSpeciesRow?.crop).toBeNull();
    const carrotVarietyRows = rows.filter((row) => row.kind === 'variety' && row.speciesKey === carrotSpeciesRow?.speciesKey);
    expect(carrotVarietyRows).toHaveLength(1);
    expect(carrotVarietyRows[0]?.crop?.id).toBe(4);
  });

  it('finds the general crop record for a variety', () => {
    const general: Crop = { id: 1, name: 'Tomato', crop_species: 10, variety: '', growth_duration_days: 70 };
    const variety: Crop = { id: 2, name: 'Tomato', crop_species: 10, variety: 'Roma QA' };

    expect(findSpeciesCrop(variety, [variety, general])).toBe(general);
  });
});

describe('withGroupGeneralCrops', () => {
  const general: Crop = { id: 1, name: 'Pfefferoni', crop_species: 10, variety: '', growth_duration_days: 60 };
  const variety: Crop = { id: 2, name: 'Pfefferoni', crop_species: 10, variety: 'Milder Spiral' };
  const otherCrop: Crop = { id: 3, name: 'Carrot', crop_species: 20, variety: 'Nantaise' };
  const allCrops = [general, variety, otherCrop];

  it('keeps the Kultur of a group whose variety matched the search', () => {
    // Searching for "spir" only matches the Sorte, but its Kultur has to stay
    // in the list or the tree row for it has no data of its own to show.
    const result = withGroupGeneralCrops([variety], allCrops);

    expect(result).toContain(variety);
    expect(result).toContain(general);
    const rows = buildCropHierarchy(result);
    const speciesRow = rows.find((row) => row.kind === 'species');
    expect(speciesRow?.crop).toBe(general);
    expect(speciesRow?.hasGeneralEntry).toBe(true);
  });

  it('does not pull in Kulturen of groups that had no match at all', () => {
    const result = withGroupGeneralCrops([variety], allCrops);

    expect(result).not.toContain(otherCrop);
  });

  it('leaves a match list that already has its Kultur untouched', () => {
    const result = withGroupGeneralCrops([general, variety], allCrops);

    expect(result).toEqual([general, variety]);
  });

  it('adds nothing when nothing matched, so the empty state still shows', () => {
    expect(withGroupGeneralCrops([], allCrops)).toEqual([]);
  });

  it('groups free-text crops without a species by name', () => {
    const freeGeneral: Crop = { id: 4, name: 'Tomate', variety: '' };
    const freeVariety: Crop = { id: 5, name: 'Tomate', variety: 'Matina' };

    const result = withGroupGeneralCrops([freeVariety], [freeGeneral, freeVariety]);

    expect(result).toContain(freeGeneral);
  });
});

describe('withGroupSiblingCrops', () => {
  const general: Crop = { id: 1, name: 'Karotte', crop_species: 10, variety: '' };
  const nantaise: Crop = { id: 2, name: 'Karotte', crop_species: 10, variety: 'Nantaise' };
  const rodelika: Crop = { id: 3, name: 'Karotte', crop_species: 10, variety: 'Rodelika' };
  const otherCrop: Crop = { id: 4, name: 'Zwiebel', crop_species: 20, variety: '' };
  const allCrops = [general, nantaise, rodelika, otherCrop];

  it('shows every Sorte of a group one of its Sorten matched', () => {
    const result = withGroupSiblingCrops([rodelika], allCrops);

    expect(result).toEqual([general, nantaise, rodelika]);
  });

  it('leaves groups without a match out', () => {
    const result = withGroupSiblingCrops([general], allCrops);

    expect(result).not.toContain(otherCrop);
  });

  it('never widens past the set it is given', () => {
    // The other filters already dropped `nantaise`, so a hit on its group must
    // not bring it back.
    const result = withGroupSiblingCrops([rodelika], [general, rodelika, otherCrop]);

    expect(result).toEqual([general, rodelika]);
  });

  it('returns nothing for an empty match list', () => {
    expect(withGroupSiblingCrops([], allCrops)).toEqual([]);
  });
});
