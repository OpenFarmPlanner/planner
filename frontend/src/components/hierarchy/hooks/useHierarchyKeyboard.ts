import { useEffect } from "react";
import type { GridRowId } from "@mui/x-data-grid";
import type { HierarchyRow } from "../utils/types";
import { getHierarchyKeyboardAction } from "../utils/hierarchyKeyboardNavigation";
import { isTypingInEditableElement } from "../../../hooks/useKeyboardShortcuts";
import { isPrimaryModifierOnly } from "../../../utils/platform";

interface UseHierarchyKeyboardParams {
  contextMenuState: { row: HierarchyRow } | null;
  treeActiveRef: React.MutableRefObject<boolean>;
  tableWrapperRef: React.RefObject<HTMLDivElement | null>;
  rowsRef: React.MutableRefObject<readonly HierarchyRow[]>;
  selectedRowIdRef: React.MutableRefObject<string | number | null>;
  expandedRowsRef: React.MutableRefObject<Set<string | number>>;
  activateFirstRow: (id: GridRowId) => void;
  selectRow: (id: GridRowId) => void;
  setTreeActive: (active: boolean) => void;
  toggleExpand: (id: GridRowId) => void;
  discardActiveRowEdit: () => void;
  openContextMenuForRow: (
    row: HierarchyRow,
    mouseX: number,
    mouseY: number,
    origin?: HTMLElement | null,
  ) => void;
  onInsertShortcut: () => void;
  /** Ctrl+D / ⌘D on the active row; returns whether it acted. */
  onDuplicateShortcut?: () => boolean;
}

export function useHierarchyKeyboard({
  contextMenuState,
  treeActiveRef,
  tableWrapperRef,
  rowsRef,
  selectedRowIdRef,
  expandedRowsRef,
  activateFirstRow,
  selectRow,
  setTreeActive,
  toggleExpand,
  discardActiveRowEdit,
  openContextMenuForRow,
  onInsertShortcut,
  onDuplicateShortcut,
}: UseHierarchyKeyboardParams): void {
  // Window-level keyboard handlers: Alt+T focus, ArrowDown/Up navigation,
  // ArrowLeft/Right expand/collapse. A separate listener handles context-menu
  // keyboard shortcuts so its dependency array stays minimal.
  useEffect(() => {
    const handleDocumentPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!tableWrapperRef.current?.contains(event.target as Node)) {
        discardActiveRowEdit();
        setTreeActive(false);
      }
    };

    // Insert mirrors the row's primary, highlighted "create" context menu
    // action (e.g. "Parzelle hinzufügen", "Beet hinzufügen"). It is scoped to
    // the table being active (treeActiveRef) and never fires while editing
    // text, so it can't collide with browser/OS shortcuts or interrupt typing.
    const handleInsertShortcut = (event: KeyboardEvent) => {
      if (event.key !== "Insert") return;
      if (!treeActiveRef.current) return;
      if (isTypingInEditableElement(document.activeElement)) return;

      event.preventDefault();
      onInsertShortcut();
    };

    // Ctrl+D / ⌘D duplicates the active bed row. The browser's own Ctrl+D
    // (bookmark) is only suppressed when the table is active, nothing is
    // being typed or edited, and the handler actually duplicated a row.
    const handleDuplicateShortcut = (event: KeyboardEvent) => {
      if (!onDuplicateShortcut) return;
      if (event.key !== "d" && event.key !== "D") return;
      if (!isPrimaryModifierOnly(event)) return;
      if (contextMenuState !== null || !treeActiveRef.current) return;
      if (isTypingInEditableElement(document.activeElement)) return;
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      if (onDuplicateShortcut()) {
        event.preventDefault();
      }
    };

    const handleFocusTable = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "t" && event.key !== "T") return;
      if (isTypingInEditableElement(document.activeElement)) return;

      const firstRow = rowsRef.current[0];
      if (!firstRow) return;

      event.preventDefault();
      const targetId = firstRow.id;
      activateFirstRow(targetId);

      const selectedElement = document.querySelector(`[data-id="${String(targetId)}"]`);
      if (selectedElement instanceof HTMLElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    };

    const handleTreeNavigation = (event: KeyboardEvent) => {
      const currentSelectedRowId = selectedRowIdRef.current;
      if (contextMenuState !== null || !treeActiveRef.current || !currentSelectedRowId) return;
      if (isTypingInEditableElement(document.activeElement)) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      const action = getHierarchyKeyboardAction({
        expandedRows: expandedRowsRef.current,
        key: event.key,
        rows: rowsRef.current,
        selectedRowId: currentSelectedRowId,
      });
      if (!action) return;

      if (action.type === "select") {
        selectRow(action.rowId);
      } else {
        toggleExpand(action.rowId);
      }

      event.preventDefault();

      const selectedElement = document.querySelector(
        `[data-id="${String(action.rowId)}"]`,
      );
      if (selectedElement instanceof HTMLElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    };

    document.addEventListener("mousedown", handleDocumentPointerDown);
    // Touch devices need their own listener: on a tap outside a focused input,
    // mobile Safari/Chrome often only dismiss the on-screen keyboard on that
    // first tap without synthesizing the usual mousedown/click on the new
    // target, so the mousedown listener above alone never fires and a new,
    // still-empty row is left stuck in edit mode.
    document.addEventListener("touchstart", handleDocumentPointerDown);
    window.addEventListener("keydown", handleFocusTable);
    window.addEventListener("keydown", handleTreeNavigation);
    window.addEventListener("keydown", handleInsertShortcut);
    window.addEventListener("keydown", handleDuplicateShortcut);

    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
      document.removeEventListener("touchstart", handleDocumentPointerDown);
      window.removeEventListener("keydown", handleFocusTable);
      window.removeEventListener("keydown", handleTreeNavigation);
      window.removeEventListener("keydown", handleInsertShortcut);
      window.removeEventListener("keydown", handleDuplicateShortcut);
    };
  }, [activateFirstRow, contextMenuState, discardActiveRowEdit, expandedRowsRef, onDuplicateShortcut, onInsertShortcut, rowsRef, selectRow, selectedRowIdRef, setTreeActive, tableWrapperRef, toggleExpand, treeActiveRef]);

  // Context-menu keyboard trigger (ContextMenu key / Shift+F10).
  useEffect(() => {
    const handleContextMenuKeyboard = (event: KeyboardEvent) => {
      const shouldOpen =
        event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
      const currentSelectedRowId = selectedRowIdRef.current;
      if (
        !shouldOpen ||
        !treeActiveRef.current ||
        !currentSelectedRowId ||
        isTypingInEditableElement(document.activeElement)
      ) {
        return;
      }

      const selectedRow = rowsRef.current.find((row) => row.id === currentSelectedRowId);
      if (!selectedRow) return;

      event.preventDefault();
      event.stopPropagation();
      const targetElement = document.querySelector(
        `[data-id="${String(currentSelectedRowId)}"]`,
      ) as HTMLElement | null;
      if (!targetElement) return;
      const rect = targetElement.getBoundingClientRect();
      openContextMenuForRow(
        selectedRow,
        rect.left + Math.min(240, rect.width),
        rect.top + 12,
        targetElement,
      );
    };

    window.addEventListener("keydown", handleContextMenuKeyboard);
    return () => window.removeEventListener("keydown", handleContextMenuKeyboard);
  }, [openContextMenuForRow, rowsRef, selectedRowIdRef, treeActiveRef]);
}
