/**
 * Mobile (< sm) counterpart to `FieldsBedsHierarchy.tsx`: the touch-friendly
 * indented list + bottom sheet described in
 * `docs/datagrid-architecture.md` ("Mobile layout (< sm)"). The DataGrid in
 * `FieldsBedsHierarchy.tsx` is never mounted at this breakpoint - this
 * component reuses its data hooks and delete/undo machinery but renders a
 * flat list (`HierarchyMobileList`) and a bottom sheet (`HierarchyEditSheet`)
 * instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Box, CircularProgress, Stack } from "@mui/material";
import { useTranslation } from "../i18n";
import { useHierarchyData, type HierarchyDataState } from "../components/hierarchy/hooks/useHierarchyData";
import { useExpandedState } from "../components/hierarchy/hooks/useExpandedState";
import { usePersistentSortModel } from "../hooks/usePersistentSortModel";
import { useMobileHierarchyRows, type MobileHierarchyRow } from "../components/hierarchy/hooks/useMobileHierarchyRows";
import {
  useMobileHierarchyRowOperations,
  type MobileCreateSheetRequest,
} from "../components/hierarchy/hooks/useMobileHierarchyRowOperations";
import { HierarchyMobileList } from "../components/hierarchy/mobile/HierarchyMobileList";
import {
  HierarchyEditSheet,
  type HierarchyEditSheetAncestor,
  type HierarchyEditSheetCreateContext,
} from "../components/hierarchy/mobile/HierarchyEditSheet";
import { DeleteUndoSnackbar } from "../components/data-grid";
import type { HierarchySortConfig } from "../components/hierarchy/utils/hierarchyUtils";

interface FieldsBedsHierarchyMobileProps {
  showTitle?: boolean;
  createFieldRequest?: number;
  onCreateFieldRequestHandled?: () => void;
  hierarchyData?: HierarchyDataState;
  onPendingDeletionCountChange?: (count: number) => void;
}

type SheetState =
  | { mode: "edit"; row: MobileHierarchyRow }
  | { mode: "create"; nodeType: "field" | "bed"; parentId: number; locationId?: number }
  | null;

function FieldsBedsHierarchyMobile({
  createFieldRequest = 0,
  onCreateFieldRequestHandled,
  hierarchyData,
  onPendingDeletionCountChange,
}: FieldsBedsHierarchyMobileProps) {
  const { t } = useTranslation(["hierarchy", "common"]);
  const navigate = useNavigate();
  const location = useLocation();
  const handledCreateFieldRequestRef = useRef(0);
  // While a sheet opened from the createFieldRequest deep link is open, the
  // field it may create hasn't been saved yet, so `fields` doesn't contain it
  // and `shouldRenderHierarchy` in FieldsBedsPage.tsx would otherwise go back
  // to false the instant createFieldRequest resets to 0 - unmounting this
  // whole component (and its open sheet) back to the "no fields yet" empty
  // state. Deferring the reset to onCreateFieldRequestHandled until the sheet
  // actually closes (cancelled or saved) keeps createFieldRequest > 0, and
  // therefore this component mounted, for as long as the sheet is open.
  const createFieldRequestSheetOpenRef = useRef(false);
  const [selectedRowId, setSelectedRowId] = useState<string | number | null>(null);

  const internalHierarchyData = useHierarchyData(hierarchyData === undefined);
  const {
    loading,
    error,
    setError,
    locations,
    setLocations,
    fields,
    beds,
    setBeds,
    setFields,
    fetchData,
  } = hierarchyData ?? internalHierarchyData;

  const { expandedRows, toggleExpand, expandAll } = useExpandedState("fieldsBedsHierarchy");
  const { sortModel } = usePersistentSortModel({
    tableKey: "fieldsBedsHierarchy",
    allowedFields: ["name", "area_sqm"],
    persistInUrl: true,
  });
  const hierarchySortConfig = useMemo<HierarchySortConfig | undefined>(() => {
    const [firstSort] = sortModel;
    if (!firstSort || !firstSort.sort) {
      return undefined;
    }
    return { field: firstSort.field, direction: firstSort.sort };
  }, [sortModel]);

  const rows = useMobileHierarchyRows(locations, fields, beds, hierarchySortConfig, expandedRows);

  const {
    saveBed,
    pendingDeletions,
    undoPendingDeletion,
    closePendingDeletionSnackbar,
    getHierarchyRowActions,
  } = useMobileHierarchyRowOperations({
    locations,
    fields,
    beds,
    expandedRows,
    fetchData,
    expandAll,
    setLocations,
    setFields,
    setBeds,
    setSelectedRowId,
    setError,
    onPendingDeletionCountChange,
    t,
  });

  const [sheetState, setSheetState] = useState<SheetState>(null);

  const openCreateSheet = useCallback(({ nodeType, parentId }: MobileCreateSheetRequest): void => {
    setSheetState({ mode: "create", nodeType, parentId });
  }, []);

  const onOpenRow = useCallback((row: MobileHierarchyRow): void => {
    setSelectedRowId(row.id);
    setSheetState({ mode: "edit", row });
  }, []);

  // Deep link: the "Parzelle hinzufügen" command / topbar action increments
  // createFieldRequest the same way it drives desktop's inline grid draft row.
  useEffect(() => {
    if (
      createFieldRequest <= 0 ||
      loading ||
      createFieldRequest <= handledCreateFieldRequestRef.current
    ) {
      return;
    }
    const firstLocation = locations.find((locationItem) => locationItem.id !== undefined);
    if (firstLocation?.id === undefined) {
      return;
    }
    handledCreateFieldRequestRef.current = createFieldRequest;
    createFieldRequestSheetOpenRef.current = true;
    openCreateSheet({ nodeType: "field", parentId: firstLocation.id });
  }, [createFieldRequest, loading, locations, openCreateSheet]);

  // ?createBed=true deep link (mirrors the equivalent effect in
  // FieldsBedsHierarchy.tsx): opens the create sheet for a bed on the first
  // field instead of entering DataGrid edit mode.
  useEffect(() => {
    if (!location.pathname.startsWith("/app/fields-beds")) {
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get("createBed") !== "true" || loading) {
      return;
    }
    const firstField = fields.find((field) => field.id !== undefined);
    if (firstField?.id !== undefined) {
      openCreateSheet({ nodeType: "bed", parentId: firstField.id });
    }
    searchParams.delete("createBed");
    const nextSearch = searchParams.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
      { replace: true },
    );
  }, [fields, loading, location.pathname, location.search, navigate, openCreateSheet]);

  const ancestors = useMemo<HierarchyEditSheetAncestor[]>(() => {
    if (sheetState?.mode === "edit") {
      const row = sheetState.row;
      const chain: HierarchyEditSheetAncestor[] = [];
      if (row.type === "bed" || row.type === "field") {
        const locationItem = locations.find((item) => item.id === row.locationId);
        if (locationItem?.id !== undefined && locationItem.name) {
          chain.push({ id: `location-${locationItem.id}`, name: locationItem.name });
        }
      }
      if (row.type === "bed") {
        const field = fields.find((item) => item.id === row.fieldId);
        if (field?.id !== undefined) {
          chain.push({ id: `field-${field.id}`, name: field.name });
        }
      }
      return chain;
    }
    if (sheetState?.mode === "create") {
      const chain: HierarchyEditSheetAncestor[] = [];
      if (sheetState.nodeType === "field") {
        const locationItem = locations.find((item) => item.id === sheetState.parentId);
        if (locationItem?.id !== undefined && locationItem.name) {
          chain.push({ id: `location-${locationItem.id}`, name: locationItem.name });
        }
      } else {
        const field = fields.find((item) => item.id === sheetState.parentId);
        if (field) {
          const locationItem = locations.find((item) => item.id === field.location);
          if (locationItem?.id !== undefined && locationItem.name) {
            chain.push({ id: `location-${locationItem.id}`, name: locationItem.name });
          }
          chain.push({ id: `field-${field.id}`, name: field.name });
        }
      }
      return chain;
    }
    return [];
  }, [sheetState, locations, fields]);

  const createContext: HierarchyEditSheetCreateContext | undefined =
    sheetState?.mode === "create"
      ? {
          nodeType: sheetState.nodeType,
          parentId: sheetState.parentId,
          locationId:
            sheetState.nodeType === "bed"
              ? fields.find((field) => field.id === sheetState.parentId)?.location
              : sheetState.parentId,
        }
      : undefined;

  const handleSheetClose = useCallback((): void => {
    setSheetState(null);
    setSelectedRowId(null);
    if (createFieldRequestSheetOpenRef.current) {
      createFieldRequestSheetOpenRef.current = false;
      onCreateFieldRequestHandled?.();
    }
  }, [onCreateFieldRequestHandled]);

  // Deleting the row being edited must also close its sheet, otherwise the
  // sheet stays open on a row that no longer exists and "Speichern" would
  // update a deleted record.
  const rowActions = useMemo(() => {
    if (sheetState?.mode !== "edit") {
      return [];
    }
    return getHierarchyRowActions(sheetState.row, openCreateSheet).map((action) =>
      action.group === "destructive"
        ? {
            ...action,
            onClick: () => {
              handleSheetClose();
              action.onClick();
            },
          }
        : action,
    );
  }, [sheetState, getHierarchyRowActions, openCreateSheet, handleSheetClose]);

  const handleSaved = useCallback((): void => {
    setError("");
  }, [setError]);

  return (
    <Box>
      {error ? (
        <Box sx={{ color: "error.main", mb: 2 }}>{error}</Box>
      ) : null}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <HierarchyMobileList
          rows={rows}
          expandedRows={expandedRows}
          onToggleExpand={toggleExpand}
          onOpenRow={onOpenRow}
          openRowId={selectedRowId}
        />
      )}

      <HierarchyEditSheet
        open={sheetState !== null}
        onClose={handleSheetClose}
        mode={sheetState?.mode ?? "edit"}
        row={sheetState?.mode === "edit" ? sheetState.row : null}
        createContext={createContext}
        ancestors={ancestors}
        rowActions={rowActions}
        onSaved={handleSaved}
        saveDeps={{
          fields,
          beds,
          locations,
          saveBed,
          setFields,
          setLocations,
          fetchData,
          t,
        }}
      />

      <Stack>
        {pendingDeletions.map((deletion, index) => (
          <DeleteUndoSnackbar
            key={deletion.id}
            open={deletion.visible}
            message={deletion.message}
            undoLabel={t("actions.undo")}
            offsetIndex={index}
            testId="hierarchy-delete-snackbar"
            onClose={() => closePendingDeletionSnackbar(deletion.id)}
            onUndo={() => {
              void undoPendingDeletion(deletion.id);
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

export default FieldsBedsHierarchyMobile;
