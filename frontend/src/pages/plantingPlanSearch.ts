/**
 * Search, filter and sort rules for the planting-plan page. The desktop grid
 * and the mobile card list both go through these functions (via
 * `usePlantingPlanSearch`), so the same input always yields the same hits.
 * The rules are specified in `docs/search.md`.
 */
import { normalizeSearchText } from '../search/searchText';

export const PLANTING_PLAN_SORT_KEYS = [
  'plantingDateAsc',
  'plantingDateDesc',
  'cropAsc',
  'harvestStartAsc',
] as const;

export type PlantingPlanSortKey = (typeof PLANTING_PLAN_SORT_KEYS)[number];

/** Matches the desktop grid's default sort (planting date, ascending). */
export const DEFAULT_PLANTING_PLAN_SORT: PlantingPlanSortKey = 'plantingDateAsc';

/** The plan dates that can be filtered by month. */
export const DATE_FILTER_FIELDS = ['plantingDate', 'harvestStartDate', 'harvestEndDate'] as const;

export type DateFilterField = (typeof DATE_FILTER_FIELDS)[number];

/** Months 1–12; `null` leaves that end of the range open. */
export interface MonthRange {
  from: number | null;
  to: number | null;
}

const OPEN_MONTH_RANGE: MonthRange = { from: null, to: null };

export interface PlantingPlanFilters {
  locationIds: number[];
  fieldIds: number[];
  cultivationTypes: string[];
  /** Normalized Kultur names, so every Sorte of a Kultur is covered. */
  cropKeys: string[];
  monthRanges: Record<DateFilterField, MonthRange>;
}

export const EMPTY_PLANTING_PLAN_FILTERS: PlantingPlanFilters = {
  locationIds: [],
  fieldIds: [],
  cultivationTypes: [],
  cropKeys: [],
  monthRanges: {
    plantingDate: OPEN_MONTH_RANGE,
    harvestStartDate: OPEN_MONTH_RANGE,
    harvestEndDate: OPEN_MONTH_RANGE,
  },
};

export type PlantingPlanFilterGroup = 'location' | 'field' | 'cultivationType' | 'crop' | DateFilterField;

export const isMonthRangeActive = (range: MonthRange): boolean => range.from !== null || range.to !== null;

export function withMonthRange(
  filters: PlantingPlanFilters,
  field: DateFilterField,
  range: MonthRange,
): PlantingPlanFilters {
  return { ...filters, monthRanges: { ...filters.monthRanges, [field]: range } };
}

/** The display texts and filter keys of one plan, resolved by the page. */
export interface PlantingPlanSearchRecordInput {
  id: number;
  /** Visible crop label, "Kultur (Sorte)". */
  cropLabel: string;
  /** Kultur name without the Sorte; the crop filter groups by it. */
  cropName: string;
  /** Names of the linked crop species (translations, synonyms, regional names). */
  cropSynonyms: readonly string[];
  cultivationType: string;
  cultivationTypeLabel: string;
  locationId: number | null;
  locationName: string;
  fieldId: number | null;
  fieldName: string;
  bedName: string;
  /** Plain notes text (markdown stripped). */
  notesText: string;
  /** ISO `YYYY-MM-DD` or null. */
  plantingDate: string | null;
  harvestDate: string | null;
  harvestEndDate: string | null;
}

export interface PlantingPlanSearchRecord extends PlantingPlanSearchRecordInput {
  cropKey: string;
  normalizedVisibleTexts: string[];
  normalizedNotes: string;
  normalizedSynonyms: Array<{ name: string; normalized: string }>;
}

export interface PlantingPlanMatch {
  matches: boolean;
  /** The species name a query term only matched through, if any. */
  synonym: string | null;
  notesMatched: boolean;
}

/**
 * The forms a date can be searched in: the displayed `d.M.yyyy`, the
 * zero-padded `dd.MM.yyyy` and ISO `yyyy-MM-dd`, so "18.2.", "18.02." and
 * "2026-02" all find 18 February 2026.
 */
export function buildDateSearchTexts(isoDate: string | null): string[] {
  const match = isoDate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate) : null;
  if (!match) {
    return [];
  }
  const [, year, month, day] = match;
  return [
    `${Number(day)}.${Number(month)}.${year}`,
    `${day}.${month}.${year}`,
    `${year}-${month}-${day}`,
  ];
}

const NO_MATCH: PlantingPlanMatch = { matches: false, synonym: null, notesMatched: false };
const PLAIN_MATCH: PlantingPlanMatch = { matches: true, synonym: null, notesMatched: false };

export function createPlantingPlanSearchRecord(input: PlantingPlanSearchRecordInput): PlantingPlanSearchRecord {
  const cropKey = normalizeSearchText(input.cropName.trim());
  const normalizedCropLabel = normalizeSearchText(input.cropLabel);
  const seenSynonyms = new Set<string>();
  const normalizedSynonyms: Array<{ name: string; normalized: string }> = [];
  for (const name of input.cropSynonyms) {
    const normalized = normalizeSearchText(name);
    // A species name the crop is already shown under is not a synonym hit.
    if (!normalized || normalized === cropKey || normalized === normalizedCropLabel || seenSynonyms.has(normalized)) {
      continue;
    }
    seenSynonyms.add(normalized);
    normalizedSynonyms.push({ name, normalized });
  }
  return {
    ...input,
    cropKey,
    normalizedVisibleTexts: [
      input.cropLabel,
      input.cultivationTypeLabel,
      input.locationName,
      input.fieldName,
      input.bedName,
      ...buildDateSearchTexts(input.plantingDate),
      ...buildDateSearchTexts(input.harvestDate),
      ...buildDateSearchTexts(input.harvestEndDate),
    ]
      .filter((text) => text.length > 0)
      .map(normalizeSearchText),
    normalizedNotes: normalizeSearchText(input.notesText),
    normalizedSynonyms,
  };
}

const getMonth = (isoDate: string | null): number | null => {
  const month = isoDate ? Number(isoDate.slice(5, 7)) : NaN;
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
};

/** Whether `month` lies in the period; a period with from > to wraps the year end. */
export function isMonthInPeriod(month: number, from: number | null, to: number | null): boolean {
  if (from !== null && to !== null) {
    return from <= to ? month >= from && month <= to : month >= from || month <= to;
  }
  if (from !== null) {
    return month >= from;
  }
  if (to !== null) {
    return month <= to;
  }
  return true;
}

const DATE_FIELD_TO_RECORD_KEY = {
  plantingDate: 'plantingDate',
  harvestStartDate: 'harvestDate',
  harvestEndDate: 'harvestEndDate',
} as const satisfies Record<DateFilterField, keyof PlantingPlanSearchRecordInput>;

const matchesMonthRange = (isoDate: string | null, range: MonthRange): boolean => {
  if (!isMonthRangeActive(range)) {
    return true;
  }
  const month = getMonth(isoDate);
  return month !== null && isMonthInPeriod(month, range.from, range.to);
};

const includesIfSelected = <T,>(selected: readonly T[], value: T | null): boolean =>
  selected.length === 0 || (value !== null && selected.includes(value));

/** Filters combine with AND; the values selected within one filter with OR. */
export function matchesPlantingPlanFilters(record: PlantingPlanSearchRecord, filters: PlantingPlanFilters): boolean {
  if (!includesIfSelected(filters.locationIds, record.locationId)) return false;
  if (!includesIfSelected(filters.fieldIds, record.fieldId)) return false;
  if (!includesIfSelected(filters.cultivationTypes, record.cultivationType || null)) return false;
  if (!includesIfSelected(filters.cropKeys, record.cropKey || null)) return false;
  return DATE_FILTER_FIELDS.every((field) => (
    matchesMonthRange(record[DATE_FIELD_TO_RECORD_KEY[field]], filters.monthRanges[field])
  ));
}

/**
 * Every term has to occur somewhere in the record (AND): in a visible text,
 * in the notes, or in a species name of the crop.
 */
export function matchPlantingPlanSearch(record: PlantingPlanSearchRecord, terms: readonly string[]): PlantingPlanMatch {
  if (terms.length === 0) {
    return PLAIN_MATCH;
  }
  let synonym: string | null = null;
  let notesMatched = false;
  for (const term of terms) {
    const visibleHit = record.normalizedVisibleTexts.some((text) => text.includes(term));
    const notesHit = record.normalizedNotes.includes(term);
    notesMatched ||= notesHit;
    if (visibleHit || notesHit) {
      continue;
    }
    const synonymHit = record.normalizedSynonyms.find((entry) => entry.normalized.includes(term));
    if (!synonymHit) {
      return NO_MATCH;
    }
    synonym ??= synonymHit.name;
  }
  return { matches: true, synonym, notesMatched };
}

export function matchPlantingPlan(
  record: PlantingPlanSearchRecord,
  terms: readonly string[],
  filters: PlantingPlanFilters,
): PlantingPlanMatch {
  return matchesPlantingPlanFilters(record, filters) ? matchPlantingPlanSearch(record, terms) : NO_MATCH;
}

export function getActivePlantingPlanFilterGroups(filters: PlantingPlanFilters): PlantingPlanFilterGroup[] {
  const groups: PlantingPlanFilterGroup[] = [];
  if (filters.locationIds.length > 0) groups.push('location');
  if (filters.fieldIds.length > 0) groups.push('field');
  if (filters.cultivationTypes.length > 0) groups.push('cultivationType');
  if (filters.cropKeys.length > 0) groups.push('crop');
  for (const field of DATE_FILTER_FIELDS) {
    if (isMonthRangeActive(filters.monthRanges[field])) groups.push(field);
  }
  return groups;
}

export function clearPlantingPlanFilterGroup(
  filters: PlantingPlanFilters,
  group: PlantingPlanFilterGroup,
): PlantingPlanFilters {
  switch (group) {
    case 'location':
      return { ...filters, locationIds: [] };
    case 'field':
      return { ...filters, fieldIds: [] };
    case 'cultivationType':
      return { ...filters, cultivationTypes: [] };
    case 'crop':
      return { ...filters, cropKeys: [] };
    default:
      return withMonthRange(filters, group, OPEN_MONTH_RANGE);
  }
}

export interface FilterOption<T extends string | number> {
  value: T;
  label: string;
}

export interface FieldFilterOption extends FilterOption<number> {
  locationId: number | null;
}

export interface PlantingPlanFilterOptions {
  locations: FilterOption<number>[];
  fields: FieldFilterOption[];
  cultivationTypes: FilterOption<string>[];
  crops: FilterOption<string>[];
}

const byLabel = (left: { label: string }, right: { label: string }): number =>
  left.label.localeCompare(right.label, 'de', { sensitivity: 'base' });

/**
 * Filter options come from the plans themselves (the current season), so a
 * filter never offers a value that cannot match anything. Parzellen are
 * narrowed to the selected Standorte.
 */
export function derivePlantingPlanFilterOptions(
  records: readonly PlantingPlanSearchRecord[],
  selectedLocationIds: readonly number[],
): PlantingPlanFilterOptions {
  const locations = new Map<number, FilterOption<number>>();
  const fields = new Map<number, FieldFilterOption & { locationName: string }>();
  const cultivationTypes = new Map<string, FilterOption<string>>();
  const crops = new Map<string, FilterOption<string>>();

  for (const record of records) {
    if (record.locationId !== null && record.locationName) {
      locations.set(record.locationId, { value: record.locationId, label: record.locationName });
    }
    if (record.fieldId !== null && record.fieldName) {
      fields.set(record.fieldId, {
        value: record.fieldId,
        label: record.fieldName,
        locationId: record.locationId,
        locationName: record.locationName,
      });
    }
    if (record.cultivationType && record.cultivationTypeLabel) {
      cultivationTypes.set(record.cultivationType, { value: record.cultivationType, label: record.cultivationTypeLabel });
    }
    if (record.cropKey && !crops.has(record.cropKey)) {
      crops.set(record.cropKey, { value: record.cropKey, label: record.cropName.trim() });
    }
  }

  const visibleFields = Array.from(fields.values()).filter((field) => (
    selectedLocationIds.length === 0
    || (field.locationId !== null && selectedLocationIds.includes(field.locationId))
  ));
  const fieldNameCounts = new Map<string, number>();
  for (const field of visibleFields) {
    fieldNameCounts.set(field.label, (fieldNameCounts.get(field.label) ?? 0) + 1);
  }

  return {
    locations: Array.from(locations.values()).sort(byLabel),
    fields: visibleFields
      .map(({ locationName, ...field }) => ({
        ...field,
        // Same Parzelle name at two Standorte: say which one is meant.
        label: (fieldNameCounts.get(field.label) ?? 0) > 1 && locationName
          ? `${field.label} (${locationName})`
          : field.label,
      }))
      .sort(byLabel),
    cultivationTypes: Array.from(cultivationTypes.values()).sort(byLabel),
    crops: Array.from(crops.values()).sort(byLabel),
  };
}

/**
 * Applies a new Standort selection and drops every selected Parzelle that no
 * longer belongs to one of the selected Standorte.
 */
export function withLocationSelection(
  filters: PlantingPlanFilters,
  locationIds: number[],
  fieldLocationById: ReadonlyMap<number, number | null>,
): PlantingPlanFilters {
  const fieldIds = locationIds.length === 0
    ? filters.fieldIds
    : filters.fieldIds.filter((fieldId) => {
      const locationId = fieldLocationById.get(fieldId);
      return locationId !== undefined && locationId !== null && locationIds.includes(locationId);
    });
  return { ...filters, locationIds, fieldIds };
}

const compareNullableDates = (left: string | null, right: string | null, direction: 1 | -1): number => {
  if (left === right) return 0;
  // Plans without a date sort last in both directions.
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? -direction : direction;
};

const compareCrop = (left: PlantingPlanSearchRecord, right: PlantingPlanSearchRecord): number =>
  left.cropLabel.localeCompare(right.cropLabel, 'de', { sensitivity: 'base' });

export function comparePlantingPlanRecords(
  left: PlantingPlanSearchRecord,
  right: PlantingPlanSearchRecord,
  sortKey: PlantingPlanSortKey,
): number {
  let result: number;
  switch (sortKey) {
    case 'plantingDateAsc':
      result = compareNullableDates(left.plantingDate, right.plantingDate, 1) || compareCrop(left, right);
      break;
    case 'plantingDateDesc':
      result = compareNullableDates(left.plantingDate, right.plantingDate, -1) || compareCrop(left, right);
      break;
    case 'cropAsc':
      result = compareCrop(left, right) || compareNullableDates(left.plantingDate, right.plantingDate, 1);
      break;
    case 'harvestStartAsc':
      result = compareNullableDates(left.harvestDate, right.harvestDate, 1)
        || compareNullableDates(left.plantingDate, right.plantingDate, 1)
        || compareCrop(left, right);
      break;
  }
  return result || left.id - right.id;
}
