import { useCallback } from "react";
import type { GridRowId, GridRowModesModel } from "@mui/x-data-grid";
import { GridRowModes } from "@mui/x-data-grid";
import type { Bed, Field, Location } from "../../../api/api";
import { fieldAPI, locationAPI } from "../../../api/api";
import { extractApiErrorMessage } from "../../../api/errors";
import type { HierarchyRow } from "../utils/types";
import {
  isCompletelyEmptyNewHierarchyRow,
  isPartiallyFilledNamelessNewHierarchyRow,
} from "../utils/hierarchyRowDraft";
import {
  normalizeAreaValue,
  parseAreaValue,
  parseDimensionValue,
} from "../utils/hierarchyAreaParsing";
import type { TFunction } from "i18next";

// Tags a rejected processRowUpdate error with the row it failed for, so
// handleProcessRowUpdateError can tell a "stale" rejection (the user already
// moved on to editing a different row before this one's save came back) from
// one for the row the user is still actively looking at.
export type HierarchyRowUpdateError = Error & { hierarchyRowId?: GridRowId };

export const tagHierarchyRowUpdateError = (error: unknown, rowId: GridRowId): unknown => {
  if (error instanceof Error) {
    (error as HierarchyRowUpdateError).hierarchyRowId = rowId;
  }
  return error;
};

interface UseHierarchyRowUpdateParams {
  getDraftRow: (rowId: GridRowId) => HierarchyRow | null;
  rowModesModel: GridRowModesModel;
  // handleProcessRowUpdateError runs from a promise continuation that can
  // resolve after the user has already, synchronously, clicked into a
  // different row - selectRow updates this ref immediately (not through
  // state/render), so it reliably reflects which row the user is actually
  // looking at right now, telling a cross-row-triggered rejection apart from
  // one for the row still being edited.
  selectedRowIdRef: React.MutableRefObject<GridRowId | null>;
  rowsById: Map<string, HierarchyRow>;
  beds: Bed[];
  fields: Field[];
  locations: Location[];
  setBeds: React.Dispatch<React.SetStateAction<Bed[]>>;
  setFields: React.Dispatch<React.SetStateAction<Field[]>>;
  setLocations: React.Dispatch<React.SetStateAction<Location[]>>;
  rowSnapshotRef: React.MutableRefObject<Map<string, HierarchyRow>>;
  setRowModesModel: React.Dispatch<React.SetStateAction<GridRowModesModel>>;
  setError: (error: string) => void;
  setDraftValidationWarning: (warning: string) => void;
  fetchData: (options?: { showLoading: boolean }) => Promise<void>;
  saveBed: (bed: Partial<Bed> & { id: number; field: number }) => Promise<Bed>;
  // A prefilled new bed the user hasn't changed counts as empty when its
  // edit is cancelled (Escape), so cancelling "Beet hinzufügen" leaves
  // nothing behind, exactly as for an empty new row.
  isUntouchedPrefilledDraft?: (row: HierarchyRow) => boolean;
  // Called instead of the inline warning whenever a new row's edit ends
  // (click outside handles this itself before ever reaching processRowUpdate,
  // but a cross-row click or a natural blur still land here) while it has
  // some field filled in but no name - opens the confirm dialog for that row.
  onUnsavedMissingName: (rowId: GridRowId) => void;
  t: TFunction;
}

export function useHierarchyRowUpdate({
  getDraftRow,
  rowModesModel,
  selectedRowIdRef,
  rowsById,
  beds,
  fields,
  locations,
  setBeds,
  setFields,
  setLocations,
  rowSnapshotRef,
  setRowModesModel,
  onUnsavedMissingName,
  setError,
  setDraftValidationWarning,
  fetchData,
  saveBed,
  isUntouchedPrefilledDraft,
  t,
}: UseHierarchyRowUpdateParams) {
  const getBedAreaSum = useCallback(
    (fieldId: number, excludeBedId?: number, overrideArea?: number): number => {
      const filteredBeds = beds.filter(
        (b) => b.field === fieldId && b.id !== excludeBedId,
      );
      const sum =
        filteredBeds.reduce((acc, bed) => {
          const area = parseAreaValue(bed.area_sqm) ?? NaN;
          return acc + (Number.isFinite(area) ? area : 0);
        }, 0) + (typeof overrideArea === "number" ? overrideArea : 0);
      return sum;
    },
    [beds],
  );

  const hasDuplicateFieldName = useCallback(
    (row: HierarchyRow): boolean => {
      const normalizedName = (row.name ?? "").trim();
      if (!normalizedName) return false;
      return fields.some(
        (field) =>
          field.id !== row.fieldId &&
          field.location === row.locationId &&
          field.name.trim() === normalizedName,
      );
    },
    [fields],
  );

  const hasDuplicateBedName = useCallback(
    (row: HierarchyRow): boolean => {
      const normalizedName = (row.name ?? "").trim();
      if (!normalizedName) return false;
      return beds.some(
        (bed) =>
          bed.id !== row.bedId &&
          bed.field === row.field &&
          bed.name.trim() === normalizedName,
      );
    },
    [beds],
  );

  // Writes a draft's typed values into the underlying beds/fields state
  // without saving to the backend, so a row that exits edit mode without a
  // name doesn't lose what was typed - re-entering edit mode later (e.g. from
  // the unsaved-row dialog's "continue editing") resumes from these values.
  const persistDraftValues = useCallback(
    (draftRow: HierarchyRow): void => {
      if (draftRow.type === "bed" && typeof draftRow.bedId === "number") {
        setBeds((previousBeds) =>
          previousBeds.map((bed) =>
            bed.id === draftRow.bedId
              ? {
                  ...bed,
                  name: draftRow.name ?? "",
                  area_sqm: parseAreaValue(draftRow.area_sqm),
                  length_m: parseDimensionValue(draftRow.length_m),
                  width_m: parseDimensionValue(draftRow.width_m),
                  notes: draftRow.notes ?? "",
                }
              : bed,
          ),
        );
        return;
      }
      if (draftRow.type === "field" && typeof draftRow.fieldId === "number") {
        setFields((previousFields) =>
          previousFields.map((field) =>
            field.id === draftRow.fieldId
              ? {
                  ...field,
                  name: draftRow.name ?? "",
                  area_sqm: parseAreaValue(draftRow.area_sqm),
                  length_m: parseDimensionValue(draftRow.length_m),
                  width_m: parseDimensionValue(draftRow.width_m),
                  notes: draftRow.notes ?? "",
                }
              : field,
          ),
        );
      }
    },
    [setBeds, setFields],
  );

  // Exits edit mode through the normal controlled rowModesModel transition
  // (the same path a successful save takes) *before* a dialog is shown over
  // the row. Opening a Dialog while the row's edit <input> still has focus
  // fights MUI's own focus management (which tries to keep focus inside the
  // still-mounted edit cell) and the Modal's focus trap, which can tear the
  // dialog down again almost immediately - see the aria-hidden warning this
  // caused. Persisting first means "continue editing" resumes with the
  // typed values intact.
  const exitToViewPreservingDraft = useCallback(
    (rowId: GridRowId, draftRow: HierarchyRow): void => {
      persistDraftValues(draftRow);
      rowSnapshotRef.current.delete(String(rowId));
      setRowModesModel((previousModel) => ({
        ...previousModel,
        [rowId]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
    },
    [persistDraftValues, rowSnapshotRef, setRowModesModel],
  );

  const preservePartialNewBedDraft = useCallback(
    (draftRow: HierarchyRow): void => {
      if (draftRow.type !== "bed" || typeof draftRow.bedId !== "number") return;

      if (isPartiallyFilledNamelessNewHierarchyRow(draftRow)) {
        setDraftValidationWarning(t("messages.unsavedMissingName"));
        setError("");
      } else {
        setDraftValidationWarning("");
      }

      setBeds((previousBeds) =>
        previousBeds.map((bed) =>
          bed.id === draftRow.bedId
            ? {
                ...bed,
                name: draftRow.name ?? "",
                area_sqm: parseAreaValue(draftRow.area_sqm),
                length_m: parseDimensionValue(draftRow.length_m),
                width_m: parseDimensionValue(draftRow.width_m),
                notes: draftRow.notes ?? "",
              }
            : bed,
        ),
      );
    },
    [setBeds, setDraftValidationWarning, setError, t],
  );

  const discardRowEdit = useCallback(
    (rowId: GridRowId, options?: { force?: boolean }): void => {
      const draftRow = getDraftRow(rowId);

      if (draftRow?.isNew) {
        if (draftRow.type === "field") {
          setFields((previousFields) =>
            previousFields.filter((field) => `field-${field.id}` !== String(rowId)),
          );
          setDraftValidationWarning("");
          rowSnapshotRef.current.delete(String(rowId));
          setRowModesModel((previousModel) => ({
            ...previousModel,
            [rowId]: { mode: GridRowModes.View, ignoreModifications: true },
          }));
          return;
        }

        if (
          options?.force
          || isCompletelyEmptyNewHierarchyRow(draftRow)
          || isUntouchedPrefilledDraft?.(draftRow)
        ) {
          setBeds((previousBeds) =>
            previousBeds.filter((bed) => String(bed.id) !== String(rowId)),
          );
          setDraftValidationWarning("");
        } else {
          preservePartialNewBedDraft(draftRow);
        }
      }

      rowSnapshotRef.current.delete(String(rowId));
      setRowModesModel((previousModel) => ({
        ...previousModel,
        [rowId]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
    },
    [getDraftRow, isUntouchedPrefilledDraft, preservePartialNewBedDraft, rowSnapshotRef, setBeds, setDraftValidationWarning, setFields, setRowModesModel],
  );

  const discardActiveRowEdit = useCallback((): void => {
    const editingRowId = Object.entries(rowModesModel).find(
      ([, mode]) => mode.mode === GridRowModes.Edit,
    )?.[0];
    if (editingRowId === undefined) return;
    discardRowEdit(rowsById.get(editingRowId)?.id ?? editingRowId);
  }, [discardRowEdit, rowModesModel, rowsById]);

  const processRowUpdate = useCallback(
    async (newRow: HierarchyRow): Promise<HierarchyRow> => {
      if (!newRow.name || newRow.name.trim() === "") {
        if (isCompletelyEmptyNewHierarchyRow(newRow)) {
          // Nothing was entered - silently drop the draft instead of blocking
          // the user with a "Name is required" error they can't dismiss.
          discardRowEdit(newRow.id);
          return newRow;
        }
        if (isPartiallyFilledNamelessNewHierarchyRow(newRow)) {
          // Resolve (don't throw) so the row cleanly exits edit mode through
          // the normal path instead of being left stranded in Edit by a
          // rejection - see exitToViewPreservingDraft for why.
          exitToViewPreservingDraft(newRow.id, newRow);
          onUnsavedMissingName(newRow.id);
          return newRow;
        }
        setError(t("validation.nameRequired"));
        throw new Error(t("validation.nameRequired"));
      }

      setDraftValidationWarning("");

      if (newRow.type === "bed") {
        if (hasDuplicateBedName(newRow)) {
          setError(t("validation.duplicateBedName"));
          throw new Error(t("validation.duplicateBedName"));
        }

        const parsedLength = parseDimensionValue(newRow.length_m);
        const parsedWidth = parseDimensionValue(newRow.width_m);

        if (newRow.length_m != null && parsedLength === undefined) {
          setError(t("validation.lengthNotANumber"));
          throw new Error(t("validation.lengthNotANumber"));
        }
        if (newRow.width_m != null && parsedWidth === undefined) {
          setError(t("validation.widthNotANumber"));
          throw new Error(t("validation.widthNotANumber"));
        }
        if (parsedLength !== null && parsedLength !== undefined && parsedLength < 0) {
          setError(t("validation.lengthNonNegative"));
          throw new Error(t("validation.lengthNonNegative"));
        }
        if (parsedWidth !== null && parsedWidth !== undefined && parsedWidth < 0) {
          setError(t("validation.widthNonNegative"));
          throw new Error(t("validation.widthNonNegative"));
        }

        const computedBedArea =
          parsedLength !== null && parsedLength !== undefined &&
          parsedWidth !== null && parsedWidth !== undefined
            ? normalizeAreaValue(parsedLength * parsedWidth)
            : normalizeAreaValue(parseAreaValue(newRow.area_sqm));

        const field = fields.find((f) => f.id === newRow.field);
        if (field && typeof computedBedArea === "number") {
          const fieldArea = parseAreaValue(field.area_sqm) ?? NaN;
          const sum = getBedAreaSum(field.id!, newRow.bedId, computedBedArea);
          if (sum > fieldArea) {
            const msg = t("validation.bedAreaExceedsField", {
              sum: sum.toFixed(2),
              max: fieldArea.toFixed(2),
            });
            setError(msg);
            throw new Error(msg);
          }
        }

        const savedBed = await saveBed({
          id: newRow.bedId!,
          name: newRow.name,
          field: newRow.field!,
          area_sqm: computedBedArea,
          length_m: parsedLength,
          width_m: parsedWidth,
          notes: newRow.notes,
        });
        return {
          ...newRow,
          id: savedBed.id!,
          bedId: savedBed.id!,
          area_sqm: savedBed.area_sqm,
          length_m: savedBed.length_m,
          width_m: savedBed.width_m,
          isNew: false,
        };
      }

      if (newRow.type === "field") {
        if (hasDuplicateFieldName(newRow)) {
          setError(t("validation.duplicateFieldName"));
          throw new Error(t("validation.duplicateFieldName"));
        }

        const isNewField = typeof newRow.fieldId === "number" && newRow.fieldId < 0;
        const parsedLength = parseDimensionValue(newRow.length_m);
        const parsedWidth = parseDimensionValue(newRow.width_m);

        if (newRow.length_m != null && parsedLength === undefined) {
          setError(t("validation.lengthNotANumber"));
          throw new Error(t("validation.lengthNotANumber"));
        }
        if (newRow.width_m != null && parsedWidth === undefined) {
          setError(t("validation.widthNotANumber"));
          throw new Error(t("validation.widthNotANumber"));
        }
        if (parsedLength !== null && parsedLength !== undefined && parsedLength < 0) {
          setError(t("validation.lengthNonNegative"));
          throw new Error(t("validation.lengthNonNegative"));
        }
        if (parsedWidth !== null && parsedWidth !== undefined && parsedWidth < 0) {
          setError(t("validation.widthNonNegative"));
          throw new Error(t("validation.widthNonNegative"));
        }

        const fieldArea =
          parsedLength !== null && parsedLength !== undefined &&
          parsedWidth !== null && parsedWidth !== undefined
            ? normalizeAreaValue(parsedLength * parsedWidth)
            : normalizeAreaValue(parseAreaValue(newRow.area_sqm));

        if (isNewField) {
          if (
            fieldArea !== undefined &&
            (typeof fieldArea !== "number" || fieldArea <= 0 || Number.isNaN(fieldArea))
          ) {
            setError(t("validation.areaMustBePositive"));
            throw new Error(t("validation.areaMustBePositive"));
          }

          try {
            const created = await fieldAPI.create({
              name: newRow.name,
              location: newRow.locationId!,
              area_sqm: fieldArea,
              length_m: parsedLength,
              width_m: parsedWidth,
              notes: newRow.notes,
            });

            setFields((prevFields) => {
              const filteredFields = prevFields.filter(
                (field) => field.id !== newRow.fieldId,
              );
              return [{ ...created.data }, ...filteredFields];
            });
            void fetchData({ showLoading: false });
            setError("");
            return {
              ...newRow,
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
            setError(extractedError);
            throw new Error(extractedError, { cause: err });
          }
        }

        if (
          fieldArea !== undefined &&
          (typeof fieldArea !== "number" || fieldArea <= 0 || Number.isNaN(fieldArea))
        ) {
          setError(t("validation.areaMustBePositive"));
          throw new Error(t("validation.areaMustBePositive"));
        }

        if (fieldArea !== undefined && fieldArea > 1000000) {
          setError(t("validation.areaTooLarge"));
          throw new Error(t("validation.areaTooLarge"));
        }

        const sum = getBedAreaSum(newRow.fieldId!);
        if (fieldArea !== undefined && sum > fieldArea) {
          const msg = t("validation.bedAreaExceedsField", {
            sum: sum.toFixed(2),
            max: fieldArea.toFixed(2),
          });
          setError(msg);
          throw new Error(msg);
        }

        try {
          const updated = await fieldAPI.update(newRow.fieldId!, {
            name: newRow.name,
            location: newRow.locationId!,
            area_sqm: fieldArea,
            length_m: parsedLength,
            width_m: parsedWidth,
            notes: newRow.notes,
          });
          const updatedArea = normalizeAreaValue(parseAreaValue(updated.data.area_sqm));

          setFields((prevFields) =>
            prevFields.map((f) =>
              f.id === newRow.fieldId
                ? {
                    ...f,
                    ...updated.data,
                    id: updated.data.id,
                    area_sqm: updatedArea,
                    length_m: updated.data.length_m,
                    width_m: updated.data.width_m,
                  }
                : f,
            ),
          );
          return {
            ...newRow,
            name: updated.data.name,
            area_sqm: updatedArea,
            length_m: updated.data.length_m,
            width_m: updated.data.width_m,
            notes: updated.data.notes,
          };
        } catch (err) {
          const extractedError = extractApiErrorMessage(err, t, t("errors.save"));
          const requiresLocationSelection =
            locations.length > 1 &&
            extractedError.toLowerCase().includes("standort") &&
            extractedError.toLowerCase().includes(t("validation.required").toLowerCase());
          const errorMessage = requiresLocationSelection
            ? t("messages.invalidLocationSelection")
            : extractedError.includes("max_digits") ||
                extractedError.toLowerCase().includes("digits")
              ? t("validation.areaTooLarge")
              : extractedError;
          setError(errorMessage);
          throw new Error(errorMessage, { cause: err });
        }
      }

      if (newRow.type === "location") {
        const existingLocation = locations.find(
          (locationItem) => locationItem.id === newRow.locationId,
        );
        const updated = await locationAPI.update(newRow.locationId!, {
          ...(existingLocation ?? {}),
          id: newRow.locationId!,
          name: newRow.name,
          notes: newRow.notes,
        });

        setLocations((previousLocations) =>
          previousLocations.map((locationItem) =>
            locationItem.id === newRow.locationId
              ? { ...locationItem, ...updated.data, id: updated.data.id }
              : locationItem,
          ),
        );
        return { ...newRow, name: updated.data.name, notes: updated.data.notes };
      }

      return newRow;
    },
    [
      discardRowEdit,
      exitToViewPreservingDraft,
      fetchData,
      fields,
      getBedAreaSum,
      hasDuplicateBedName,
      hasDuplicateFieldName,
      locations,
      onUnsavedMissingName,
      saveBed,
      setDraftValidationWarning,
      setError,
      setFields,
      setLocations,
      t,
    ],
  );

  const handleProcessRowUpdateError = useCallback(
    (error: HierarchyRowUpdateError): void => {
      console.error("Row update error:", error);

      const erroredRowId = error.hierarchyRowId;
      const currentSelectedRowId = selectedRowIdRef.current;
      if (
        erroredRowId !== undefined
        && currentSelectedRowId !== null
        && String(currentSelectedRowId) !== String(erroredRowId)
      ) {
        // The user already clicked into a different row before this row's
        // save rejected - leaving it in Edit mode too would show two rows
        // editable at once instead of reverting the abandoned attempt.
        setRowModesModel((previousModel) => ({
          ...previousModel,
          [erroredRowId]: { mode: GridRowModes.View, ignoreModifications: true },
        }));
      }
      setError(error.message || t("errors.save"));
    },
    [selectedRowIdRef, setError, setRowModesModel, t],
  );

  return {
    preservePartialNewBedDraft,
    exitToViewPreservingDraft,
    discardRowEdit,
    discardActiveRowEdit,
    processRowUpdate,
    handleProcessRowUpdateError,
  };
}
