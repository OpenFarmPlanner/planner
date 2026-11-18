import { describe, expect, it } from 'vitest';
import type { Bed, Field, Location } from '../api/types';
import {
  EMPTY_GROWING_AREA_FILTERS,
  NOT_SPECIFIED_FILTER_VALUE,
  searchGrowingAreas,
  withLocationSelection,
} from '../components/hierarchy/utils/growingAreaSearch';

const locations: Location[] = [
  { id: 1, name: 'Hofgarten', light_condition: 'sunny', irrigation: 'available' },
  { id: 2, name: 'Bachacker', irrigation: 'unavailable' },
];
const fields: Field[] = [
  { id: 10, name: 'Tunnel', location: 1, soil_moisture: 'dry' },
  { id: 11, name: 'Nord', location: 1 },
  { id: 20, name: 'Wurzel', location: 2 },
];
const beds: Bed[] = [
  { id: 100, name: 'Tomate', field: 10 },
  { id: 101, name: 'Kräuter', field: 10, light_condition: 'partial_shade' },
  { id: 110, name: 'Kohl', field: 11, notes: '**steinig**' },
  { id: 200, name: 'Karotte', field: 20 },
];
const entities = { locations, fields, beds };

describe('searchGrowingAreas', () => {
  it('is inactive without query and filters', () => {
    const result = searchGrowingAreas(entities, '  ', EMPTY_GROWING_AREA_FILTERS);
    expect(result.isActive).toBe(false);
    expect(result.totalCount).toBe(9);
  });

  it('matches inherited values and keeps the parent rows', () => {
    const result = searchGrowingAreas(entities, '', { ...EMPTY_GROWING_AREA_FILTERS, light_condition: ['sunny'] });
    // Tomate and Kohl inherit "sunny" from the location; Kräuter overrides it.
    expect(result.matchedRowKeys).toEqual(new Set(['location-1', 'field-10', 'field-11', 100, 110]));
    expect(result.visibleRowKeys.has(101)).toBe(false);
    expect(result.ancestorRowKeys).toEqual(new Set(['location-1', 'field-10', 'field-11']));
  });

  it('keeps not specified distinct from not available', () => {
    const unavailable = searchGrowingAreas(entities, '', { ...EMPTY_GROWING_AREA_FILTERS, irrigation: ['unavailable'] });
    expect(unavailable.matchedRowKeys).toEqual(new Set(['location-2', 'field-20', 200]));
    const notSpecified = searchGrowingAreas(entities, '', {
      ...EMPTY_GROWING_AREA_FILTERS, light_condition: [NOT_SPECIFIED_FILTER_VALUE],
    });
    expect(notSpecified.matchedRowKeys).toEqual(new Set(['location-2', 'field-20', 200]));
  });

  it('combines values with OR inside a filter and filters with AND', () => {
    const result = searchGrowingAreas(entities, '', {
      ...EMPTY_GROWING_AREA_FILTERS,
      light_condition: ['sunny', 'partial_shade'],
      soil_moisture: ['dry'],
    });
    expect(result.matchedRowKeys).toEqual(new Set(['field-10', 100, 101]));
  });

  it('combines the search with the filters and searches parent names and notes', () => {
    expect(searchGrowingAreas(entities, 'hofgarten tom', EMPTY_GROWING_AREA_FILTERS).matchedRowKeys)
      .toEqual(new Set([100]));
    expect(searchGrowingAreas(entities, 'krauter', EMPTY_GROWING_AREA_FILTERS).matchedRowKeys)
      .toEqual(new Set([101]));
    expect(searchGrowingAreas(entities, 'steinig', EMPTY_GROWING_AREA_FILTERS).matchedRowKeys)
      .toEqual(new Set([110]));
    expect(searchGrowingAreas(entities, 'tomate', { ...EMPTY_GROWING_AREA_FILTERS, fieldIds: [11] }).matchCount)
      .toBe(0);
  });

  it('matches a parcel filter on the parcel and its beds only', () => {
    const result = searchGrowingAreas(entities, '', { ...EMPTY_GROWING_AREA_FILTERS, fieldIds: [11] });
    expect(result.matchedRowKeys).toEqual(new Set(['field-11', 110]));
    expect(result.visibleRowKeys).toEqual(new Set(['location-1', 'field-11', 110]));
  });
});

describe('withLocationSelection', () => {
  it('drops parcels of deselected locations', () => {
    const filters = { ...EMPTY_GROWING_AREA_FILTERS, locationIds: [1, 2], fieldIds: [10, 20] };
    expect(withLocationSelection(filters, [2], fields).fieldIds).toEqual([20]);
  });
});
