import { describe, expect, it } from 'vitest';

import type { Bed, Field, Location } from '../api/types';
import { ALL_BEDS, buildBedPickerOptions, isBedInScope } from '../components/planting-plans/bedPickerOptions';

const locations: Location[] = [{ id: 1, name: 'Hof' }, { id: 2, name: 'Acker' }];
const fields: Field[] = [
  { id: 10, name: 'Feld 2', location: 1 },
  { id: 11, name: 'Feld 10', location: 1 },
  { id: 20, name: 'Nord', location: 2 },
];
const beds: Bed[] = [
  { id: 100, name: 'Beet 10', field: 10, area_sqm: 5 },
  { id: 101, name: 'Beet 2', field: 10 },
  { id: 102, name: 'Beet 1', field: 11 },
  { id: 103, name: 'Beet 1', field: 20 },
  { id: 104, name: 'Orphan', field: 99 },
  { name: 'No id', field: 10 },
];

describe('buildBedPickerOptions', () => {
  const options = buildBedPickerOptions(beds, fields, locations, 'de');

  it('sorts by location, field and bed with natural numeric order', () => {
    expect(options.map((option) => option.id)).toEqual([103, 101, 100, 102]);
  });

  it('drops beds without id or without a resolvable field', () => {
    expect(options.map((option) => option.id)).not.toContain(104);
    expect(options).toHaveLength(4);
  });

  it('keeps a missing area as null and indexes the full path for search', () => {
    expect(options.find((option) => option.id === 101)?.areaSqm).toBeNull();
    expect(options.find((option) => option.id === 100)?.searchText).toContain('hof');
  });
});

describe('isBedInScope', () => {
  const [option] = buildBedPickerOptions(beds, fields, locations, 'de');

  it('matches everything for the unscoped picker', () => {
    expect(isBedInScope(option, ALL_BEDS)).toBe(true);
  });

  it('restricts by location and field', () => {
    expect(isBedInScope(option, { locationId: 2, fieldId: null })).toBe(true);
    expect(isBedInScope(option, { locationId: 1, fieldId: null })).toBe(false);
    expect(isBedInScope(option, { locationId: 2, fieldId: 20 })).toBe(true);
    expect(isBedInScope(option, { locationId: 2, fieldId: 11 })).toBe(false);
  });
});
