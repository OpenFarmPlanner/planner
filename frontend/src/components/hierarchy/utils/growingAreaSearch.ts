/**
 * Search and filters of the Growing Areas list (#1075), following the binding
 * rules of docs/search.md: every query term must occur in the record, values
 * within one filter combine with OR, different filters and the search combine
 * with AND. Conditions are matched on their effective (inherited) value, also
 * while their columns are hidden; a match keeps its parent rows visible.
 */
import type { Bed, EffectiveSiteConditions, Field, Location } from '../../../api/types';
import { getPlainExcerpt } from '../../data-grid/markdown';
import { textContainsTerm, tokenizeSearchQuery } from '../../../search/searchText';
import type { IndividualHierarchyRow } from './individualHierarchyRows';
import {
  buildSiteConditionChain,
  INLINE_SITE_CONDITION_FIELDS,
  resolveEffectiveConditions,
  type InlineSiteConditionField,
} from './siteConditions';

/** Filter option for "no value anywhere in the chain" — distinct from e.g. "unavailable". */
export const NOT_SPECIFIED_FILTER_VALUE = 'not_specified';

export type ConditionFilterValue = string;

export interface GrowingAreaFilters {
  locationIds: number[];
  fieldIds: number[];
  light_condition: ConditionFilterValue[];
  soil_moisture: ConditionFilterValue[];
  irrigation: ConditionFilterValue[];
}

export type GrowingAreaFilterGroup = keyof GrowingAreaFilters;

export const EMPTY_GROWING_AREA_FILTERS: GrowingAreaFilters = {
  locationIds: [],
  fieldIds: [],
  light_condition: [],
  soil_moisture: [],
  irrigation: [],
};

export const GROWING_AREA_FILTER_GROUPS: readonly GrowingAreaFilterGroup[] = [
  'locationIds',
  'fieldIds',
  ...INLINE_SITE_CONDITION_FIELDS,
];

export const getActiveGrowingAreaFilterGroups = (filters: GrowingAreaFilters): GrowingAreaFilterGroup[] =>
  GROWING_AREA_FILTER_GROUPS.filter((group) => filters[group].length > 0);

/** Row id of an entity in the hierarchy grid (see `createHierarchyRowsProjector`). */
export type HierarchyRowKey = string | number;
export const locationRowKey = (id: number): string => `location-${id}`;
export const fieldRowKey = (id: number): string => `field-${id}`;

interface SearchRecord {
  rowKey: HierarchyRowKey;
  parentKey: HierarchyRowKey | null;
  locationId: number | undefined;
  fieldId: number | undefined;
  texts: string[];
  conditions: EffectiveSiteConditions;
}

const plainNotes = (notes: string | undefined): string => (notes ? getPlainExcerpt(notes, 10_000) : '');

function buildRecords(locations: Location[], fields: Field[], beds: Bed[]): SearchRecord[] {
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const records: SearchRecord[] = [];

  locations.forEach((location) => {
    if (location.id === undefined) return;
    records.push({
      rowKey: locationRowKey(location.id),
      parentKey: null,
      locationId: location.id,
      fieldId: undefined,
      texts: [location.name, plainNotes(location.notes)],
      conditions: resolveEffectiveConditions(buildSiteConditionChain({ location })),
    });
  });
  fields.forEach((field) => {
    if (field.id === undefined) return;
    const location = locationsById.get(field.location);
    records.push({
      rowKey: fieldRowKey(field.id),
      parentKey: location?.id !== undefined ? locationRowKey(location.id) : null,
      locationId: field.location,
      fieldId: field.id,
      texts: [field.name, location?.name ?? '', plainNotes(field.notes)],
      conditions: resolveEffectiveConditions(buildSiteConditionChain({ field, location })),
    });
  });
  beds.forEach((bed) => {
    if (bed.id === undefined) return;
    const field = fieldsById.get(bed.field);
    const location = field ? locationsById.get(field.location) : undefined;
    records.push({
      rowKey: bed.id,
      parentKey: fieldRowKey(bed.field),
      locationId: field?.location,
      fieldId: bed.field,
      texts: [bed.name, field?.name ?? '', location?.name ?? '', plainNotes(bed.notes)],
      conditions: resolveEffectiveConditions(buildSiteConditionChain({ bed, field, location })),
    });
  });
  return records;
}

const matchesCondition = (
  record: SearchRecord,
  field: InlineSiteConditionField,
  selected: readonly ConditionFilterValue[],
): boolean => {
  if (selected.length === 0) return true;
  const value = record.conditions[field].value ?? NOT_SPECIFIED_FILTER_VALUE;
  return selected.includes(value);
};

function matchesRecord(record: SearchRecord, terms: readonly string[], filters: GrowingAreaFilters): boolean {
  if (filters.locationIds.length > 0
    && (record.locationId === undefined || !filters.locationIds.includes(record.locationId))) {
    return false;
  }
  // A parcel filter matches the parcel and its beds; locations only show as their parents.
  if (filters.fieldIds.length > 0
    && (record.fieldId === undefined || !filters.fieldIds.includes(record.fieldId))) {
    return false;
  }
  if (!INLINE_SITE_CONDITION_FIELDS.every((field) => matchesCondition(record, field, filters[field]))) {
    return false;
  }
  return terms.every((term) => record.texts.some((text) => textContainsTerm(text, term)));
}

export interface GrowingAreaSearchResult {
  isActive: boolean;
  /** Rows that match on their own. */
  matchedRowKeys: Set<HierarchyRowKey>;
  /** Matches plus every parent row, kept for context. */
  visibleRowKeys: Set<HierarchyRowKey>;
  /** Parent rows of a visible row: expanded so the matches can be seen. */
  ancestorRowKeys: Set<HierarchyRowKey>;
  matchCount: number;
  totalCount: number;
}

export function searchGrowingAreas(
  entities: { locations: Location[]; fields: Field[]; beds: Bed[]; individualRows?: readonly IndividualHierarchyRow[] },
  query: string,
  filters: GrowingAreaFilters,
): GrowingAreaSearchResult {
  const records = buildRecords(entities.locations, entities.fields, entities.beds);
  if (entities.individualRows?.length) {
    const areas = new Map(records.map(record => [record.rowKey, record]));
    for (const row of entities.individualRows) {
      const parent = areas.get(row.parentId);
      if (parent) records.push({ ...parent, rowKey: row.id, parentKey: parent.rowKey, texts: [row.name, ...parent.texts] });
    }
  }
  const terms = tokenizeSearchQuery(query);
  const isActive = terms.length > 0 || getActiveGrowingAreaFilterGroups(filters).length > 0;
  const matchedRowKeys = new Set<HierarchyRowKey>();
  const visibleRowKeys = new Set<HierarchyRowKey>();
  const ancestorRowKeys = new Set<HierarchyRowKey>();
  if (!isActive) {
    return {
      isActive, matchedRowKeys, visibleRowKeys, ancestorRowKeys, matchCount: records.length, totalCount: records.length,
    };
  }

  const parentByKey = new Map(records.map((record) => [record.rowKey, record.parentKey]));
  records.forEach((record) => {
    if (!matchesRecord(record, terms, filters)) return;
    matchedRowKeys.add(record.rowKey);
    visibleRowKeys.add(record.rowKey);
    let key: HierarchyRowKey | null | undefined = record.parentKey;
    while (key !== null && key !== undefined && !ancestorRowKeys.has(key)) {
      ancestorRowKeys.add(key);
      visibleRowKeys.add(key);
      key = parentByKey.get(key);
    }
  });
  return {
    isActive, matchedRowKeys, visibleRowKeys, ancestorRowKeys,
    matchCount: matchedRowKeys.size, totalCount: records.length,
  };
}

/** Drops parcels of deselected locations from the parcel selection (docs/search.md). */
export function withLocationSelection(
  filters: GrowingAreaFilters,
  locationIds: number[],
  fields: readonly Field[],
): GrowingAreaFilters {
  if (locationIds.length === 0) {
    return { ...filters, locationIds };
  }
  const allowed = new Set(fields.filter((field) => locationIds.includes(field.location)).map((field) => field.id));
  return { ...filters, locationIds, fieldIds: filters.fieldIds.filter((id) => allowed.has(id)) };
}

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'number');
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/** Restores stored filters, falling back to empty ones for malformed data. */
export function parseGrowingAreaFilters(value: unknown): GrowingAreaFilters {
  if (!value || typeof value !== 'object') return EMPTY_GROWING_AREA_FILTERS;
  const raw = value as Record<string, unknown>;
  return {
    locationIds: isNumberArray(raw.locationIds) ? raw.locationIds : [],
    fieldIds: isNumberArray(raw.fieldIds) ? raw.fieldIds : [],
    light_condition: isStringArray(raw.light_condition) ? raw.light_condition : [],
    soil_moisture: isStringArray(raw.soil_moisture) ? raw.soil_moisture : [],
    irrigation: isStringArray(raw.irrigation) ? raw.irrigation : [],
  };
}
