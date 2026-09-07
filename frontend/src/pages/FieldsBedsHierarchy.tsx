/**
 * Hierarchical Fields and Beds page component.
 *
 * Displays Locations > Fields > Beds in a tree structure with inline editing.
 * Uses MUI Data Grid with custom row grouping logic.
 * UI text is in German, code comments remain in English.
 *
 * @returns The hierarchical Fields/Beds page component
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "../i18n";
import {
  DataGrid,
  GridRowEditStopReasons,
  GridRowModes,
  useGridApiRef,
} from "@mui/x-data-grid";
import { getDataGridLocaleText } from "../components/data-grid/localeText";
import type {
  GridCellParams,
  GridEventListener,
  GridRowHeightParams,
  GridRowId,
  GridRowsProp,
  GridRowModesModel,
} from "@mui/x-data-grid";
import { Box, Alert, useMediaQuery } from "@mui/material";
import AgricultureIcon from "@mui/icons-material/Agriculture";
import DeleteIcon from "@mui/icons-material/Delete";
import { ContextMenuActionItem } from "../components/contextMenu/ContextMenuActionItem";
import { CustomContextMenu } from "../components/contextMenu/CustomContextMenu";
import { renderGroupedContextMenuActions } from "../components/contextMenu/contextMenuGroups";
import { ConfirmationDialog } from "../components/feedback/ConfirmationDialog";
import { HierarchyAddIcon } from "../components/hierarchy/HierarchyAddIcon";
import EmptyStateCard from '../components/project/EmptyStateCard';
import { PAGE_CONTAINER_SX } from '../components/layout/pageContainerStyles';
import {
  HIERARCHY_AUTO_EXPAND_ALL_THRESHOLD,
  HIERARCHY_DATA_GRID_SX,
  HIERARCHY_GRID_PAGE_SIZE,
  HIERARCHY_VIRTUAL_SCROLLER_SELECTOR,
  TABLE_BOTTOM_MARGIN_PX,
  TABLE_MIN_HEIGHT_PX,
} from "./fieldsBedsHierarchyStyles";
import {
  DeleteUndoSnackbar,
  ContextMenuHint,
  TableCopyMenuItems,
  useNotesEditor,
  NotesDrawer,
  getPlainExcerpt,
  useContextMenuHint,
  StableScrollbarTrack,
} from "../components/data-grid";
import {
  isInteractiveCellTarget,
  preventReadOnlyCellMouseFocus,
} from "../components/data-grid/keyboardNavigation";
import { useNavigationBlocker } from "../hooks/autosave";
import { useHierarchyData, type HierarchyDataState } from "../components/hierarchy/hooks/useHierarchyData";
import { useExpandedState } from "../components/hierarchy/hooks/useExpandedState";
import { type TreeRowNode } from "../components/hierarchy/utils/treeRows";
import { useHierarchyLevelToggle } from "../components/hierarchy/hooks/useHierarchyLevelToggle";
import { useHierarchyRowWindow } from "../components/hierarchy/hooks/useHierarchyRowWindow";
import { useHierarchyStableScrollbar } from "../components/hierarchy/hooks/useHierarchyStableScrollbar";
import { hasPersistedEntityId } from "../components/hierarchy/utils/hierarchyUtils";
import { useBedOperations } from "../components/hierarchy/hooks/useBedOperations";
import { useHierarchyDelete } from "../components/hierarchy/hooks/useHierarchyDelete";
import { useHierarchyGridFocus } from "../components/hierarchy/hooks/useHierarchyGridFocus";
import { useHierarchyNavigationState } from "../components/hierarchy/hooks/useHierarchyNavigationState";
import { tagHierarchyRowUpdateError, useHierarchyRowUpdate } from "../components/hierarchy/hooks/useHierarchyRowUpdate";
import { useHierarchyContextMenu } from "../components/hierarchy/hooks/useHierarchyContextMenu";
import { keywordList } from "../commands/keywordList";
import { useHierarchyKeyboard } from "../components/hierarchy/hooks/useHierarchyKeyboard";
import { useHierarchyGridKeyboard } from "../components/hierarchy/hooks/useHierarchyGridKeyboard";
import { usePersistentSortModel } from "../hooks/usePersistentSortModel";
import { fieldAPI, bedAPI, locationAPI, type Field } from "../api/api";
import {
  applyHierarchyOrderSnapshot,
  buildHierarchyIndex,
  computeHierarchyOrderSnapshot,
  createHierarchyRowsProjector,
  type HierarchyOrderSnapshot,
  type HierarchySortConfig,
} from "../components/hierarchy/utils/hierarchyUtils";
import {
  createHierarchyColumns,
  DEFAULT_HIERARCHY_COLUMN_WIDTHS,
} from "../components/hierarchy/HierarchyColumns";
import type { HierarchyRow } from "../components/hierarchy/utils/types";
import {
  calculateHierarchyNameColumnWidth,
  getHierarchyNameMeasureKey,
  measureHierarchyNameTextWidths,
  type HierarchyNameMeasureEntry,
} from "../components/hierarchy/utils/hierarchyNameColumnWidth";
import {
  isCompletelyEmptyNewHierarchyRow,
  isPartiallyFilledNamelessNewHierarchyRow,
} from "../components/hierarchy/utils/hierarchyRowDraft";
import {
  normalizeAreaValue,
  parseAreaValue,
  parseDimensionValue,
} from "../components/hierarchy/utils/hierarchyAreaParsing";
import {
  useRegisterCommands,
} from "../commands/useCommandContext";
import type { CommandSpec } from "../commands/types";

interface FieldsBedsHierarchyProps {
  showTitle?: boolean;
  createFieldRequest?: number;
  onCreateFieldRequestHandled?: () => void;
  hierarchyData?: HierarchyDataState;
  onPendingDeletionCountChange?: (count: number) => void;
  suppressContextMenuHint?: boolean;
}

interface HierarchyRowAction {
  id: string;
  label: string;
  group: "create" | "destructive";
  color?: "default" | "error";
  onClick: () => void;
  emphasized?: boolean;
  icon?: React.ReactNode;
  shortcutHint?: string;
}


function FieldsBedsHierarchy({
  showTitle = true,
  createFieldRequest = 0,
  onCreateFieldRequestHandled,
  hierarchyData,
  onPendingDeletionCountChange,
  suppressContextMenuHint = false,
}: FieldsBedsHierarchyProps) {
  const LOCATION_ROW_HEIGHT = 46;
  const FIELD_ROW_HEIGHT = 42;
  const BED_ROW_HEIGHT = 36;
  const HEADER_ROW_HEIGHT = 40;

  const { t } = useTranslation(["hierarchy", "common"]);
  const navigate = useNavigate();
  const location = useLocation();
  const gridApiRef = useGridApiRef();
  const isTouchLikePointer = useMediaQuery("(pointer: coarse)");
  const isMobileViewport = useMediaQuery("(max-width:900px)");
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? 1024 : window.innerWidth
  ));
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const rowModesModelRef = useRef(rowModesModel);
  useLayoutEffect(() => {
    rowModesModelRef.current = rowModesModel;
  }, [rowModesModel]);

  useEffect(() => {
    const handleResize = (): void => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const [draftValidationWarning, setDraftValidationWarning] = useState("");
  const [unsavedRowDialogId, setUnsavedRowDialogId] = useState<GridRowId | null>(null);
  // Opening the confirm dialog over a row whose edit input still has DOM focus
  // fights MUI Modal's focus trap (it aria-hides the rest of the page while
  // that input remains focused inside the hidden subtree), which can cause the
  // dialog to be torn down again almost immediately. Blurring first avoids
  // that conflict; it doesn't discard the row's in-progress edit, since the
  // row stays in GridRowModes.Edit and MUI keeps its draft values regardless
  // of DOM focus.
  const openUnsavedRowDialog = useCallback((rowId: GridRowId): void => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setUnsavedRowDialogId(rowId);
  }, []);
  const hasInitiallyExpandedRef = useRef(false);
  const handledCreateFieldRequestRef = useRef(0);
  const rowSnapshotRef = useRef<Map<string, HierarchyRow>>(new Map());
  const pendingSameRowEditTargetRef = useRef<{ rowId: GridRowId; field: string } | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const stableScrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const stableScrollbarThumbRef = useRef<HTMLDivElement | null>(null);
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const [highlightedRowId, setHighlightedRowId] = useState<GridRowId | null>(null);
  const highlightClearTimeoutRef = useRef<number | null>(null);

  // Data fetching
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
    fetchGeneration,
  } = hierarchyData ?? internalHierarchyData;

  // Expansion state
  const {
    expandedRows,
    hasPersistedState,
    toggleExpand,
    ensureExpanded,
    expandAll,
  } = useExpandedState("fieldsBedsHierarchy");
  const { sortModel, setSortModel } = usePersistentSortModel({
    tableKey: "fieldsBedsHierarchy",
    allowedFields: ["name", "area_sqm"],
    persistInUrl: true,
  });
  const hierarchySortConfig = useMemo<HierarchySortConfig | undefined>(() => {
    const [firstSort] = sortModel;
    if (!firstSort || !firstSort.sort) {
      return undefined;
    }

    return {
      field: firstSort.field,
      direction: firstSort.sort,
    };
  }, [sortModel]);

  // Bed operations
  const { addBed, saveBed, pendingEditRow, setPendingEditRow } =
    useBedOperations(setBeds, setError, t);
  const [pendingFieldEditRow, setPendingFieldEditRow] = useState<string | number | null>(null);

  // Row order is only recomputed from the current sort field on a fresh
  // load/reload or when the user explicitly changes the sort — not on every
  // locations/fields/beds change. Otherwise creating or renaming a row would
  // immediately re-sort it to its new alphabetical/numeric position instead
  // of leaving it where the user was just working. See
  // applyHierarchyOrderSnapshot/computeHierarchyOrderSnapshot.
  const [hierarchyOrderSnapshot, setHierarchyOrderSnapshot] = useState<HierarchyOrderSnapshot>(
    () => computeHierarchyOrderSnapshot(locations, fields, beds, hierarchySortConfig),
  );
  const lastOrderedFetchGenerationRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (fetchGeneration === lastOrderedFetchGenerationRef.current) {
      return;
    }
    lastOrderedFetchGenerationRef.current = fetchGeneration;
    setHierarchyOrderSnapshot(
      computeHierarchyOrderSnapshot(locations, fields, beds, hierarchySortConfig),
    );
    // Only re-run when a fetch actually completes; locations/fields/beds and
    // hierarchySortConfig are read for their current value at that point,
    // not tracked as re-trigger sources here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchGeneration]);

  const handleHierarchySortModelChange = useCallback(
    (nextSortModel: typeof sortModel): void => {
      setSortModel(nextSortModel);
      const [nextSort] = nextSortModel;
      const nextSortConfig: HierarchySortConfig | undefined = nextSort?.sort
        ? { field: nextSort.field, direction: nextSort.sort }
        : undefined;
      setHierarchyOrderSnapshot(
        computeHierarchyOrderSnapshot(locations, fields, beds, nextSortConfig),
      );
    },
    [beds, fields, locations, setSortModel],
  );

  const orderedHierarchyEntities = useMemo(
    () => applyHierarchyOrderSnapshot(locations, fields, beds, hierarchyOrderSnapshot),
    [locations, fields, beds, hierarchyOrderSnapshot],
  );

  const hierarchyIndex = useMemo(
    () => buildHierarchyIndex(
      orderedHierarchyEntities.locations,
      orderedHierarchyEntities.fields,
      orderedHierarchyEntities.beds,
    ),
    [orderedHierarchyEntities],
  );

  const projectRows = useMemo(
    () => createHierarchyRowsProjector(hierarchyIndex),
    [hierarchyIndex],
  );

  const rows = useMemo<GridRowsProp<HierarchyRow>>(
    () => projectRows(expandedRows),
    [projectRows, expandedRows],
  );

  const hierarchyRowWindow = useHierarchyRowWindow(
    rows.length,
    // The hook balances this cap down so the last internal page is never a
    // stub: it is the page the user lands on at the end of the list, and a
    // stub there leaves the table (sized via maxPageContentHeight below)
    // mostly empty.
    HIERARCHY_GRID_PAGE_SIZE,
    HIERARCHY_VIRTUAL_SCROLLER_SELECTOR,
    tableWrapperRef,
  );

  // Stable ref so ensureRowVisibleOnPage doesn't change identity on every
  // expand/collapse (rows changes then) — same reasoning as rowsByIdRef
  // below: focusRow depends on this, and an unstable identity there would
  // re-fire the focus-restoring layout effect after every rows update.
  const rowsArrayRef = useRef(rows);
  useLayoutEffect(() => {
    rowsArrayRef.current = rows;
  }, [rows]);

  const ensureRowVisibleOnPage = useCallback((rowId: GridRowId): boolean => {
    const rowIndex = rowsArrayRef.current.findIndex((row) => String(row.id) === String(rowId));
    return hierarchyRowWindow.ensureRowIndexVisible(rowIndex);
  }, [hierarchyRowWindow]);

  const {
    expandedRowsRef,
    rowsRef,
    selectRow,
    selectRowTransient,
    selectedRowId,
    selectedRowIdRef,
    setSelectedRowId,
    setTreeActive,
    treeActive,
    treeActiveRef,
  } = useHierarchyNavigationState({
    expandedRows,
    rows,
  });

  // Delete with undo
  const {
    pendingDeletions,
    deleteHierarchyRowWithUndo,
    undoPendingDeletion,
    closePendingDeletionSnackbar,
  } = useHierarchyDelete({
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
    rowSnapshotRef,
    setRowModesModel,
    setDraftValidationWarning,
  });

  const shouldShowHierarchyTable = hierarchyIndex.hasMultipleLocations || fields.length > 0 || createFieldRequest > 0;
  const hasUsableHierarchyRows = shouldShowHierarchyTable && (
    rows.length > 0
    || locations.length > 0
    || fields.length > 0
    || beds.length > 0
  );
  const {
    showContextMenuHint,
    closeContextMenuHint,
    markContextMenuHintUsed,
    showTouchContextMenuHint,
    closeTouchContextMenuHint,
    markTouchContextMenuHintUsed,
  } = useContextMenuHint({
    contextKey: "fieldsBeds",
    enabled: !suppressContextMenuHint,
    isLoading: loading,
    hasRows: hasUsableHierarchyRows,
  });

  const {
    contextMenuState,
    openContextMenuForRow,
    handleNameCellContextMenu,
    handleGridContextMenu,
    handleGridTouchStart,
    handleGridTouchMove,
    handleGridTouchEnd,
    closeContextMenu,
    contextMenuListRef,
  } = useHierarchyContextMenu({
    rows: rows as HierarchyRow[],
    markContextMenuHintUsed,
    markTouchContextMenuHintUsed,
    setSelectedRowId,
    setTreeActive,
  });

  const rowsById = useMemo(() => {
    const nextRowsById = new Map<string, HierarchyRow>();
    rows.forEach((row) => nextRowsById.set(String(row.id), row));
    return nextRowsById;
  }, [rows]);

  const rememberRowSnapshot = useCallback((rowId: GridRowId): void => {
    const rowKey = String(rowId);
    if (rowSnapshotRef.current.has(rowKey)) {
      return;
    }

    const row = rowsById.get(rowKey);
    if (row) {
      rowSnapshotRef.current.set(rowKey, row);
    }
  }, [rowsById]);

  const getDraftRow = useCallback((rowId: GridRowId): HierarchyRow | null => {
    const api = gridApiRef.current;
    const draftRow = api?.getRowWithUpdatedValues?.(rowId, "") as HierarchyRow | null | undefined;
    return draftRow ?? rowsById.get(String(rowId)) ?? null;
  }, [gridApiRef, rowsById]);

  const {
    discardRowEdit,
    exitToViewPreservingDraft,
    processRowUpdate,
    handleProcessRowUpdateError,
  } = useHierarchyRowUpdate({
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
    onUnsavedMissingName: openUnsavedRowDialog,
    setError,
    setDraftValidationWarning,
    fetchData,
    saveBed,
    t,
  });

  const isUnsavedOrEditingHierarchyRow = useCallback((row: HierarchyRow): boolean => (
    row.isNew === true
    || rowModesModelRef.current[row.id]?.mode === GridRowModes.Edit
    || rowModesModelRef.current[String(row.id)]?.mode === GridRowModes.Edit
    || (row.type === "bed" && typeof row.bedId === "number" && row.bedId < 0)
    || (row.type === "field" && typeof row.fieldId === "number" && row.fieldId < 0)
  ), []);

  const saveHierarchyRowDraftWithNotes = useCallback(async (
    row: HierarchyRow,
    notesValue: string,
  ): Promise<HierarchyRow> => {
    const draftRow = getDraftRow(row.id) ?? row;
    const savedRow = await processRowUpdate({
      ...draftRow,
      notes: notesValue,
    });

    if (
      rowModesModelRef.current[row.id]?.mode === GridRowModes.Edit
      || rowModesModelRef.current[String(row.id)]?.mode === GridRowModes.Edit
    ) {
      setRowModesModel((previousModel) => ({
        ...previousModel,
        [row.id]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
    }

    return savedRow;
  }, [getDraftRow, processRowUpdate]);

  // Notes editor - must be after rows definition
  const notesEditor = useNotesEditor<HierarchyRow>({
    rows,
    onSave: async ({ row, value }) => {
      if (isUnsavedOrEditingHierarchyRow(row)) {
        await saveHierarchyRowDraftWithNotes(row, value);
        return;
      }

      if (!row.name) {
        throw new Error(t("validation.nameRequired"));
      }

      const parsedArea = parseAreaValue(row.area_sqm);

      if (row.type === "bed" && row.bedId) {
        // Save bed with notes
        await bedAPI.update(row.bedId, {
          name: row.name,
          field: row.field!,
          area_sqm: normalizeAreaValue(parsedArea),
          length_m: parseDimensionValue(row.length_m),
          width_m: parseDimensionValue(row.width_m),
          notes: value,
        });

        // Update local state
        setBeds((prev) =>
          prev.map((b) => (b.id === row.bedId ? { ...b, notes: value } : b)),
        );
      } else if (row.type === "field" && row.fieldId) {
        // Save field with notes
        await fieldAPI.update(row.fieldId, {
          name: row.name,
          location: row.locationId!,
          area_sqm: normalizeAreaValue(parsedArea),
          length_m: parseDimensionValue(row.length_m),
          width_m: parseDimensionValue(row.width_m),
          notes: value,
        });

        // Update local state
        setFields((prev) =>
          prev.map((f) => (f.id === row.fieldId ? { ...f, notes: value } : f)),
        );
      } else if (row.type === "location" && row.locationId) {
        const locationItem = locations.find((l) => l.id === row.locationId);
        if (!locationItem) return;

        await locationAPI.update(row.locationId, { ...locationItem, notes: value });

        setLocations((prev) =>
          prev.map((l) => (l.id === row.locationId ? { ...l, notes: value } : l)),
        );
      }
    },
    onError: setError,
  });

  /**
   * Expand all rows when data is loaded (only once on initial load).
   *
   * Below HIERARCHY_AUTO_EXPAND_ALL_THRESHOLD combined entities, this fully
   * expands the tree (locations and fields, revealing every bed) — the
   * long-standing default. Above it, only locations are expanded, leaving
   * fields (and their beds) collapsed, so opening a very large project shows
   * a scannable top-level overview instead of a wall of thousands of rows.
   * Single-location projects render fields as root rows (see
   * hierarchyTreeNodes below), so they're always visible regardless of this
   * threshold — only their bed children are affected.
   */
  useEffect(() => {
    if (
      !hasPersistedState &&
      !hasInitiallyExpandedRef.current &&
      locations.length > 0 &&
      fields.length > 0
    ) {
      const canFullyExpand =
        locations.length + fields.length + beds.length <= HIERARCHY_AUTO_EXPAND_ALL_THRESHOLD;
      const allRowIds = new Set<string | number>();

      // Add all location IDs
      locations.forEach((location) => {
        allRowIds.add(`location-${location.id}`);
      });

      if (canFullyExpand) {
        // Add all field IDs
        fields.forEach((field) => {
          allRowIds.add(`field-${field.id}`);
        });
      }

      expandAll(Array.from(allRowIds));
      hasInitiallyExpandedRef.current = true;
    }
  }, [beds.length, expandAll, fields, hasPersistedState, locations]);

  // Flat {id, parentId} view of the tree for the shared expand/collapse-one-
  // level toggle, embedded in the "Name" column header below (see
  // HierarchyLevelButtons / useHierarchyLevelToggle).
  // Single-location projects render without a location row at all (see
  // buildHierarchyRowsFromIndex), so the location level is only included
  // here when there's more than one — the control then offers 2 levels
  // (Parzelle/Beet) instead of 3.
  const hasMultipleLocations = locations.length > 1;
  const hierarchyTreeNodes = useMemo<TreeRowNode[]>(() => {
    const nodes: TreeRowNode[] = [];

    if (hasMultipleLocations) {
      locations.forEach((location) => {
        if (!hasPersistedEntityId(location.id)) return;
        nodes.push({ id: `location-${location.id}`, parentId: null });
      });
    }

    fields.forEach((field) => {
      if (!hasPersistedEntityId(field.id)) return;
      nodes.push({
        id: `field-${field.id}`,
        parentId: hasMultipleLocations ? `location-${field.location}` : null,
      });
    });

    beds.forEach((bed) => {
      if (!hasPersistedEntityId(bed.id) || !hasPersistedEntityId(bed.field)) return;
      nodes.push({ id: bed.id, parentId: `field-${bed.field}` });
    });

    return nodes;
  }, [beds, fields, hasMultipleLocations, locations]);

  const hierarchyLevelToggle = useHierarchyLevelToggle(hierarchyTreeNodes, expandedRows, expandAll);

  /**
   * Handle pending edit mode after rows are updated
   */
  useEffect(() => {
    if (pendingEditRow !== null) {
      // Check if the row exists in the current rows
      const rowExists = rows.some((r) => r.id === pendingEditRow);
      if (rowExists) {
        const rowId = pendingEditRow;
        setTimeout(() => {
          setRowModesModel((oldModel) => ({
            ...oldModel,
            [rowId]: { mode: GridRowModes.Edit, fieldToFocus: "name" },
          }));
          setPendingEditRow(null);
        }, 0);
      }
    }
  }, [rows, pendingEditRow, setPendingEditRow]);

  useEffect(() => {
    if (pendingFieldEditRow === null) {
      return;
    }

    const rowExists = rows.some((row) => row.id === pendingFieldEditRow);
    if (!rowExists) {
      return;
    }

    const rowId = pendingFieldEditRow;
    setTimeout(() => {
      setRowModesModel((oldModel) => ({
        ...oldModel,
        [rowId]: { mode: GridRowModes.Edit, fieldToFocus: "name" },
      }));
      setPendingFieldEditRow(null);
    }, 0);
  }, [pendingFieldEditRow, rows]);

  const handleAddField = useCallback(
    (locationId: number): void => {
      const locationItem = locations.find((item) => item.id === locationId);
      if (!locationItem) return;

      const newFieldId = -Date.now();
      const newField: Field = {
        id: newFieldId,
        name: "",
        location: locationId,
        area_sqm: undefined,
        length_m: null,
        width_m: null,
        notes: "",
      };

      ensureExpanded(`location-${locationId}`);
      setFields((previousFields) => [newField, ...previousFields]);
      setPendingFieldEditRow(`field-${newFieldId}`);
    },
    [ensureExpanded, locations, setFields],
  );

  const handleAddBed = useCallback(
    (fieldId: number): void => {
      const field = fields.find((f) => f.id === fieldId);
      if (!field) return;

      const fieldKey = `field-${fieldId}`;
      ensureExpanded(fieldKey);

      const newBedId = addBed(fieldId);

      setPendingEditRow(newBedId); //will be applied after re-render
    },
    [addBed, ensureExpanded, fields, setPendingEditRow],
  );

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
      handleAddBed(firstField.id);
    }

    searchParams.delete("createBed");
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [fields, handleAddBed, loading, location.pathname, location.search, navigate]);

  useEffect(() => () => {
    if (highlightClearTimeoutRef.current !== null) {
      window.clearTimeout(highlightClearTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (
      createFieldRequest <= 0
      || loading
      || createFieldRequest <= handledCreateFieldRequestRef.current
    ) {
      return;
    }

    const hasActiveFieldDraft = fields.some((field) => typeof field.id === "number" && field.id < 0);
    const firstLocation = locations.find((locationItem) => locationItem.id !== undefined);
    const firstLocationId = firstLocation?.id;
    if (!hasActiveFieldDraft && firstLocationId === undefined) {
      return;
    }

    handledCreateFieldRequestRef.current = createFieldRequest;
    if (!hasActiveFieldDraft && firstLocationId !== undefined) {
      handleAddField(firstLocationId);
    }
    onCreateFieldRequestHandled?.();
  }, [createFieldRequest, fields, handleAddField, loading, locations, onCreateFieldRequestHandled]);

  const handleCreatePlantingPlan = useCallback(
    (bedId: number): void => {
      navigate(`/app/planting-plans?bedId=${bedId}`);
    },
    [navigate],
  );

  const isHierarchyCellAction = useCallback((params: GridCellParams<HierarchyRow>): boolean => (
    params.field === "notes"
  ), []);

  const isCellEditable = useCallback((params: { row: HierarchyRow; field: string }) => {
    if (params.row.type === "location") {
      return params.field === "name";
    }
    if (params.row.type === "field" || params.row.type === "bed") {
      return (
        params.field === "name" ||
        params.field === "length_m" ||
        params.field === "width_m"
      );
    }
    return false;
  }, []);

  const isHierarchyCellFocusable = useCallback((row: HierarchyRow, field: string): boolean => (
    field === "notes"
    || isCellEditable({ row, field })
  ), [isCellEditable]);

  // Stable ref so getHierarchyFocusableField doesn't change on every expand/collapse.
  // If it did, focusRow → focusSelectedCell → useLayoutEffect would re-fire after each
  // rows update and re-focus selectedRowId STATE instead of the arrow-navigated row.
  const rowsByIdRef = useRef(rowsById);
  useLayoutEffect(() => {
    rowsByIdRef.current = rowsById;
  }, [rowsById]);

  const getHierarchyFocusableField = useCallback((rowId: GridRowId, preferredField: string): string | null => {
    const row = rowsByIdRef.current.get(String(rowId));
    if (!row) {
      return null;
    }

    const focusableFields = row.type === "location"
      ? ["name", "notes"]
      : ["name", "length_m", "width_m", "notes"];
    return focusableFields.includes(preferredField) ? preferredField : focusableFields[0] ?? null;
  }, []);

  const {
    applyOrReapplyPostEditFocus,
    focusRow,
    preFocusEditCell,
    queuePostEditFocus,
    rememberFocusedField,
  } = useHierarchyGridFocus({
    getFocusableField: getHierarchyFocusableField,
    gridApiRef,
    rowModesModel,
    rows,
    selectRow,
    selectedRowId,
    treeActive,
    ensureRowVisible: ensureRowVisibleOnPage,
  });

  const getPostEnterSaveFocusTarget = useCallback((rowId: GridRowId): GridRowId => {
    const currentIndex = rows.findIndex((row) => String(row.id) === String(rowId));
    if (currentIndex < 0) {
      return rowId;
    }

    for (let index = currentIndex + 1; index < rows.length; index += 1) {
      const nextRow = rows[index];
      if (getHierarchyFocusableField(nextRow.id, "name")) {
        return nextRow.id;
      }
    }

    return rowId;
  }, [getHierarchyFocusableField, rows]);

  const handleHierarchyRowEditStop = useCallback<GridEventListener<"rowEditStop">>((params, event): void => {
    if (params.reason === GridRowEditStopReasons.escapeKeyDown) {
      event.defaultMuiPrevented = true;
      discardRowEdit(params.id);
      return;
    }

    if (
      params.reason === GridRowEditStopReasons.enterKeyDown ||
      params.reason === GridRowEditStopReasons.tabKeyDown ||
      params.reason === GridRowEditStopReasons.shiftTabKeyDown
    ) {
      if (params.reason === GridRowEditStopReasons.enterKeyDown) {
        queuePostEditFocus(getPostEnterSaveFocusTarget(params.id), undefined, params.id);
      }
      preFocusEditCell(params.id);
    }
  }, [discardRowEdit, getPostEnterSaveFocusTarget, preFocusEditCell, queuePostEditFocus]);

  const activateFirstRowForKeyboard = useCallback((rowId: GridRowId): void => {
    selectedRowIdRef.current = rowId;
    treeActiveRef.current = true;
    setSelectedRowId(rowId);
    setTreeActive(true);
    focusRow(rowId, "name");
  }, [focusRow, selectedRowIdRef, setSelectedRowId, setTreeActive, treeActiveRef]);

  const selectRowForKeyboard = useCallback((rowId: GridRowId): void => {
    selectRowTransient(rowId);
    focusRow(rowId);
  }, [focusRow, selectRowTransient]);

  // Consumes a `?highlight=location:<id>|field:<id>|bed:<id>` deep link (e.g.
  // from the Gantt calendar's "Standort/Parzelle/Beet öffnen" context menu
  // actions): expands the ancestor chain so the target row is visible,
  // scrolls it into view, makes it the active row for keyboard nav (reusing
  // activateFirstRowForKeyboard/focusRow above instead of touching the grid
  // API directly), and flashes it briefly so the user can find it.
  useEffect(() => {
    if (!location.pathname.startsWith("/app/fields-beds")) {
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    const highlightParam = searchParams.get("highlight");
    if (!highlightParam || loading) {
      return;
    }

    const [highlightType, highlightIdRaw] = highlightParam.split(":");
    const highlightId = Number(highlightIdRaw);

    let targetRowId: GridRowId | null = null;
    let locationIdToExpand: number | undefined;
    let fieldIdToExpand: number | undefined;

    if (Number.isFinite(highlightId)) {
      if (highlightType === "location") {
        targetRowId = `location-${highlightId}`;
      } else if (highlightType === "field") {
        const field = fields.find((entry) => entry.id === highlightId);
        targetRowId = `field-${highlightId}`;
        locationIdToExpand = field?.location;
      } else if (highlightType === "bed") {
        const bed = beds.find((entry) => entry.id === highlightId);
        const field = bed ? fields.find((entry) => entry.id === bed.field) : undefined;
        targetRowId = highlightId;
        fieldIdToExpand = bed?.field;
        locationIdToExpand = field?.location;
      }
    }

    if (targetRowId !== null) {
      if (locationIdToExpand !== undefined) {
        ensureExpanded(`location-${locationIdToExpand}`);
      }
      if (fieldIdToExpand !== undefined) {
        ensureExpanded(`field-${fieldIdToExpand}`);
      }

      setHighlightedRowId(targetRowId);

      // Expansion needs a render pass before the target row exists in the
      // DataGrid's virtualized viewport.
      requestAnimationFrame(() => {
        const scrollAndFocus = (): void => {
          const api = gridApiRef.current;
          if (!api) return;
          const rowIndex = api.getRowIndexRelativeToVisibleRows(targetRowId!);
          if (typeof rowIndex === "number" && rowIndex >= 0) {
            api.scrollToIndexes({ rowIndex });
          }
          activateFirstRowForKeyboard(targetRowId!);
        };

        // On very large hierarchies (see useHierarchyRowWindow), the target
        // row may be on a page that isn't displayed yet — page there first
        // and wait one more frame before touching the grid API.
        if (ensureRowVisibleOnPage(targetRowId!)) {
          requestAnimationFrame(scrollAndFocus);
        } else {
          scrollAndFocus();
        }
      });

      if (highlightClearTimeoutRef.current !== null) {
        window.clearTimeout(highlightClearTimeoutRef.current);
      }
      highlightClearTimeoutRef.current = window.setTimeout(() => {
        setHighlightedRowId(null);
        highlightClearTimeoutRef.current = null;
      }, 2500);
    }

    searchParams.delete("highlight");
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [activateFirstRowForKeyboard, beds, ensureExpanded, ensureRowVisibleOnPage, fields, gridApiRef, loading, location.pathname, location.search, navigate]);

  const handleHierarchyProcessRowUpdate = useCallback(
    async (newRow: HierarchyRow): Promise<HierarchyRow> => {
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const preferredField = activeElement
        ?.closest('[role="gridcell"]')
        ?.getAttribute("data-field") ?? undefined;
      if (preferredField) {
        rememberFocusedField(preferredField);
      }
      queuePostEditFocus(getPostEnterSaveFocusTarget(newRow.id), preferredField, newRow.id);

      let savedRow: HierarchyRow;
      try {
        savedRow = await processRowUpdate(newRow);
      } catch (err) {
        throw tagHierarchyRowUpdateError(err, newRow.id);
      }
      const savedRowIdChanged = String(savedRow.id) !== String(newRow.id);
      const pendingTarget = pendingSameRowEditTargetRef.current;
      if (pendingTarget && String(pendingTarget.rowId) === String(newRow.id)) {
        pendingSameRowEditTargetRef.current = null;
      }

      if (savedRowIdChanged && pendingTarget && String(pendingTarget.rowId) === String(newRow.id)) {
        const fieldToFocus = pendingTarget.field;
        rememberFocusedField(fieldToFocus);
        queuePostEditFocus(savedRow.id, fieldToFocus, newRow.id);
        setRowModesModel((previousModel) => {
          const nextModel = { ...previousModel };
          delete nextModel[newRow.id];
          delete nextModel[String(newRow.id)];
          nextModel[savedRow.id] = { mode: GridRowModes.Edit, fieldToFocus };
          return nextModel;
        });
        selectRow(savedRow.id);
        return savedRow;
      }

      // MUI's own onRowModesModelChange usually flips this row to View (and our
      // rowModesModel layout effect already restores focus onto the queued target)
      // well before this async save resolves. Only re-anchor and re-apply View mode
      // here if that hasn't happened yet — otherwise this would yank focus back onto
      // the just-saved row for an instant, causing a visible focus flash/flicker.
      if (rowModesModelRef.current[newRow.id]?.mode === GridRowModes.Edit) {
        preFocusEditCell(newRow.id);
        setRowModesModel((previousModel) => ({
          ...previousModel,
          [newRow.id]: { mode: GridRowModes.View, ignoreModifications: true },
        }));
      }
      window.setTimeout(() => {
        applyOrReapplyPostEditFocus(newRow.id);
      }, 0);
      return savedRow;
    },
    [
      applyOrReapplyPostEditFocus,
      getPostEnterSaveFocusTarget,
      preFocusEditCell,
      processRowUpdate,
      queuePostEditFocus,
      rememberFocusedField,
      selectRow,
    ],
  );

  const rememberSameRowEditTargetFromElement = useCallback((target: EventTarget | null): void => {
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const cell = target.closest<HTMLElement>('[role="gridcell"][data-field]');
    const row = target.closest<HTMLElement>('[role="row"][data-id]');
    const rowId = row?.dataset.id;
    const field = cell?.dataset.field;
    if (!rowId || !field) {
      return;
    }

    const currentMode = rowModesModelRef.current[rowId];
    const rowData = rowsByIdRef.current.get(rowId);
    const activeCell = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[role="gridcell"][data-field]')
      : null;
    const activeRow = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[role="row"][data-id]')
      : null;
    if (
      currentMode?.mode !== GridRowModes.Edit
      || !rowData?.isNew
      || activeRow?.dataset.id !== rowId
      || activeCell?.dataset.field === field
    ) {
      return;
    }

    const cellParams = gridApiRef.current?.getCellParams?.(rowId, field);
    if (!cellParams || !gridApiRef.current?.isCellEditable?.(cellParams)) {
      return;
    }

    pendingSameRowEditTargetRef.current = { rowId, field };
  }, [gridApiRef]);

  const rememberSameRowPointerEditTarget = useCallback((event: React.PointerEvent<HTMLElement>): void => {
    if (event.pointerType === "touch" && event.isPrimary === false) {
      return;
    }
    if (event.pointerType !== "touch" && event.button !== 0) {
      return;
    }

    rememberSameRowEditTargetFromElement(event.target);
  }, [rememberSameRowEditTargetFromElement]);

  const rememberSameRowTouchEditTarget = useCallback((event: React.TouchEvent<HTMLElement>): void => {
    if (event.touches.length > 1) {
      return;
    }

    rememberSameRowEditTargetFromElement(event.target);
  }, [rememberSameRowEditTargetFromElement]);

  const handleReadOnlyHierarchyCellMouseDown = useCallback((event: React.MouseEvent<HTMLElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (isInteractiveCellTarget(target)) {
      return;
    }

    const cellElement = target.closest<HTMLElement>('[role="gridcell"][data-field]');
    const rowElement = target.closest<HTMLElement>('[role="row"][data-id]');
    const field = cellElement?.dataset.field;
    const rowId = rowElement?.dataset.id;
    if (!field || rowId === undefined) {
      return;
    }

    const row = rowsById.get(String(rowId));
    if (!row || isHierarchyCellFocusable(row, field)) {
      return;
    }

    preventReadOnlyCellMouseFocus(event);
  }, [isHierarchyCellFocusable, rowsById]);

  // Read the current row from refs at call time so these callbacks are stable
  // and don't trigger re-renders of areaCommands on every navigation keypress.
  const handleDeleteSelected = useCallback(() => {
    const row = rowsRef.current.find((r) => r.id === selectedRowIdRef.current);
    if (!row) return;
    if (row.type === "location" || row.type === "field" || row.type === "bed") {
      void deleteHierarchyRowWithUndo(row);
    }
  }, [deleteHierarchyRowWithUndo, rowsRef, selectedRowIdRef]);

  const handleCreateBySelection = useCallback(() => {
    const row = rowsRef.current.find((r) => r.id === selectedRowIdRef.current);
    if (!row) return;
    if (row.type === "location" && row.locationId) {
      handleAddField(row.locationId);
      return;
    }
    if (row.type === "field" && row.fieldId) {
      handleAddBed(row.fieldId);
      return;
    }
    if (row.type === "bed" && row.field) {
      handleAddBed(row.field);
    }
  }, [handleAddBed, handleAddField, rowsRef, selectedRowIdRef]);

  const handleEditSelected = useCallback(() => {
    const row = rowsRef.current.find((r) => r.id === selectedRowIdRef.current);
    if (!row) return;
    rememberRowSnapshot(row.id);
    setRowModesModel((previous) => ({
      ...previous,
      [row.id]: { mode: GridRowModes.Edit, fieldToFocus: "name" },
    }));
  }, [rememberRowSnapshot, rowsRef, selectedRowIdRef]);

  const getHierarchyRowActions = useCallback((row: HierarchyRow): HierarchyRowAction[] => {
    const createActions: HierarchyRowAction[] = [];

    if (row.type === "location" && row.locationId) {
      createActions.push({
        id: "add-field",
        label: t("actions.addField"),
        group: "create",
        onClick: () => handleAddField(row.locationId!),
        emphasized: true,
        icon: <HierarchyAddIcon interactive={false} ariaHidden />,
        shortcutHint: t("actions.addShortcutHint"),
      });
    }

    if (row.type === "field" && row.fieldId) {
      createActions.push({
        id: "add-bed",
        label: t("actions.addBed"),
        group: "create",
        onClick: () => handleAddBed(row.fieldId!),
        emphasized: true,
        icon: <HierarchyAddIcon interactive={false} ariaHidden />,
        shortcutHint: t("actions.addShortcutHint"),
      });
    }

    if (row.type === "bed" && row.bedId) {
      createActions.push({
        id: "create-planting-plan",
        label: t("createPlantingPlan"),
        group: "create",
        icon: <AgricultureIcon fontSize="small" />,
        onClick: () => handleCreatePlantingPlan(row.bedId!),
      });
    }

    const destructiveActions: HierarchyRowAction[] = [{
      id: "delete",
      label: t("common:actions.delete"),
      group: "destructive",
      color: "error",
      icon: <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />,
      onClick: () => {
        void deleteHierarchyRowWithUndo(row);
      },
    }];

    return [...createActions, ...destructiveActions];
  }, [
    deleteHierarchyRowWithUndo,
    handleAddBed,
    handleAddField,
    handleCreatePlantingPlan,
    t,
  ]);

  const areaCommands = useMemo<CommandSpec[]>(
    () => [
      {
        id: "areas.create",
        label: t("hierarchy:commands.create"),
        group: 'navigation',
      keywords: keywordList(t, "hierarchy:commands.keywords.create"),
                        contextTags: ["areas"],
        isEnabled: () => selectedRowIdRef.current !== null,
        action: handleCreateBySelection,
      },
      {
        id: "areas.edit",
        label: t("common:actions.edit"),
        group: 'navigation',
      keywords: keywordList(t, "hierarchy:commands.keywords.edit"),
        contextTags: ["areas"],
        isEnabled: () => {
          const row = rowsRef.current.find((r) => r.id === selectedRowIdRef.current);
          return row !== undefined && row.type !== "location";
        },
        action: handleEditSelected,
      },
      {
        id: "areas.delete",
        label: t("hierarchy:commands.delete"),
        group: 'navigation',
      keywords: keywordList(t, "hierarchy:commands.keywords.delete"),
                keys: { key: "Delete" },
        contextTags: ["areas"],
        isEnabled: () => selectedRowIdRef.current !== null,
        action: handleDeleteSelected,
      },
    ],
    [handleCreateBySelection, handleDeleteSelected, handleEditSelected, rowsRef, selectedRowIdRef, t],
  );

  useRegisterCommands("areas-page", areaCommands);

  // A real save attempt (MUI's stopRowEditMode -> processRowUpdate) never
  // actually reaches processRowUpdate for a row with an empty required
  // "name" cell: the name column's preProcessEditCellProps marks that cell
  // `error: true`, and MUI's own row-editing machinery silently refuses to
  // exit edit mode for a row with an errored cell - it never calls
  // processRowUpdate at all. So any code path that wants to end a row's edit
  // session (clicking outside the grid, clicking into a different row) has
  // to pre-check for this itself instead of just asking MUI to save: a
  // still-blank draft is discarded silently (nothing was entered, nothing to
  // confirm), a nameless-but-partially-filled draft asks the user via a
  // confirm dialog instead of silently discarding or straining the row in
  // edit mode, and anything else goes through MUI's real save (matching
  // normal click-away-to-save UX and avoiding silent data loss).
  const stopRowEditModeSafely = useCallback((rowId: GridRowId): void => {
    const draftRow = getDraftRow(rowId);
    if (draftRow && isCompletelyEmptyNewHierarchyRow(draftRow)) {
      discardRowEdit(rowId);
      return;
    }
    if (draftRow && isPartiallyFilledNamelessNewHierarchyRow(draftRow)) {
      exitToViewPreservingDraft(rowId, draftRow);
      openUnsavedRowDialog(rowId);
      return;
    }
    gridApiRef.current?.stopRowEditMode({ id: rowId });
  }, [discardRowEdit, exitToViewPreservingDraft, getDraftRow, gridApiRef, openUnsavedRowDialog]);

  // Clicking outside the grid while a row is being edited doesn't go through MUI's
  // own cell-focus-out handling (that only fires when focus moves to another grid
  // cell), so the row is neither saved nor discarded by default without this.
  const handleClickOutsideGrid = useCallback((): void => {
    const editingRowId = Object.entries(rowModesModel).find(
      ([, mode]) => mode.mode === GridRowModes.Edit,
    )?.[0];
    if (editingRowId === undefined) return;
    const rowId = rowsById.get(editingRowId)?.id ?? editingRowId;
    stopRowEditModeSafely(rowId);
  }, [rowModesModel, rowsById, stopRowEditModeSafely]);

  const handleContinueEditingUnsavedRow = useCallback((): void => {
    const rowId = unsavedRowDialogId;
    setUnsavedRowDialogId(null);
    if (rowId === null) return;
    // Only one row can be in edit mode at a time - clicking into a different
    // row while this one had unsaved changes is what triggered the dialog in
    // the first place, so returning to this row means giving up that other
    // row's (never-persisted) in-progress edit.
    setRowModesModel((previousModel) => {
      const nextModel: GridRowModesModel = {};
      Object.entries(previousModel).forEach(([id, mode]) => {
        nextModel[id] = mode.mode === GridRowModes.Edit && String(id) !== String(rowId)
          ? { mode: GridRowModes.View, ignoreModifications: true }
          : mode;
      });
      nextModel[rowId] = { mode: GridRowModes.Edit, fieldToFocus: "name" };
      return nextModel;
    });
    focusRow(rowId, "name");
  }, [focusRow, setRowModesModel, unsavedRowDialogId]);

  const handleDiscardUnsavedRow = useCallback((): void => {
    const rowId = unsavedRowDialogId;
    setUnsavedRowDialogId(null);
    if (rowId === null) return;
    discardRowEdit(rowId, { force: true });
  }, [discardRowEdit, unsavedRowDialogId]);

  useHierarchyKeyboard({
    contextMenuState,
    treeActiveRef,
    tableWrapperRef,
    rowsRef,
    selectedRowIdRef,
    expandedRowsRef,
    activateFirstRow: activateFirstRowForKeyboard,
    selectRow: selectRowForKeyboard,
    setTreeActive,
    toggleExpand,
    discardActiveRowEdit: handleClickOutsideGrid,
    openContextMenuForRow,
    onInsertShortcut: handleCreateBySelection,
  });

  const nameColumnWidth = useMemo(() => {
    const hierarchyEntries: HierarchyNameMeasureEntry[] = [];
    if (hierarchyIndex.hasMultipleLocations) {
      hierarchyIndex.sortedLocations.forEach((location) => {
        hierarchyEntries.push({ name: location.name, level: 0, type: "location" });
        const locationFields =
          hierarchyIndex.fieldsByLocation.get(location.id!) ?? [];
        locationFields.forEach((field) => {
          hierarchyEntries.push({ name: field.name, level: 1, type: "field" });
          const fieldBeds = hierarchyIndex.bedsByField.get(field.id!) ?? [];
          fieldBeds.forEach((bed) => {
            hierarchyEntries.push({ name: bed.name, level: 2, type: "bed" });
          });
        });
      });
    } else {
      hierarchyIndex.sortedTopLevelFields.forEach((field) => {
        hierarchyEntries.push({ name: field.name, level: 0, type: "field" });
        const fieldBeds = hierarchyIndex.bedsByField.get(field.id!) ?? [];
        fieldBeds.forEach((bed) => {
          hierarchyEntries.push({ name: bed.name, level: 1, type: "bed" });
        });
      });
    }

    const measuredTextWidths = measureHierarchyNameTextWidths(hierarchyEntries);
    return calculateHierarchyNameColumnWidth(
      hierarchyEntries,
      (row) => measuredTextWidths.get(getHierarchyNameMeasureKey(row)) ?? 0,
    );
  }, [hierarchyIndex]);
  const showPersistentContextMenuButton = isTouchLikePointer || isMobileViewport;
  const effectiveNameColumnWidth = useMemo(() => {
    if (!showPersistentContextMenuButton) {
      return nameColumnWidth;
    }

    const visibleMobileNameWidth = Math.max(260, viewportWidth - 88);
    return Math.min(nameColumnWidth, visibleMobileNameWidth);
  }, [nameColumnWidth, showPersistentContextMenuButton, viewportWidth]);

  const handleContextMenuButtonOpen = useCallback((row: HierarchyRow, origin: HTMLElement): void => {
    const rect = origin.getBoundingClientRect();
    window.setTimeout(() => {
      openContextMenuForRow(row, rect.right - 8, rect.top + 12, origin, {
        markHint: false,
      });
    }, 0);
  }, [openContextMenuForRow]);

  /**
   * Create columns with callbacks
   */
  const columns = useMemo(() => {
    return createHierarchyColumns(
      toggleExpand,
      handleAddBed,
      (bedId) => {
        const row = rowsById.get(String(bedId));
        if (row) {
          void deleteHierarchyRowWithUndo(row);
        }
      },
      (locationId) => {
        if (locationId === undefined) {
          return;
        }
        handleAddField(locationId);
      },
      (fieldId) => {
        const row = rowsById.get(`field-${fieldId}`);
        if (row) {
          void deleteHierarchyRowWithUndo(row);
        }
      },
      (locationId) => {
        const row = rowsById.get(`location-${locationId}`);
        if (row) {
          void deleteHierarchyRowWithUndo(row);
        }
      },
      handleCreatePlantingPlan,
      handleNameCellContextMenu,
      notesEditor.handleOpen,
      t,
      {
        ...DEFAULT_HIERARCHY_COLUMN_WIDTHS,
        name: effectiveNameColumnWidth,
      },
      {
        disableInlineHoverActions: showPersistentContextMenuButton,
        onOpenContextMenuFromButton: handleContextMenuButtonOpen,
        showPersistentContextMenuButton,
        // Embedded directly in the "Name" column header instead of a
        // dedicated row above the table (see HierarchyLevelButtons).
        // Desktop-only, matching the toggle's previous placement.
        levelToggle: isMobileViewport ? undefined : {
          canExpand: hierarchyLevelToggle.canExpand,
          canCollapse: hierarchyLevelToggle.canCollapse,
          onExpandOneLevel: hierarchyLevelToggle.expandOneLevel,
          onCollapseOneLevel: hierarchyLevelToggle.collapseOneLevel,
        },
      },
    );
  }, [
    toggleExpand,
    handleAddBed,
    handleAddField,
    deleteHierarchyRowWithUndo,
    handleCreatePlantingPlan,
    handleNameCellContextMenu,
    handleContextMenuButtonOpen,
    notesEditor.handleOpen,
    rowsById,
    t,
    effectiveNameColumnWidth,
    showPersistentContextMenuButton,
    isMobileViewport,
    hierarchyLevelToggle.canExpand,
    hierarchyLevelToggle.canCollapse,
    hierarchyLevelToggle.expandOneLevel,
    hierarchyLevelToggle.collapseOneLevel,
  ]);

  const {
    handleCellClick: handleHierarchyCellClick,
    handleCellKeyDown: handleHierarchyCellKeyDown,
  } = useHierarchyGridKeyboard({
    columns,
    deferCrossRowEditOnClick: isTouchLikePointer,
    discardRowEdit,
    gridApiRef,
    isCellFocusable: isHierarchyCellFocusable,
    isHierarchyCellAction,
    notesEditor,
    openContextMenuForRow,
    rememberFocusedField,
    rememberRowSnapshot,
    rowModesModel,
    rows: rows as HierarchyRow[],
    rowsById,
    selectRow,
    setRowModesModel,
    setTreeActive,
    stopEditingRow: stopRowEditModeSafely,
    toggleExpand,
  });

  const rowHeightForType = useCallback((row: HierarchyRow) => {
    if (row.type === "location") {
      return LOCATION_ROW_HEIGHT;
    }
    if (row.type === "field") {
      return FIELD_ROW_HEIGHT;
    }
    return BED_ROW_HEIGHT;
  }, []);

  const getRowHeight = useCallback((params: GridRowHeightParams) => (
    rowHeightForType(params.model as HierarchyRow)
  ), [rowHeightForType]);

  // Per-row heights for every currently visible row (all pages, not just the
  // one internally loaded via useHierarchyRowWindow) — feeds the exact
  // cumulative offsets useHierarchyStableScrollbar needs to keep the
  // scrollbar's thumb stable across page transitions.
  const rowHeights = useMemo(
    () => rows.map((row) => rowHeightForType(row as HierarchyRow)),
    [rows, rowHeightForType],
  );

  // Exact height the grid would need to show every current row without its
  // own scrollbar. Combined with availableTableHeight (measured below) via
  // Math.min, this lets the table size snugly to its content for small
  // hierarchies while filling the available viewport height (and internally
  // scrolling/virtualizing) for large ones — instead of always reserving a
  // fixed max height regardless of how much screen space is actually there.
  const tableContentHeight = useMemo(
    () => HEADER_ROW_HEIGHT + rowHeights.reduce((sum, height) => sum + height, 0),
    [rowHeights],
  );

  // Height needed for the *tallest* internal page (see useHierarchyRowWindow),
  // not for the page currently loaded. Capping it with availableTableHeight
  // still lets a small hierarchy size snugly to its content, while a large one
  // keeps one height for every page: sizing to the current page collapsed the
  // whole table the moment the user scrolled onto a short last page. Row
  // heights differ per type (Standort/Parzelle/Beet), so the pages are summed
  // rather than derived from the page size.
  const maxPageContentHeight = useMemo(() => {
    const { pageSize } = hierarchyRowWindow;
    let tallestPageRowHeight = 0;
    for (let startIndex = 0; startIndex < rowHeights.length; startIndex += pageSize) {
      const endIndex = Math.min(startIndex + pageSize, rowHeights.length);
      let pageRowHeight = 0;
      for (let i = startIndex; i < endIndex; i += 1) {
        pageRowHeight += rowHeights[i];
      }
      tallestPageRowHeight = Math.max(tallestPageRowHeight, pageRowHeight);
    }
    return HEADER_ROW_HEIGHT + tallestPageRowHeight;
  }, [rowHeights, hierarchyRowWindow]);

  const stableScrollbar = useHierarchyStableScrollbar(
    rowHeights,
    hierarchyRowWindow,
    HIERARCHY_VIRTUAL_SCROLLER_SELECTOR,
    tableWrapperRef,
    stableScrollbarTrackRef,
    stableScrollbarThumbRef,
    HEADER_ROW_HEIGHT,
  );

  const shouldShowMissingDimensionsHint = useMemo(() => {
    const hasBeds = beds.length > 0;
    const allBedsMissingLengthAndWidth = beds.every((bed) => {
      const length = parseDimensionValue(bed.length_m);
      const width = parseDimensionValue(bed.width_m);
      const hasLength = Number.isFinite(length ?? NaN);
      const hasWidth = Number.isFinite(width ?? NaN);

      return !hasLength && !hasWidth;
    });

    return hasBeds && allBedsMissingLengthAndWidth;
  }, [beds]);

  // How much vertical space is available below the table's own top edge,
  // measured against the real viewport (not a fixed svh/px guess) so the
  // table reaches close to the bottom of the visible app area regardless of
  // how much the title/alerts/hints/toggle above it currently take up.
  // Skipped on mobile, where the table keeps using autoHeight and the page
  // itself scrolls (see the DataGrid props below).
  //
  // Re-measures via a ResizeObserver on the whole page content area (see
  // pageContentRef below) rather than a hand-picked list of "things that
  // might shift the table down" — that list is easy to miss a case for
  // (e.g. an alert/hint whose height changes after an async data load), and
  // missing one leaves availableTableHeight stale, under-sizing the table
  // and making its last rows unreachable by scroll.
  const [availableTableHeight, setAvailableTableHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (isMobileViewport) {
      return;
    }

    const measure = (): void => {
      const wrapper = tableWrapperRef.current;
      if (!wrapper) {
        return;
      }
      const top = wrapper.getBoundingClientRect().top;
      setAvailableTableHeight(
        Math.max(TABLE_MIN_HEIGHT_PX, window.innerHeight - top - TABLE_BOTTOM_MARGIN_PX),
      );
    };

    measure();
    window.addEventListener("resize", measure);

    let resizeObserver: ResizeObserver | undefined;
    const observedElement = pageContentRef.current;
    if (observedElement && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(observedElement);
    }

    return () => {
      window.removeEventListener("resize", measure);
      resizeObserver?.disconnect();
    };
  }, [isMobileViewport]);

  const hasUnsavedInvalidNewRows = useMemo(() => (
    beds.some((bed) => isPartiallyFilledNamelessNewHierarchyRow({
      id: bed.id ?? "",
      type: "bed",
      level: 0,
      isNew: typeof bed.id === "number" && bed.id < 0,
      name: bed.name,
      field: bed.field,
      bedId: bed.id,
      area_sqm: bed.area_sqm,
      length_m: bed.length_m,
      width_m: bed.width_m,
      notes: bed.notes,
    }))
    // A partially filled new field can now also sit in View mode with its
    // draft persisted (exitToViewPreservingDraft, ahead of the unsaved-row
    // dialog) instead of staying in Edit, so it needs the same navigation
    // warning as an unsaved bed draft - otherwise navigating away before
    // answering the dialog silently drops it.
    || fields.some((field) => isPartiallyFilledNamelessNewHierarchyRow({
      id: field.id ?? "",
      type: "field",
      level: 0,
      isNew: typeof field.id === "number" && field.id < 0,
      name: field.name,
      fieldId: field.id,
      area_sqm: field.area_sqm,
      length_m: field.length_m,
      width_m: field.width_m,
      notes: field.notes,
    }))
  ), [beds, fields]);

  const isAnyRowInEditMode = useMemo(
    () => Object.values(rowModesModel).some((mode) => mode.mode === GridRowModes.Edit),
    [rowModesModel],
  );

  useNavigationBlocker(
    hasUnsavedInvalidNewRows || isAnyRowInEditMode,
    hasUnsavedInvalidNewRows
      ? t("messages.unsavedInvalidRowsNavigationWarning")
      : t("messages.unsavedRowEditNavigationWarning"),
  );

  useEffect(() => {
    if (!hasUnsavedInvalidNewRows) {
      setDraftValidationWarning("");
    }
  }, [hasUnsavedInvalidNewRows]);

  const contextMenuActions = contextMenuState
    ? getHierarchyRowActions(contextMenuState.row)
    : [];
  const formatHierarchyValue = useCallback((value: unknown): string => {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    return String(value);
  }, []);

  const getHierarchyAreaValue = useCallback((row: HierarchyRow): string => {
    if (row.type === "location") {
      return "—";
    }
    if (typeof row.length_m === "number" && typeof row.width_m === "number") {
      return String(Math.round(row.length_m * row.width_m * 10) / 10);
    }
    return formatHierarchyValue(row.area_sqm);
  }, [formatHierarchyValue]);

  const getHierarchyRowClipboardValues = useCallback((row: HierarchyRow): string[] => [
    row.name ?? "",
    row.type === "location" ? "—" : formatHierarchyValue(row.length_m),
    row.type === "location" ? "—" : formatHierarchyValue(row.width_m),
    getHierarchyAreaValue(row),
    getPlainExcerpt(row.notes ?? "", 120),
  ], [formatHierarchyValue, getHierarchyAreaValue]);

  const getHierarchyTableClipboardRows = useCallback((): string[][] => [
    [
      t("hierarchy:columns.name"),
      t("columns.length"),
      t("columns.width"),
      t("hierarchy:columns.area"),
      t("common:fields.notes"),
    ],
    ...rows.map(getHierarchyRowClipboardValues),
  ], [getHierarchyRowClipboardValues, rows, t]);

  return (
    <Box sx={showTitle ? PAGE_CONTAINER_SX.standardCenteredPage : undefined}>
      <Box ref={pageContentRef} sx={{ width: "100%", minWidth: 0 }}>
        {showTitle && <h1>{t("title")}</h1>}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {draftValidationWarning && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {draftValidationWarning}
          </Alert>
        )}

        {showContextMenuHint && (
          <ContextMenuHint
            variant="desktop"
            message={t("common:messages.contextMenuTableHint")}
            onClose={closeContextMenuHint}
            prominent
            sx={{ mb: 1.5, maxWidth: 560 }}
          />
        )}

        {showTouchContextMenuHint && (
          <ContextMenuHint
            variant="touch"
            message={t("common:messages.contextMenuTableHintTouch")}
            onClose={closeTouchContextMenuHint}
            prominent
            sx={{ mb: 1.5, maxWidth: 560 }}
          />
        )}

        {shouldShowMissingDimensionsHint && (
          <EmptyStateCard
            title={t('messages.missingDimensionsHint')}
            description={t('messages.missingDimensionsHintOptional')}
            containerSx={{ mx: 0 }}
          />
        )}

        {shouldShowHierarchyTable ? (
          <Box
            ref={tableWrapperRef}
            sx={{
              position: "relative",
              width: "100%",
              maxWidth: "100%",
              '& [role="row"][data-id]': {
                WebkitTouchCallout: "none",
              },
            }}
            onClick={() => setTreeActive(true)}
            onPointerDownCapture={rememberSameRowPointerEditTarget}
            onTouchStartCapture={rememberSameRowTouchEditTarget}
            onContextMenuCapture={handleGridContextMenu}
            onMouseDownCapture={handleReadOnlyHierarchyCellMouseDown}
            onTouchStart={handleGridTouchStart}
            onTouchMove={handleGridTouchMove}
            onTouchEnd={handleGridTouchEnd}
            onTouchCancel={handleGridTouchMove}
          >
            <DataGrid
              rows={rows}
              columns={columns}
              columnHeaderHeight={HEADER_ROW_HEIGHT}
              getRowHeight={getRowHeight}
              // Without this, MUI falls back to the density-default row
              // height as its estimate for any row it hasn't rendered yet,
              // which is wrong for our taller location/field rows. At scale
              // (many such rows off-screen), that under-estimate makes the
              // grid's computed total scroll range too short, capping how
              // far down you can actually scroll before ever reaching it —
              // our row height is exact (not a guess), so reuse it here too.
              getEstimatedRowHeight={getRowHeight}
              getRowClassName={(params) => (
                params.id === highlightedRowId
                  ? `ofp-hierarchy-row-${params.row.type} ofp-hierarchy-row-highlighted`
                  : `ofp-hierarchy-row-${params.row.type}`
              )}
              rowModesModel={rowModesModel}
              onRowModesModelChange={setRowModesModel}
              onRowEditStop={handleHierarchyRowEditStop}
              processRowUpdate={handleHierarchyProcessRowUpdate}
              onProcessRowUpdateError={handleProcessRowUpdateError}
              loading={loading}
              editMode="row"
              autoHeight={isMobileViewport}
              hideFooter={true}
              // See useHierarchyRowWindow: the free DataGrid always paginates
              // and caps pageSize at 100, so very large hierarchies are paged
              // internally (no pager UI) instead of relying on a single
              // unbounded page. onPaginationModelChange is a no-op — our own
              // scroll-position logic is the only thing that changes pages.
              paginationModel={{ page: hierarchyRowWindow.page, pageSize: hierarchyRowWindow.pageSize }}
              onPaginationModelChange={() => {}}
              sortingMode="server"
              sortModel={sortModel}
              onSortModelChange={handleHierarchySortModelChange}
              isRowSelectable={() => true}
              isCellEditable={isCellEditable}
              sx={
                isMobileViewport
                  ? HIERARCHY_DATA_GRID_SX
                  : {
                    ...HIERARCHY_DATA_GRID_SX,
                    height: `${Math.min(maxPageContentHeight, availableTableHeight ?? tableContentHeight)}px`,
                  }
              }
              disableRowSelectionOnClick
              onCellClick={handleHierarchyCellClick}
              onCellKeyDown={handleHierarchyCellKeyDown}
              localeText={getDataGridLocaleText()}
              apiRef={gridApiRef}
            />
            {!isMobileViewport && (
              <StableScrollbarTrack
                trackRef={stableScrollbarTrackRef}
                thumbRef={stableScrollbarThumbRef}
                scrollbar={stableScrollbar}
                top={HEADER_ROW_HEIGHT}
                bottom={0}
              />
            )}
          </Box>
        ) : null}
      </Box>

      {/* Notes Editor Drawer */}
      <NotesDrawer
        open={notesEditor.isOpen}
        title={t("columns.notes")}
        value={notesEditor.draft}
        onChange={notesEditor.setDraft}
        onSave={notesEditor.handleSave}
        onClose={notesEditor.handleClose}
        hasUnsavedChanges={Boolean(
          notesEditor.currentRow &&
            notesEditor.field &&
            notesEditor.draft !== ((notesEditor.currentRow[notesEditor.field] as string) || ""),
        )}
        loading={notesEditor.isSaving}
      />
      <CustomContextMenu
        open={contextMenuState !== null}
        onClose={closeContextMenu}
        keyboardNavigation
        listRef={contextMenuListRef}
        mouseX={contextMenuState?.mouseX}
        mouseY={contextMenuState?.mouseY}
      >
        {renderGroupedContextMenuActions(contextMenuActions, (action) => (
          <ContextMenuActionItem
            key={action.id}
            label={action.label}
            icon={action.icon}
            color={action.color === "error" ? "error" : undefined}
            emphasized={action.emphasized}
            shortcutHint={action.shortcutHint}
            renderPlainWhenUnadorned
            onClick={() => {
              closeContextMenu();
              action.onClick();
            }}
          />
        ))}
        <TableCopyMenuItems
          rowValues={contextMenuState ? getHierarchyRowClipboardValues(contextMenuState.row) : null}
          tableRows={getHierarchyTableClipboardRows()}
          includeDivider={contextMenuActions.length > 0}
          onClose={closeContextMenu}
        />
      </CustomContextMenu>
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
      <ConfirmationDialog
        open={unsavedRowDialogId !== null}
        title={t("dialogs.unsavedRow.title")}
        message={t("dialogs.unsavedRow.message")}
        cancelLabel={t("dialogs.unsavedRow.continueEditing")}
        confirmLabel={t("dialogs.unsavedRow.discard")}
        onCancel={handleContinueEditingUnsavedRow}
        onConfirm={handleDiscardUnsavedRow}
        cancelButtonProps={{ variant: "contained" }}
        confirmButtonProps={{ color: "error" }}
        disableBackdropClose
      />
    </Box>
  );
}

export default FieldsBedsHierarchy;
