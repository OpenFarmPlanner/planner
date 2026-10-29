import { useCallback, useLayoutEffect, useRef } from "react";
import { GridRowModes } from "@mui/x-data-grid";
import type { GridRowId, GridRowModesModel, GridRowsProp } from "@mui/x-data-grid";
import type { HierarchyRow } from "../utils/types";

interface HierarchyGridFocusApi {
  getCellElement?: (id: GridRowId, field: string) => HTMLElement | null;
  setCellFocus?: (id: GridRowId, field: string) => void;
}

interface UseHierarchyGridFocusParams {
  getFocusableField?: (rowId: GridRowId, preferredField: string) => string | null;
  gridApiRef: {
    current?: HierarchyGridFocusApi | null;
  };
  rowModesModel: GridRowModesModel;
  rows: GridRowsProp<HierarchyRow>;
  selectRow: (rowId: GridRowId) => void;
  selectedRowId: string | number | null;
  treeActive: boolean;
  /**
   * Lets very large hierarchies (see useHierarchyRowWindow) page the grid to
   * the row being focused before attempting to focus it. Returns true if a
   * page change was triggered, in which case the row's cell doesn't exist in
   * the DOM yet — focusRow retries once after the next paint instead of
   * calling the (currently no-op) grid API immediately.
   */
  ensureRowVisible?: (rowId: GridRowId) => boolean;
}

interface UseHierarchyGridFocusResult {
  applyOrReapplyPostEditFocus: (sourceRowId: GridRowId) => void;
  focusRow: (rowId: GridRowId, preferredField?: string) => void;
  /** Call immediately before setRowModesModel(View) to prevent a browser focus-fixup flash. */
  preFocusEditCell: (rowId: GridRowId) => void;
  queuePostEditFocus: (rowId: GridRowId, preferredField?: string, sourceRowId?: GridRowId) => void;
  rememberFocusedField: (field: string) => void;
}

const DEFAULT_FOCUS_FIELD = "name";

/**
 * Whether DOM focus sits on a cell of a row other than `rowId` and
 * `allowedRowId`. A mouse press on another row's cell moves focus there
 * before the edited row's save runs; the post-edit focus restore (meant for
 * Enter and Escape) must then leave it alone instead of pulling focus back.
 */
export const isFocusOnOtherRowCell = (rowId: GridRowId, allowedRowId?: GridRowId): boolean => {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement) || !activeElement.closest('[role="gridcell"]')) {
    return false;
  }
  const focusedRowId = activeElement.closest<HTMLElement>('[role="row"][data-id]')?.dataset.id;
  return focusedRowId !== undefined
    && focusedRowId !== String(rowId)
    && (allowedRowId === undefined || focusedRowId !== String(allowedRowId));
};

const hasEditingRow = (rowModesModel: GridRowModesModel): boolean =>
  Object.values(rowModesModel).some((mode) => mode.mode === GridRowModes.Edit);

const getEditingRowId = (
  rowModesModel: GridRowModesModel,
  rows: GridRowsProp<HierarchyRow>,
): GridRowId | null => {
  const editingRowKey = Object.entries(rowModesModel).find(
    ([, mode]) => mode.mode === GridRowModes.Edit,
  )?.[0];
  if (editingRowKey == null) {
    return null;
  }

  return rows.find((row) => String(row.id) === editingRowKey)?.id ?? editingRowKey;
};

const findFallbackVisibleRow = (
  previousRows: GridRowsProp<HierarchyRow>,
  visibleRows: GridRowsProp<HierarchyRow>,
  hiddenRowId: string | number,
): HierarchyRow | undefined => {
  const visibleRowIds = new Set(visibleRows.map((row) => String(row.id)));
  const previousIndex = previousRows.findIndex((row) => row.id === hiddenRowId);

  if (previousIndex > -1) {
    for (let index = previousIndex - 1; index >= 0; index -= 1) {
      const candidate = previousRows[index] as HierarchyRow;
      if (visibleRowIds.has(String(candidate.id))) {
        return candidate;
      }
    }
  }

  return visibleRows[0] as HierarchyRow | undefined;
};

export function useHierarchyGridFocus({
  getFocusableField,
  gridApiRef,
  rowModesModel,
  rows,
  selectRow,
  selectedRowId,
  treeActive,
  ensureRowVisible,
}: UseHierarchyGridFocusParams): UseHierarchyGridFocusResult {
  const focusedFieldRef = useRef(DEFAULT_FOCUS_FIELD);
  const postEditFocusTargetRef = useRef<{ rowId: GridRowId; preferredField?: string; sourceRowId?: GridRowId } | null>(null);
  const lastPostEditFocusTargetRef = useRef<{ rowId: GridRowId; preferredField?: string; sourceRowId?: GridRowId } | null>(null);
  const prevRowModesModelRef = useRef<GridRowModesModel>({});
  const prevRowsRef = useRef(rows);
  const skipStaleSelectedFocusRef = useRef(false);

  const rememberFocusedField = useCallback((field: string): void => {
    focusedFieldRef.current = field || DEFAULT_FOCUS_FIELD;
  }, []);

  const applyCellFocus = useCallback((rowId: GridRowId, preferredField?: string): void => {
    const api = gridApiRef.current;
    const focusField = getFocusableField?.(rowId, preferredField ?? focusedFieldRef.current) ?? DEFAULT_FOCUS_FIELD;
    focusedFieldRef.current = focusField;
    api?.setCellFocus?.(rowId, focusField);
    api?.getCellElement?.(rowId, focusField)?.focus({ preventScroll: true });
  }, [getFocusableField, gridApiRef]);

  const focusRow = useCallback((rowId: GridRowId, preferredField?: string): void => {
    if (ensureRowVisible?.(rowId)) {
      // The target row isn't on the currently displayed page yet — the page
      // change just triggered will re-render before the next paint, so wait
      // for that instead of focusing a cell that doesn't exist in the DOM.
      requestAnimationFrame(() => applyCellFocus(rowId, preferredField));
      return;
    }
    applyCellFocus(rowId, preferredField);
  }, [applyCellFocus, ensureRowVisible]);

  // Pre-focus the stable cell container div before switching the row back to View mode.
  // When React removes the edit <input> from the DOM, the browser's native focus-fixup
  // would otherwise move focus to the nearest focusable ancestor (often the first row),
  // causing a visible flash. Moving focus to the container first keeps DOM focus anchored
  // through the transition. This does NOT fire MUI's cellFocusOut custom event (which is
  // only emitted by setCellFocus), so it has no unintended edit-stop side-effect.
  const preFocusEditCell = useCallback((rowId: GridRowId): void => {
    gridApiRef.current?.getCellElement?.(rowId, focusedFieldRef.current)?.focus({ preventScroll: true });
  }, [gridApiRef]);

  const queuePostEditFocus = useCallback((rowId: GridRowId, preferredField?: string, sourceRowId?: GridRowId): void => {
    postEditFocusTargetRef.current = { rowId, preferredField, sourceRowId };
  }, []);

  const focusSelectedCell = useCallback((): void => {
    if (selectedRowId != null) {
      focusRow(selectedRowId);
    }
  }, [focusRow, selectedRowId]);

  const applyFocusTarget = useCallback((target: { rowId: GridRowId; preferredField?: string; sourceRowId?: GridRowId }): void => {
    focusRow(target.rowId, target.preferredField);
    selectRow(target.rowId);
    lastPostEditFocusTargetRef.current = target;
    skipStaleSelectedFocusRef.current = true;
  }, [focusRow, selectRow]);

  const applyPostEditFocus = useCallback((fallbackRowId?: GridRowId): void => {
    const queuedTarget = postEditFocusTargetRef.current;
    postEditFocusTargetRef.current = null;
    const targetRowId = queuedTarget?.rowId ?? fallbackRowId;
    const sourceRowId = queuedTarget?.sourceRowId ?? fallbackRowId;
    if (sourceRowId != null && isFocusOnOtherRowCell(sourceRowId, targetRowId ?? undefined)) {
      lastPostEditFocusTargetRef.current = null;
      return;
    }
    if (targetRowId != null) {
      applyFocusTarget({
        rowId: targetRowId,
        preferredField: queuedTarget?.preferredField,
        sourceRowId: queuedTarget?.sourceRowId ?? fallbackRowId,
      });
    } else {
      focusSelectedCell();
    }
  }, [applyFocusTarget, focusSelectedCell]);

  const applyOrReapplyPostEditFocus = useCallback((sourceRowId: GridRowId): void => {
    const queuedTarget = postEditFocusTargetRef.current;
    if (queuedTarget) {
      applyPostEditFocus(sourceRowId);
      return;
    }

    const lastTarget = lastPostEditFocusTargetRef.current;
    if (
      lastTarget
      && String(lastTarget.sourceRowId) === String(sourceRowId)
      && !isFocusOnOtherRowCell(sourceRowId, lastTarget.rowId)
    ) {
      applyFocusTarget(lastTarget);
    }
  }, [applyFocusTarget, applyPostEditFocus]);

  // useLayoutEffect (not useEffect) fires synchronously before the browser paints,
  // so focus is always corrected within the same commit — no visible flash.
  //
  // On Edit→View transition we focus the row that WAS being edited (from prevModel),
  // not selectedRowId state. Arrow-key navigation only updates selectedRowIdRef (transient);
  // if editing was started via keyboard, selectedRowId state is the last clicked row and
  // would land focus on the wrong row. We also sync selectedRowId so subsequent arrow
  // navigation and focus restoration start from the correct row.
  useLayoutEffect(() => {
    const prevModel = prevRowModesModelRef.current;
    prevRowModesModelRef.current = rowModesModel;

    if (!hasEditingRow(prevModel) || hasEditingRow(rowModesModel)) {
      return;
    }

    const editingRowId = getEditingRowId(prevModel, rows);
    applyPostEditFocus(editingRowId ?? undefined);
  }, [applyPostEditFocus, rowModesModel, rows]);

  // Read at call time via a ref instead of depending on focusSelectedCell
  // directly: it's recreated whenever ensureRowVisible's identity changes,
  // which useHierarchyRowWindow does on every page transition (see there) -
  // completely unrelated to selectedRowId or treeActive actually changing.
  // Depending on it directly re-ran this effect on every such transition,
  // which paged the grid straight back to wherever the already-selected row
  // lives — on a large hierarchy, that meant scrolling forward past the
  // first page boundary with any row selected immediately snapped back to
  // that row's page, no matter how far the user kept scrolling.
  const focusSelectedCellRef = useRef(focusSelectedCell);
  useLayoutEffect(() => {
    focusSelectedCellRef.current = focusSelectedCell;
  });

  useLayoutEffect(() => {
    if (treeActive) {
      if (skipStaleSelectedFocusRef.current) {
        skipStaleSelectedFocusRef.current = false;
        return;
      }
      focusSelectedCellRef.current();
    }
  }, [selectedRowId, treeActive]);

  useLayoutEffect(() => {
    const previousRows = prevRowsRef.current;
    prevRowsRef.current = rows;

    if (!selectedRowId || !treeActive) {
      return;
    }
    if (rows.some((row) => row.id === selectedRowId)) {
      return;
    }

    const fallbackRow = findFallbackVisibleRow(previousRows, rows, selectedRowId);
    if (fallbackRow) {
      selectRow(fallbackRow.id);
    }
  }, [rows, selectedRowId, selectRow, treeActive]);

  return {
    applyOrReapplyPostEditFocus,
    focusRow,
    preFocusEditCell,
    queuePostEditFocus,
    rememberFocusedField,
  };
}
