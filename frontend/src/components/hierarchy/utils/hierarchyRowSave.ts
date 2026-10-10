/**
 * Validation + save logic for the mobile hierarchy edit sheet
 * (`HierarchyEditSheet.tsx`).
 *
 * This is a deliberate duplicate of the `"bed"`/`"field"`/`"location"`
 * branches of `processRowUpdate` in
 * `../hooks/useHierarchyRowUpdate.ts`, minus the two DataGrid-draft-specific
 * branches (silently discarding a completely empty new row, and
 * exit-preserving-draft for a partially filled nameless new row) which don't
 * apply here: the sheet only ever saves on an explicit "Speichern" tap, so
 * there is no implicit draft to discard or preserve. Any future change to
 * the validation/save rules in `useHierarchyRowUpdate.ts` must be mirrored
 * here, and vice versa. See `docs/datagrid-architecture.md` ("Mobile layout
 * (< sm)") for the longer rationale.
 */

import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { Bed, Field, Location } from "../../../api/api";
import { fieldAPI, locationAPI } from "../../../api/api";
import { extractApiErrorMessage } from "../../../api/errors";
import type { HierarchyRow } from "./types";
import {
  normalizeAreaValue,
  parseAreaValue,
  parseDimensionValue,
} from "./hierarchyAreaParsing";

export type HierarchyRowSaveMode = "create" | "update";

export interface HierarchyRowSaveDeps {
  mode: HierarchyRowSaveMode;
  fields: Field[];
  beds: Bed[];
  locations: Location[];
  saveBed: (bed: Partial<Bed> & { id: number; field: number }) => Promise<Bed>;
  setFields: Dispatch<SetStateAction<Field[]>>;
  setLocations: Dispatch<SetStateAction<Location[]>>;
  fetchData: (opts?: { showLoading: boolean }) => Promise<void>;
  t: TFunction;
}

export type HierarchyValidationErrorField = "name" | "length" | "width" | "area" | "general";

function getBedAreaSum(
  beds: Bed[],
  fieldId: number,
  excludeBedId?: number,
  overrideArea?: number,
): number {
  const filteredBeds = beds.filter((b) => b.field === fieldId && b.id !== excludeBedId);
  return (
    filteredBeds.reduce((acc, bed) => {
      const area = parseAreaValue(bed.area_sqm) ?? NaN;
      return acc + (Number.isFinite(area) ? area : 0);
    }, 0) + (typeof overrideArea === "number" ? overrideArea : 0)
  );
}

function hasDuplicateFieldName(fields: Field[], row: HierarchyRow): boolean {
  const normalizedName = (row.name ?? "").trim();
  if (!normalizedName) return false;
  return fields.some(
    (field) =>
      field.id !== row.fieldId &&
      field.location === row.locationId &&
      field.name.trim() === normalizedName,
  );
}

function hasDuplicateBedName(beds: Bed[], row: HierarchyRow): boolean {
  const normalizedName = (row.name ?? "").trim();
  if (!normalizedName) return false;
  return beds.some(
    (bed) =>
      bed.id !== row.bedId &&
      bed.field === row.field &&
      bed.name.trim() === normalizedName,
  );
}

async function saveBedRow(
  row: HierarchyRow,
  deps: HierarchyRowSaveDeps,
): Promise<HierarchyRow> {
  const { beds, fields, saveBed, t } = deps;

  if (!row.name || row.name.trim() === "") {
    throw new Error(t("validation.nameRequired"));
  }

  if (hasDuplicateBedName(beds, row)) {
    throw new Error(t("validation.duplicateBedName"));
  }

  const parsedLength = parseDimensionValue(row.length_m);
  const parsedWidth = parseDimensionValue(row.width_m);

  if (row.length_m != null && parsedLength === undefined) {
    throw new Error(t("validation.lengthNotANumber"));
  }
  if (row.width_m != null && parsedWidth === undefined) {
    throw new Error(t("validation.widthNotANumber"));
  }
  if (parsedLength !== null && parsedLength !== undefined && parsedLength < 0) {
    throw new Error(t("validation.lengthNonNegative"));
  }
  if (parsedWidth !== null && parsedWidth !== undefined && parsedWidth < 0) {
    throw new Error(t("validation.widthNonNegative"));
  }

  const computedBedArea =
    parsedLength !== null && parsedLength !== undefined &&
    parsedWidth !== null && parsedWidth !== undefined
      ? normalizeAreaValue(parsedLength * parsedWidth)
      : normalizeAreaValue(parseAreaValue(row.area_sqm));

  const field = fields.find((f) => f.id === row.field);
  if (field && typeof computedBedArea === "number") {
    const fieldArea = parseAreaValue(field.area_sqm) ?? NaN;
    const sum = getBedAreaSum(beds, field.id!, row.bedId, computedBedArea);
    if (sum > fieldArea) {
      throw new Error(
        t("validation.bedAreaExceedsField", { sum: sum.toFixed(2), max: fieldArea.toFixed(2) }),
      );
    }
  }

  // saveBed infers create-vs-update from `id < 0` (see useBedOperations.ts),
  // so a create request needs a fresh negative transient id just like
  // desktop's addBed() produces one before the row ever reaches save.
  const bedId = deps.mode === "create" ? -Date.now() : row.bedId!;

  const savedBed = await saveBed({
    id: bedId,
    name: row.name,
    field: row.field!,
    area_sqm: computedBedArea,
    length_m: parsedLength,
    width_m: parsedWidth,
    notes: row.notes,
  });

  return {
    ...row,
    id: savedBed.id!,
    bedId: savedBed.id!,
    area_sqm: savedBed.area_sqm,
    length_m: savedBed.length_m,
    width_m: savedBed.width_m,
    isNew: false,
  };
}

async function saveFieldRow(
  row: HierarchyRow,
  deps: HierarchyRowSaveDeps,
): Promise<HierarchyRow> {
  const { beds, fields, setFields, fetchData, t } = deps;

  if (!row.name || row.name.trim() === "") {
    throw new Error(t("validation.nameRequired"));
  }

  if (hasDuplicateFieldName(fields, row)) {
    throw new Error(t("validation.duplicateFieldName"));
  }

  const parsedLength = parseDimensionValue(row.length_m);
  const parsedWidth = parseDimensionValue(row.width_m);

  if (row.length_m != null && parsedLength === undefined) {
    throw new Error(t("validation.lengthNotANumber"));
  }
  if (row.width_m != null && parsedWidth === undefined) {
    throw new Error(t("validation.widthNotANumber"));
  }
  if (parsedLength !== null && parsedLength !== undefined && parsedLength < 0) {
    throw new Error(t("validation.lengthNonNegative"));
  }
  if (parsedWidth !== null && parsedWidth !== undefined && parsedWidth < 0) {
    throw new Error(t("validation.widthNonNegative"));
  }

  const fieldArea =
    parsedLength !== null && parsedLength !== undefined &&
    parsedWidth !== null && parsedWidth !== undefined
      ? normalizeAreaValue(parsedLength * parsedWidth)
      : normalizeAreaValue(parseAreaValue(row.area_sqm));

  if (deps.mode === "create") {
    if (
      fieldArea !== undefined &&
      (typeof fieldArea !== "number" || fieldArea <= 0 || Number.isNaN(fieldArea))
    ) {
      throw new Error(t("validation.areaMustBePositive"));
    }

    try {
      const created = await fieldAPI.create({
        name: row.name,
        location: row.locationId!,
        area_sqm: fieldArea,
        length_m: parsedLength,
        width_m: parsedWidth,
        notes: row.notes,
      });

      setFields((prevFields) => [{ ...created.data }, ...prevFields]);
      void fetchData({ showLoading: false });

      return {
        ...row,
        id: `field-${created.data.id}`,
        fieldId: created.data.id,
        name: created.data.name,
        area_sqm: created.data.area_sqm,
        length_m: created.data.length_m,
        width_m: created.data.width_m,
        notes: created.data.notes,
        isNew: false,
      };
    } catch (err) {
      const extractedError = extractApiErrorMessage(err, t, t("errors.createField"));
      throw new Error(extractedError, { cause: err });
    }
  }

  if (
    fieldArea !== undefined &&
    (typeof fieldArea !== "number" || fieldArea <= 0 || Number.isNaN(fieldArea))
  ) {
    throw new Error(t("validation.areaMustBePositive"));
  }

  if (fieldArea !== undefined && fieldArea > 1000000) {
    throw new Error(t("validation.areaTooLarge"));
  }

  const sum = getBedAreaSum(beds, row.fieldId!);
  if (fieldArea !== undefined && sum > fieldArea) {
    throw new Error(
      t("validation.bedAreaExceedsField", { sum: sum.toFixed(2), max: fieldArea.toFixed(2) }),
    );
  }

  try {
    const updated = await fieldAPI.update(row.fieldId!, {
      name: row.name,
      location: row.locationId!,
      area_sqm: fieldArea,
      length_m: parsedLength,
      width_m: parsedWidth,
      notes: row.notes,
    });
    const updatedArea = normalizeAreaValue(parseAreaValue(updated.data.area_sqm));

    setFields((prevFields) =>
      prevFields.map((f) =>
        f.id === row.fieldId
          ? { ...f, ...updated.data, id: updated.data.id, area_sqm: updatedArea }
          : f,
      ),
    );

    return {
      ...row,
      name: updated.data.name,
      area_sqm: updatedArea,
      length_m: updated.data.length_m,
      width_m: updated.data.width_m,
      notes: updated.data.notes,
    };
  } catch (err) {
    const extractedError = extractApiErrorMessage(err, t, t("errors.save"));
    throw new Error(extractedError, { cause: err });
  }
}

async function saveLocationRow(
  row: HierarchyRow,
  deps: HierarchyRowSaveDeps,
): Promise<HierarchyRow> {
  const { locations, setLocations, t } = deps;

  if (!row.name || row.name.trim() === "") {
    throw new Error(t("validation.nameRequired"));
  }

  const existingLocation = locations.find((locationItem) => locationItem.id === row.locationId);
  const updated = await locationAPI.update(row.locationId!, {
    ...(existingLocation ?? {}),
    id: row.locationId!,
    name: row.name,
    notes: row.notes,
  });

  setLocations((previousLocations) =>
    previousLocations.map((locationItem) =>
      locationItem.id === row.locationId
        ? { ...locationItem, ...updated.data, id: updated.data.id }
        : locationItem,
    ),
  );

  return { ...row, name: updated.data.name, notes: updated.data.notes };
}

export async function validateAndSaveHierarchyRow(
  row: HierarchyRow,
  deps: HierarchyRowSaveDeps,
): Promise<HierarchyRow> {
  if (row.type === "bed") {
    return saveBedRow(row, deps);
  }
  if (row.type === "field") {
    return saveFieldRow(row, deps);
  }
  if (row.type === "location") {
    return saveLocationRow(row, deps);
  }
  return row;
}

/**
 * Pattern-matches a thrown validation/save message against the known
 * `validation.*` strings so the sheet can place the error next to the right
 * field without re-deriving which rule fired. Resolves the actual translated
 * strings via `t()` so this works in whichever UI language is active.
 */
const SUM_SENTINEL = "@@HIERARCHY_SUM@@";
const MAX_SENTINEL = "@@HIERARCHY_MAX@@";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds a matcher from a translation key's own template (with sentinel
 * values substituted for any interpolated variables), so a validation
 * message that does carry interpolated numbers (e.g. `bedAreaExceedsField`)
 * can still be matched regardless of locale or the actual numbers involved.
 */
function messageMatchesKey(message: string, key: string, t: TFunction): boolean {
  const template = t(key, { sum: SUM_SENTINEL, max: MAX_SENTINEL });
  const pattern = `^${escapeRegExp(template)
    .replace(new RegExp(escapeRegExp(SUM_SENTINEL), "g"), ".*")
    .replace(new RegExp(escapeRegExp(MAX_SENTINEL), "g"), ".*")}$`;
  return new RegExp(pattern).test(message);
}

export function classifyHierarchyValidationError(
  message: string,
  t: TFunction,
): HierarchyValidationErrorField {
  const nameKeys = ["validation.nameRequired", "validation.duplicateFieldName", "validation.duplicateBedName"];
  const lengthKeys = ["validation.lengthNotANumber", "validation.lengthNonNegative"];
  const widthKeys = ["validation.widthNotANumber", "validation.widthNonNegative"];
  const areaKeys = ["validation.areaMustBePositive", "validation.areaTooLarge", "validation.bedAreaExceedsField"];

  const matchesAny = (keys: string[]): boolean =>
    keys.some((key) => messageMatchesKey(message, key, t));

  if (matchesAny(nameKeys)) return "name";
  if (matchesAny(lengthKeys)) return "length";
  if (matchesAny(widthKeys)) return "width";
  if (matchesAny(areaKeys)) return "area";
  return "general";
}
