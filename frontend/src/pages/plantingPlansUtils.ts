import type { Bed, Crop, CultivationType, Field, PlanCultivationType, PlantingPlan } from '../api/types';
import type { EditableRow } from '../components/data-grid/types';
import { getEffectiveCropValue } from '../crops/varietyValueSource';
import { formatLocalizedNumber, parseLocalizedNumber } from '../utils/numberLocalization';

export const AREA_LABEL_SEPARATOR = ' | ';

/**
 * Upper bounds for the two flexible planting-plan grid columns. The hierarchy
 * hook sizes the columns to their content and the grid caps them here, so both
 * have to agree on the same number.
 */
export const CROP_COLUMN_MAX_WIDTH = 280;
/**
 * Room the growing-area cell keeps for its crop rotation status icon button,
 * so flagged rows do not lose the bed name to truncation.
 */
export const BED_STATUS_ICON_ALLOWANCE = 32;
export const BED_COLUMN_MAX_WIDTH = 220 + BED_STATUS_ICON_ALLOWANCE;
const UNIT_NON_BREAKING_SPACE = '\u00a0';

export const toNumericValue = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

export const formatAreaM2 = (value: number, locale: string): string =>
  `${formatLocalizedNumber(value, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${UNIT_NON_BREAKING_SPACE}m²`;

export const buildAreaColumnHeaderLabel = (
  includeLocation: boolean,
  locationLabel: string,
  fieldLabel: string,
  bedLabel: string,
): string =>
  includeLocation
    ? `${locationLabel}${AREA_LABEL_SEPARATOR}${fieldLabel}${AREA_LABEL_SEPARATOR}${bedLabel}`
    : `${fieldLabel}${AREA_LABEL_SEPARATOR}${bedLabel}`;

export const buildBedDisplayLabel = (
  locationName: string | null | undefined,
  fieldName: string | null | undefined,
  bedName: string | null | undefined,
  areaSqm: number | null,
  includeLocation: boolean,
  locale: string,
): string => {
  const normalizedLocationName = (locationName ?? '').trim();
  const normalizedBedName = (bedName ?? '').trim();
  const normalizedFieldName = (fieldName ?? '').trim();
  const combinedName = [
    includeLocation ? normalizedLocationName : '',
    normalizedFieldName,
    normalizedBedName,
  ]
    .filter((part) => part.length > 0)
    .join(AREA_LABEL_SEPARATOR);

  if (!combinedName) return '—';
  if (areaSqm === null) return combinedName;
  return `${combinedName} (${formatAreaM2(areaSqm, locale)})`;
};

/**
 * Cultivation types a plan of `crop` may use. The crop restricts direct
 * sowing and transplanting; bought-in plants are a way of transplanting, so
 * they are allowed exactly when transplanting is.
 */
export function getAllowedCultivationTypesForCrop(
  crop?: Crop | null,
): PlanCultivationType[] {
  const cultivationTypes = getEffectiveCropValue(crop, 'cultivation_types');
  const cultivationType = getEffectiveCropValue(crop, 'cultivation_type');
  const cropTypes = (
    cultivationTypes?.length
      ? cultivationTypes
      : cultivationType
        ? [cultivationType]
        : []
  ).filter(
    (value): value is CultivationType =>
      value === 'pre_cultivation' || value === 'direct_sowing',
  );
  const allowedValues: CultivationType[] = cropTypes.length > 0
    ? cropTypes
    : ['direct_sowing', 'pre_cultivation'];

  return allowedValues.includes('pre_cultivation')
    ? [...allowedValues, 'purchased_transplant']
    : allowedValues;
}

export function normalizeCultivationType(
  value: unknown,
): PlanCultivationType | undefined {
  if (value === 'pre_cultivation' || value === 'direct_sowing' || value === 'purchased_transplant') {
    return value;
  }
  return undefined;
}

export function resolveCultivationTypeForAllowedOptions(
  allowedTypes: PlanCultivationType[],
  currentValue?: unknown,
): PlanCultivationType | '' {
  const normalizedCurrent = normalizeCultivationType(currentValue);
  if (normalizedCurrent && allowedTypes.includes(normalizedCurrent)) {
    return normalizedCurrent;
  }
  if (allowedTypes.length === 1) {
    return allowedTypes[0];
  }
  return '';
}


// ---------------------------------------------------------------------------
// Row/selection helpers extracted verbatim from pages/PlantingPlans.tsx
// ---------------------------------------------------------------------------

export interface PlantingPlanRow extends PlantingPlan, EditableRow {
  id: number;
  isNew?: boolean;
  location_id?: number;
  field_id?: number;
  area_m2?: number;
  plants_count?: number | null; // UI-only derived field
  note_attachment_count?: number;
}

export interface MobileCreateFormState {
  crop: string;
  bed: string;
  cultivation_type: PlanCultivationType | "";
  /** Derived from `planting_date`; German-formatted, like `planting_date`. */
  sowing_date: string;
  planting_date: string;
  area_m2: string;
  plants_count: string;
  notes: string;
}


export const toDateKey = (value: unknown): number | null => {
  const buildDateKey = (year: number, month: number, day: number): number | null => {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date.getTime();
  };
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return buildDateKey(Number(year), Number(month), Number(day));
  }
  const germanMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (germanMatch) {
    const [, day, month, year] = germanMatch;
    return buildDateKey(Number(year), Number(month), Number(day));
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

export const toAreaNumericValue = (value: unknown, locale: string): number | null => {
  const directNumeric = toNumericValue(value);
  if (directNumeric !== null) {
    return directNumeric;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .replace("m²", "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) {
    return null;
  }
  const localized = parseLocalizedNumber(normalized, locale);
  return localized === null ? null : localized;
};

export const isAutoAreaRequest = (value: unknown, maxKeyword: string): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === maxKeyword.trim().toLowerCase() || normalized === "maximum";
};

export const toOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const toOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
};

export interface HierarchySelectionRow {
  location_id?: number;
  field_id?: number;
  bed?: number | string | null;
}

export const normalizeSelectionAfterLocationChange = (
  row: HierarchySelectionRow,
  nextLocationId: number,
  fields: Field[],
  beds: Bed[],
): HierarchySelectionRow => {
  const selectedField =
    typeof row.field_id === "number"
      ? fields.find((field) => field.id === row.field_id)
      : undefined;
  const nextFieldId =
    selectedField && selectedField.location === nextLocationId
      ? selectedField.id
      : undefined;

  const selectedBed =
    typeof row.bed === "number"
      ? beds.find((bed) => bed.id === row.bed)
      : undefined;
  const selectedBedField =
    selectedBed && typeof selectedBed.field === "number"
      ? fields.find((field) => field.id === selectedBed.field)
      : undefined;
  const nextBedId =
    selectedBed &&
    selectedBedField &&
    selectedBedField.location === nextLocationId &&
    (!nextFieldId || selectedBed.field === nextFieldId)
      ? selectedBed.id
      : 0;

  return {
    ...row,
    location_id: nextLocationId,
    field_id: nextFieldId,
    bed: nextBedId,
  };
};

export const normalizeSelectionAfterFieldChange = (
  row: HierarchySelectionRow,
  nextFieldId: number,
  fields: Field[],
  beds: Bed[],
): HierarchySelectionRow => {
  const selectedField = fields.find((field) => field.id === nextFieldId);
  const selectedBed =
    typeof row.bed === "number"
      ? beds.find((bed) => bed.id === row.bed)
      : undefined;
  const nextBedId =
    selectedBed && selectedBed.field === nextFieldId ? selectedBed.id : 0;

  return {
    ...row,
    location_id: selectedField?.location ?? row.location_id,
    field_id: nextFieldId,
    bed: nextBedId,
  };
};

export const normalizeSelectionAfterBedChange = (
  row: HierarchySelectionRow,
  nextBedId: number,
  fields: Field[],
  beds: Bed[],
): HierarchySelectionRow => {
  const selectedBed = beds.find((bed) => bed.id === nextBedId);
  const selectedField = selectedBed
    ? fields.find((field) => field.id === selectedBed.field)
    : undefined;
  return {
    ...row,
    location_id: selectedField?.location ?? row.location_id,
    field_id: selectedBed?.field ?? row.field_id,
    bed: nextBedId,
  };
};


export const resolveBedCellValue = (
  value: unknown,
  row: HierarchySelectionRow,
): number => {
  const cellBedId = toNumericValue(value);
  if (cellBedId !== null) {
    return cellBedId;
  }

  const rowBedId = toNumericValue(row.bed);
  return rowBedId ?? 0;
};

export const createEmptyMobileCreateForm = (): MobileCreateFormState => ({
  crop: "",
  bed: "",
  cultivation_type: "",
  sowing_date: "",
  planting_date: "",
  area_m2: "",
  plants_count: "",
  notes: "",
});

export const getVisibleMobileRows = (
  rows: PlantingPlanRow[],
): PlantingPlanRow[] => rows.filter((row) => !row.isNew);

const hasPositiveId = (value: unknown): boolean =>
  typeof value === "number" && value > 0;

const hasEnteredValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return true;
};

export const isEmptyNewPlantingPlanRow = (row: PlantingPlanRow): boolean =>
  !hasPositiveId(row.crop) &&
  !hasPositiveId(row.bed) &&
  !hasPositiveId(row.location_id) &&
  !hasPositiveId(row.field_id) &&
  !hasEnteredValue(row.cultivation_type) &&
  !hasEnteredValue(row.planting_date) &&
  !hasEnteredValue(row.quantity) &&
  !hasEnteredValue(row.area_m2) &&
  !hasEnteredValue(row.plants_count) &&
  !hasEnteredValue(row.notes);

export const areRowsSemanticallyEqual = (
  previousRows: PlantingPlanRow[],
  nextRows: PlantingPlanRow[],
): boolean => {
  if (previousRows.length !== nextRows.length) {
    return false;
  }

  return previousRows.every((previousRow, index) => {
    const nextRow = nextRows[index];
    return (
      previousRow.id === nextRow.id &&
      previousRow.bed === nextRow.bed &&
      previousRow.area_m2 === nextRow.area_m2 &&
      previousRow.plants_count === nextRow.plants_count &&
      previousRow.notes === nextRow.notes &&
      previousRow.crop === nextRow.crop &&
      previousRow.cultivation_type === nextRow.cultivation_type &&
      previousRow.planting_date === nextRow.planting_date &&
      previousRow.harvest_date === nextRow.harvest_date &&
      previousRow.harvest_end_date === nextRow.harvest_end_date &&
      // The rotation check is recomputed server-side on every save (also of
      // other plans on the bed), so a reload can change only these.
      previousRow.rotation_status === nextRow.rotation_status &&
      previousRow.rotation_conflict_accepted_at === nextRow.rotation_conflict_accepted_at &&
      JSON.stringify(previousRow.rotation_findings) === JSON.stringify(nextRow.rotation_findings)
    );
  });
};

export const buildMobileCreateForm = (
  prefill?: { cropId?: number | null; bedId?: number | null },
): MobileCreateFormState => {
  const baseForm = createEmptyMobileCreateForm();

  return {
    ...baseForm,
    crop:
      typeof prefill?.cropId === "number" ? String(prefill.cropId) : "",
    bed: typeof prefill?.bedId === "number" ? String(prefill.bedId) : "",
    cultivation_type: "pre_cultivation",
  };
};

/** A row's date value (Date, ISO or German text) as an ISO date, or null. */
export const toPlanIsoDate = (value: unknown): string | null => {
  const key = toDateKey(value);
  return key === null ? null : new Date(key).toISOString().slice(0, 10);
};

/**
 * ISO date a plan stops occupying its bed: its harvest end, else its harvest
 * start. Null when neither is known or when it lies before the planting date
 * (stale after a date edit); the backend then derives the end from the
 * crop's timing. The bed options and the save check both use this, so they
 * ask the shared capacity rule about the same period.
 */
export const getPlanOccupancyEndIso = (
  row: { planting_date?: unknown; harvest_end_date?: unknown; harvest_date?: unknown },
): string | null => {
  const end = toPlanIsoDate(row.harvest_end_date) ?? toPlanIsoDate(row.harvest_date);
  const start = toPlanIsoDate(row.planting_date);
  return end && start && end < start ? null : end;
};
