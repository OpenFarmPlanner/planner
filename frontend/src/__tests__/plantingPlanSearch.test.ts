import { describe, expect, it } from 'vitest';

import {
  EMPTY_PLANTING_PLAN_FILTERS,
  clearPlantingPlanFilterGroup,
  comparePlantingPlanRecords,
  createPlantingPlanSearchRecord,
  derivePlantingPlanFilterOptions,
  getActivePlantingPlanFilterGroups,
  buildDateSearchTexts,
  isMonthInPeriod,
  matchPlantingPlan,
  withLocationSelection,
  withMonthRange,
  type DateFilterField,
  type PlantingPlanFilters,
  type PlantingPlanSearchRecord,
  type PlantingPlanSearchRecordInput,
  type PlantingPlanSortKey,
} from '../pages/plantingPlanSearch';
import { tokenizeSearchQuery } from '../search/searchText';

const HOFGARTEN = 1;
const BACHACKER = 2;
const NORD = 10;
const SUED = 11;
const OST = 20;

const makeRecord = (overrides: Partial<PlantingPlanSearchRecordInput> & { id: number }): PlantingPlanSearchRecord =>
  createPlantingPlanSearchRecord({
    cropLabel: 'Tomate (Ruthje)',
    cropName: 'Tomate',
    cropSynonyms: ['Tomate', 'Tomato', 'Paradeiser', 'Solanum lycopersicum'],
    cultivationType: 'pre_cultivation',
    cultivationTypeLabel: 'Pflanzung',
    locationId: HOFGARTEN,
    locationName: 'Hofgarten',
    fieldId: NORD,
    fieldName: 'Nordfeld',
    bedName: 'Beet 1',
    notesText: '',
    plantingDate: '2026-04-15',
    sowingDate: null,
    harvestDate: '2026-07-01',
    harvestEndDate: '2026-08-15',
    ...overrides,
  });

const tomato = makeRecord({ id: 1, sowingDate: '2026-02-18' });
const beet = makeRecord({
  id: 2,
  cropLabel: 'Rote Rübe',
  cropName: 'Rote Rübe',
  cropSynonyms: ['Rote Bete', 'Randen'],
  cultivationType: 'direct_sowing',
  cultivationTypeLabel: 'Direktsaat',
  fieldId: SUED,
  fieldName: 'Südfeld',
  bedName: 'Großbeet',
  notesText: 'Mit Vlies abdecken',
  plantingDate: '2026-05-02',
  harvestDate: '2026-08-10',
  harvestEndDate: '2026-09-20',
});
const carrot = makeRecord({
  id: 3,
  cropLabel: 'Karotte (Nantaise)',
  cropName: 'Karotte',
  cropSynonyms: ['Möhre', 'Rüebli'],
  cultivationType: 'direct_sowing',
  cultivationTypeLabel: 'Direktsaat',
  locationId: BACHACKER,
  locationName: 'Bachacker',
  fieldId: OST,
  fieldName: 'Nordfeld',
  bedName: 'Beet 3',
  notesText: 'Früh säen',
  plantingDate: '2026-03-20',
  harvestDate: null,
  harvestEndDate: null,
});
const undated = makeRecord({
  id: 4,
  cropLabel: 'Tomate (Rondo)',
  plantingDate: null,
  harvestDate: null,
  harvestEndDate: null,
});
const all = [tomato, beet, carrot, undated];

const search = (query: string, filters: PlantingPlanFilters = EMPTY_PLANTING_PLAN_FILTERS): number[] => {
  const terms = tokenizeSearchQuery(query);
  return all.filter((record) => matchPlantingPlan(record, terms, filters).matches).map((record) => record.id);
};

const filtered = (filters: Partial<PlantingPlanFilters>): number[] =>
  search('', { ...EMPTY_PLANTING_PLAN_FILTERS, ...filters });

const filteredByMonths = (field: DateFilterField, from: number | null, to: number | null): number[] =>
  search('', withMonthRange(EMPTY_PLANTING_PLAN_FILTERS, field, { from, to }));

describe('planting plan search', () => {
  it('ignores case, diacritics and ß vs ss', () => {
    expect(search('rube')).toEqual([2]);
    expect(search('RÜBE')).toEqual([2]);
    expect(search('grossbeet')).toEqual([2]);
    expect(search('südfeld')).toEqual([2]);
  });

  it('requires every word to match somewhere in the row', () => {
    expect(search('tomate hofgarten')).toEqual([1, 4]);
    expect(search('tomate ruthje')).toEqual([1]);
    expect(search('tomate bachacker')).toEqual([]);
    expect(search('direktsaat nordfeld')).toEqual([3]);
  });

  it('matches in the middle of a word', () => {
    expect(search('rott')).toEqual([3]);
  });

  it('searches Kultur, Sorte, Anbauart, Standort, Parzelle and Beet', () => {
    expect(search('nantaise')).toEqual([3]);
    expect(search('pflanzung')).toEqual([1, 4]);
    expect(search('bachacker')).toEqual([3]);
    expect(search('beet 3')).toEqual([3]);
  });

  it('searches planting, harvest start and harvest end dates in d.M.yyyy, dd.MM.yyyy and ISO form', () => {
    expect(search('15.4.2026')).toEqual([1]);
    expect(search('15.04.')).toEqual([1]);
    expect(search('2026-04-15')).toEqual([1]);
    expect(search('10.8')).toEqual([2]);
    expect(search('20.09.2026')).toEqual([2]);
    expect(search('2026')).toEqual([1, 2, 3]);
  });

  it('searches the derived sowing date the same way, when it is computable', () => {
    expect(search('18.2.2026')).toEqual([1]);
    expect(search('2026-02-18')).toEqual([1]);
    // Direct sowing (Rote Rübe, Karotte) has no distinct sowing date in this
    // fixture set, so this never matches a row via `sowingDate` alone.
    expect(search('2026-05-02')).toEqual([2]);
  });

  it('combines a date term with other terms', () => {
    expect(search('tomate 1.7.')).toEqual([1]);
    expect(search('karotte 1.7.')).toEqual([]);
  });

  it('finds a crop through a species synonym and reports it', () => {
    expect(search('paradeiser')).toEqual([1, 4]);
    expect(matchPlantingPlan(tomato, ['paradeiser'], EMPTY_PLANTING_PLAN_FILTERS)).toEqual({
      matches: true,
      synonym: 'Paradeiser',
      notesMatched: false,
    });
    expect(search('mohre')).toEqual([3]);
  });

  it('does not report the visible crop name as a synonym hit', () => {
    expect(matchPlantingPlan(tomato, ['tomat'], EMPTY_PLANTING_PLAN_FILTERS).synonym).toBeNull();
  });

  it('matches plans only through their notes and flags the notes hit', () => {
    expect(search('vlies')).toEqual([2]);
    expect(matchPlantingPlan(beet, ['vlies'], EMPTY_PLANTING_PLAN_FILTERS)).toEqual({
      matches: true,
      synonym: null,
      notesMatched: true,
    });
    expect(search('saen')).toEqual([3]);
  });

  it('combines a notes hit and a visible hit with AND', () => {
    expect(search('vlies rube')).toEqual([2]);
    expect(search('vlies karotte')).toEqual([]);
  });
});

describe('planting plan filters', () => {
  it('ORs values within a filter', () => {
    expect(filtered({ locationIds: [HOFGARTEN, BACHACKER] })).toEqual([1, 2, 3, 4]);
    expect(filtered({ cropKeys: ['tomate', 'karotte'] })).toEqual([1, 3, 4]);
  });

  it('ANDs different filters', () => {
    expect(filtered({ locationIds: [HOFGARTEN], cultivationTypes: ['direct_sowing'] })).toEqual([2]);
    expect(filtered({ locationIds: [BACHACKER], cropKeys: ['tomate'] })).toEqual([]);
  });

  it('ANDs search and filters', () => {
    expect(search('nordfeld', { ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [BACHACKER] })).toEqual([3]);
  });

  it('filters by the planting period and drops plans without a planting date', () => {
    expect(filteredByMonths('plantingDate', 4, 5)).toEqual([1, 2]);
    expect(filteredByMonths('plantingDate', 5, null)).toEqual([2]);
    expect(filteredByMonths('plantingDate', null, 3)).toEqual([3]);
  });

  it('filters by harvest start and harvest end months', () => {
    expect(filteredByMonths('harvestStartDate', 7, 7)).toEqual([1]);
    expect(filteredByMonths('harvestStartDate', 8, null)).toEqual([2]);
    expect(filteredByMonths('harvestEndDate', 9, null)).toEqual([2]);
    expect(filteredByMonths('harvestEndDate', null, 8)).toEqual([1]);
  });

  it('ANDs several month ranges', () => {
    const filters = withMonthRange(
      withMonthRange(EMPTY_PLANTING_PLAN_FILTERS, 'plantingDate', { from: 4, to: 5 }),
      'harvestStartDate',
      { from: 8, to: null },
    );
    expect(search('', filters)).toEqual([2]);
  });

  it('wraps a planting period across the year end', () => {
    expect(isMonthInPeriod(12, 11, 2)).toBe(true);
    expect(isMonthInPeriod(1, 11, 2)).toBe(true);
    expect(isMonthInPeriod(6, 11, 2)).toBe(false);
  });

  it('counts and clears active filter groups', () => {
    const filters: PlantingPlanFilters = {
      ...EMPTY_PLANTING_PLAN_FILTERS,
      locationIds: [HOFGARTEN],
      cropKeys: ['tomate'],
      monthRanges: {
        ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges,
        plantingDate: { from: null, to: 6 },
        harvestEndDate: { from: 9, to: 10 },
      },
    };
    expect(getActivePlantingPlanFilterGroups(filters)).toEqual(['location', 'crop', 'plantingDate', 'harvestEndDate']);
    expect(getActivePlantingPlanFilterGroups(clearPlantingPlanFilterGroup(filters, 'plantingDate'))).toEqual([
      'location',
      'crop',
      'harvestEndDate',
    ]);
  });
});

describe('planting plan filter options', () => {
  it('derives the options from the plans', () => {
    const options = derivePlantingPlanFilterOptions(all, []);
    expect(options.locations.map((option) => option.label)).toEqual(['Bachacker', 'Hofgarten']);
    expect(options.crops).toEqual([
      { value: 'karotte', label: 'Karotte' },
      { value: 'rote rube', label: 'Rote Rübe' },
      { value: 'tomate', label: 'Tomate' },
    ]);
    expect(options.cultivationTypes.map((option) => option.value)).toEqual(['direct_sowing', 'pre_cultivation']);
  });

  it('names the Standort of Parzellen that share a name', () => {
    const options = derivePlantingPlanFilterOptions(all, []);
    expect(options.fields.map((option) => option.label)).toEqual([
      'Nordfeld (Bachacker)',
      'Nordfeld (Hofgarten)',
      'Südfeld',
    ]);
  });

  it('offers only the Parzellen of the selected Standorte', () => {
    const options = derivePlantingPlanFilterOptions(all, [HOFGARTEN]);
    expect(options.fields.map((option) => option.value)).toEqual([NORD, SUED]);
    expect(options.fields.map((option) => option.label)).toEqual(['Nordfeld', 'Südfeld']);
  });

  it('drops selected Parzellen when their Standort is deselected', () => {
    const fieldLocationById = new Map<number, number | null>([[NORD, HOFGARTEN], [SUED, HOFGARTEN], [OST, BACHACKER]]);
    const filters: PlantingPlanFilters = {
      ...EMPTY_PLANTING_PLAN_FILTERS,
      locationIds: [HOFGARTEN, BACHACKER],
      fieldIds: [NORD, OST],
    };
    expect(withLocationSelection(filters, [BACHACKER], fieldLocationById)).toMatchObject({
      locationIds: [BACHACKER],
      fieldIds: [OST],
    });
    expect(withLocationSelection(filters, [], fieldLocationById)).toMatchObject({
      locationIds: [],
      fieldIds: [NORD, OST],
    });
  });
});

describe('planting plan sorting', () => {
  const sorted = (sortKey: PlantingPlanSortKey): number[] =>
    [...all].sort((left, right) => comparePlantingPlanRecords(left, right, sortKey)).map((record) => record.id);

  it('sorts by planting date ascending with undated plans last', () => {
    expect(sorted('plantingDateAsc')).toEqual([3, 1, 2, 4]);
  });

  it('sorts by planting date descending with undated plans last', () => {
    expect(sorted('plantingDateDesc')).toEqual([2, 1, 3, 4]);
  });

  it('sorts by crop from A to Z', () => {
    expect(sorted('cropAsc')).toEqual([3, 2, 4, 1]);
  });

  it('sorts by harvest start ascending with missing harvest dates last', () => {
    expect(sorted('harvestStartAsc')).toEqual([1, 2, 3, 4]);
  });
});

describe('buildDateSearchTexts', () => {
  it('builds the displayed, zero-padded and ISO forms', () => {
    expect(buildDateSearchTexts('2026-02-08')).toEqual(['8.2.2026', '08.02.2026', '2026-02-08']);
  });

  it('returns nothing for a missing or malformed date', () => {
    expect(buildDateSearchTexts(null)).toEqual([]);
    expect(buildDateSearchTexts('soon')).toEqual([]);
  });
});
