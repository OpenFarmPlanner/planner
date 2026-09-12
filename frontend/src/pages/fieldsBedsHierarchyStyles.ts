/**
 * Layout constants and the DataGrid style object for the fields/beds hierarchy
 * table. Extracted verbatim from pages/FieldsBedsHierarchy.tsx.
 */

import { CALCULATED_COLUMN_CELL_CLASS } from "../components/data-grid/calculatedColumns";
import { dataGridSx } from "../components/data-grid/styles";
import { alpha } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";

export const HIERARCHY_SELECTED_VIEW_ROW_SELECTOR =
  "& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing)";

// Above this many combined locations/fields/beds, fully expanding the tree on
// first load produces an unwieldy wall of rows before the user has done
// anything. Below it, full expansion (the long-standing default) is more
// useful than hiding everything behind a chevron — mirrors the same
// size-based fallback used for the occupancy tree in GanttChart.tsx.
export const HIERARCHY_AUTO_EXPAND_ALL_THRESHOLD = 200;

// Bottom breathing room left below the table when it's sized to the
// available viewport height (see the tableWrapper measurement effect below),
// and a floor so it never collapses to something unusably short.
export const TABLE_BOTTOM_MARGIN_PX = 24;
export const TABLE_MIN_HEIGHT_PX = 240;

// The free/MIT @mui/x-data-grid we depend on hard-codes pagination on and
// throws if paginationModel.pageSize exceeds 100 (DataGridPro lifts this;
// not part of this project's dependencies). Above this many rows, the table
// pages internally via useHierarchyRowWindow, which auto-advances/retreats
// the page as the user scrolls near the grid's top/bottom edge — no pager UI
// is shown, so it still reads as one continuous scroll.
export const HIERARCHY_GRID_PAGE_SIZE = 100;
export const HIERARCHY_VIRTUAL_SCROLLER_SELECTOR = ".MuiDataGrid-virtualScroller";

export const HIERARCHY_DATA_GRID_SX = {
  ...dataGridSx,
  // Intentionally no width: "fit-content" here (see git history/#50296dd7 for
  // why it existed) — the name/dimension/area columns still keep their
  // compact, content-based widths, but forcing the whole grid to shrink-wrap
  // them fought the notes column's own flex: 1 (HierarchyColumns.tsx), which
  // is designed to absorb whatever width is left over. Letting the grid fill
  // its container lets notes do that job, so a horizontal scrollbar only
  // shows up when the fixed columns genuinely don't fit (narrow viewports).
  "& .MuiDataGrid-filler": {
    display: "none",
  },
  "& .MuiDataGrid-scrollbarFiller": {
    display: "none",
  },
  "& .MuiDataGrid-columnHeader": {
    py: 0.25,
  },
  "& .MuiDataGrid-cell": {
    py: 0,
  },
  "& .ofp-hierarchy-row-location .MuiDataGrid-cell": {
    py: 0.5,
  },
  "& .ofp-hierarchy-row-field .MuiDataGrid-cell": {
    py: 0.25,
  },
  "& .ofp-hierarchy-row-bed .MuiDataGrid-cell": {
    py: 0,
  },
  "& .MuiDataGrid-row--editing .MuiDataGrid-cell": {
    py: 0,
  },
  "& .MuiDataGrid-row--editing .MuiInputBase-root": {
    minHeight: "30px",
    height: "30px",
    fontSize: "0.875rem",
  },
  "& .MuiDataGrid-row--editing .MuiInputBase-input": {
    py: 0.5,
  },
  "& .MuiDataGrid-row--editing .MuiSelect-select": {
    minHeight: "unset !important",
    py: 0.5,
  },
  "& .MuiDataGrid-row--editing .MuiIconButton-root": {
    width: 28,
    height: 28,
  },
  "& .MuiDataGrid-row--editing .MuiDataGrid-cell[data-field='name'] .MuiInputBase-root":
    {
      minHeight: "32px",
      height: "32px",
    },
  [HIERARCHY_SELECTED_VIEW_ROW_SELECTOR]: {
    backgroundColor: "transparent",
  },
  [`${HIERARCHY_SELECTED_VIEW_ROW_SELECTOR} .MuiDataGrid-cell`]: {
    backgroundColor: "transparent",
  },
  [`${HIERARCHY_SELECTED_VIEW_ROW_SELECTOR} .MuiDataGrid-cell.MuiDataGrid-cell--editable`]:
    {
      backgroundColor: "surface.surfaceBackground",
    },
  [`${HIERARCHY_SELECTED_VIEW_ROW_SELECTOR} .MuiDataGrid-cell.${CALCULATED_COLUMN_CELL_CLASS}`]:
    {
      backgroundColor: "action.disabledBackground",
    },
  [`${HIERARCHY_SELECTED_VIEW_ROW_SELECTOR} .MuiDataGrid-cell.ofp-hierarchy-cell-missing-dimension`]:
    {
      backgroundColor: "warning.50",
    },
  [`${HIERARCHY_SELECTED_VIEW_ROW_SELECTOR} .MuiDataGrid-cell:focus, ${HIERARCHY_SELECTED_VIEW_ROW_SELECTOR} .MuiDataGrid-cell:focus-within`]:
    {
      backgroundColor: "transparent",
    },
  "& .ofp-hierarchy-cell-missing-dimension": {
    backgroundColor: "warning.50",
    color: "text.primary",
  },
  "& .MuiDataGrid-row:hover .ofp-hierarchy-cell-missing-dimension": {
    backgroundColor: "surface.surfaceHoverBackground",
    boxShadow: (theme: Theme) => `inset 0 0 0 9999px ${alpha(theme.palette.warning.main, 0.14)}`,
  },
  "& .ofp-hierarchy-row-highlighted .MuiDataGrid-cell": {
    animation: "ofp-hierarchy-row-highlight-flash 2.5s ease-out",
  },
  // Matches the app's established green "selected" look (e.g. CropDetail's
  // selected list item) instead of an unrelated yellow flash.
  "@keyframes ofp-hierarchy-row-highlight-flash": {
    "0%": { backgroundColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.22) },
    "70%": { backgroundColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.14) },
    "100%": { backgroundColor: "transparent" },
  },
  // Replaced by the custom track/thumb rendered alongside the grid (see
  // useHierarchyStableScrollbar) — MUI's own floating scrollbar sizes itself
  // from only the currently-loaded ~100-row page, which visibly jumps on
  // every internal page transition (see useHierarchyRowWindow).
  "& .MuiDataGrid-scrollbar--vertical": {
    display: "none",
  },
};
