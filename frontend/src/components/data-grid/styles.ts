/**
 * Central styling for MUI DataGrid components
 * 
 * This file provides common style objects that can be reused across
 * all DataGrid instances in the application for consistent styling.
 */

import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { CALCULATED_COLUMN_CELL_CLASS, CALCULATED_COLUMN_HEADER_CLASS } from './calculatedColumns';

const CALCULATED_COLUMN_BACKGROUND = '#F5F5F5';
const CALCULATED_COLUMN_TEXT = 'rgba(0,0,0,0.85)';
const EDITING_ROW_BACKGROUND_ALPHA = 0.06;
const DIRTY_CELL_BACKGROUND_ALPHA = 0.08;
const FOCUSED_CELL_BACKGROUND_ALPHA = 0.04;
const FOCUSED_CELL_RING_ALPHA = 0.48;
const EDITING_ROW_CELL_SELECTOR = [
  '& .ofp-row-editing .MuiDataGrid-cell',
  '& .ofp-row-editing:hover .MuiDataGrid-cell',
  '& .MuiDataGrid-row--editing .MuiDataGrid-cell',
  '& .MuiDataGrid-row--editing:hover .MuiDataGrid-cell',
].join(', ');
const EDITING_ROW_HOVER_CELL_SELECTOR = [
  '& .ofp-row-editing:hover .MuiDataGrid-cell',
  '& .MuiDataGrid-row--editing:hover .MuiDataGrid-cell',
].join(', ');
// `:not(.MuiDataGrid-row--editing)` keeps these overrides from clobbering the
// (intentional, separate) edit-mode row tint when a row happens to be both
// selected and in edit mode.
const SELECTED_ROW_SELECTOR = '& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing)';
const SELECTED_ROW_CELL_SELECTOR = '& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing) .MuiDataGrid-cell';
const SELECTED_ROW_FOCUS_CELL_SELECTOR = [
  '& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing) .MuiDataGrid-cell:focus',
  '& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing) .MuiDataGrid-cell:focus-within',
].join(', ');
const SELECTED_ROW_HOVER_SELECTOR = [
  '& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing):hover',
  '& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing):hover .MuiDataGrid-cell',
].join(', ');
const SELECTED_ROW_EDITABLE_CELL_SELECTOR = '& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing) .MuiDataGrid-cell--editable';
const SELECTED_ROW_EDITABLE_CELL_HOVER_SELECTOR = '& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing) .MuiDataGrid-cell--editable:hover';
const SELECTED_ROW_CALCULATED_CELL_SELECTOR = `& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing) .${CALCULATED_COLUMN_CELL_CLASS}`;
const SELECTED_ROW_CALCULATED_CELL_HOVER_SELECTOR = `& .MuiDataGrid-row.Mui-selected:not(.MuiDataGrid-row--editing):hover .${CALCULATED_COLUMN_CELL_CLASS}`;

const getPrimaryOverlay = (theme: Theme, opacity: number): string =>
  alpha(theme.palette.primary.main, opacity);

const getDataGridCellFocusRing = (theme: Theme): string =>
  `inset 0 0 0 2px ${alpha(theme.palette.primary.main, FOCUSED_CELL_RING_ALPHA)}`;

const EDIT_CELL_OUTLINE_SELECTOR = [
  '& .MuiDataGrid-cell--editing .MuiOutlinedInput-notchedOutline',
  '& .MuiDataGrid-cell--editing .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline',
  '& .MuiDataGrid-cell--editing .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline',
  '& .MuiDataGrid-cell--editing .MuiOutlinedInput-root.Mui-error .MuiOutlinedInput-notchedOutline',
  '& .MuiDataGrid-cell--editing .MuiOutlinedInput-root.Mui-error:hover .MuiOutlinedInput-notchedOutline',
  '& .MuiDataGrid-cell--editing .MuiOutlinedInput-root.Mui-error.Mui-focused .MuiOutlinedInput-notchedOutline',
].join(', ');

const NORMAL_EDITING_CELL_SELECTOR = [
  '& .MuiDataGrid-cell--editing',
  '& .MuiDataGrid-cell--editing:focus',
  '& .MuiDataGrid-cell--editing:focus-within',
  '& .MuiDataGrid-cell--editing.Mui-error',
  '& .MuiDataGrid-cell--editing.Mui-error:focus',
  '& .MuiDataGrid-cell--editing.Mui-error:focus-within',
].join(', ');

/**
 * Common styles for MUI DataGrid components
 */
export const dataGridSx = {
  border: '1px solid',
  borderColor: 'surface.surfaceSoftBorder',
  borderRadius: 3,
  backgroundColor: 'surface.surfaceBackground',
  boxShadow: '0 1px 2px rgba(21, 31, 24, 0.03)',
  '& .MuiDataGrid-columnHeaders': {
    backgroundColor: 'surface.surfaceSubtleBackground',
    borderBottom: '1px solid',
    borderBottomColor: 'surface.surfaceSoftBorder',
  },
  '& .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-columnHeader:focus-within': {
    outline: 'none',
    boxShadow: (theme: Theme) => getDataGridCellFocusRing(theme),
  },
  '& .MuiDataGrid-row': {
    minHeight: 44,
  },
  '& .MuiDataGrid-row:hover': {
    backgroundColor: 'surface.surfaceHoverBackground',
  },
  '& .MuiDataGrid-row:hover .MuiDataGrid-cell': {
    backgroundColor: 'surface.surfaceHoverBackground',
  },
  '& .MuiDataGrid-cell': {
    borderColor: 'surface.surfaceSoftBorder',
    transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
  },
  '& .MuiDataGrid-cell.ofp-cell-full-tooltip': {
    position: 'relative',
  },
  '& .MuiDataGrid-cell--editable': {
    bgcolor: (theme: Theme) =>
      theme.palette.mode === 'dark'
        ? '#383838'
        : (theme.palette.surface?.surfaceBackground ?? theme.palette.background.paper),
    cursor: 'pointer',
  },
  '& .MuiDataGrid-cell--editable:hover': {
    backgroundColor: 'surface.surfaceHoverBackground',
  },
  '& .MuiDataGrid-cell--editing': {
    overflow: 'hidden',
    backgroundColor: (theme: Theme) => getPrimaryOverlay(theme, EDITING_ROW_BACKGROUND_ALPHA),
  },
  [NORMAL_EDITING_CELL_SELECTOR]: {
    boxShadow: (theme: Theme) => getDataGridCellFocusRing(theme),
  },
  '& .MuiDataGrid-cell--editing .MuiInputBase-root': {
    minHeight: '100%',
    height: 'auto',
    alignItems: 'center',
  },
  [EDIT_CELL_OUTLINE_SELECTOR]: {
    borderColor: (theme: Theme) => `${theme.palette.primary.main} !important`,
  },
  '& .MuiDataGrid-cell.Mui-error': {
    boxShadow: 'none',
  },
  '& .MuiDataGrid-cell--editing .MuiFormLabel-root.Mui-error': {
    color: 'text.secondary',
  },
  '& .MuiDataGrid-cell--editing .MuiFormHelperText-root.Mui-error': {
    color: 'text.secondary',
  },
  '& .MuiDataGrid-cell--editing .MuiInputBase-root.Mui-error .MuiSvgIcon-root': {
    color: 'action.active',
  },
  '& .MuiDataGrid-cell--editing .MuiInputBase-root.Mui-error::before, & .MuiDataGrid-cell--editing .MuiInputBase-root.Mui-error::after': {
    borderColor: (theme: Theme) => `${theme.palette.primary.main} !important`,
  },
  '& .MuiDataGrid-cell--editing .MuiInputBase-input': {
    lineHeight: 1.4,
    paddingTop: '8px',
    paddingBottom: '8px',
  },
  '& .MuiDataGrid-cell--editing .MuiSelect-select': {
    minHeight: 'unset !important',
    display: 'flex',
    alignItems: 'center',
    lineHeight: 1.4,
    paddingTop: '8px',
    paddingBottom: '8px',
  },
  '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': {
    outline: 'none',
    overflow: 'visible',
    backgroundColor: (theme: Theme) => getPrimaryOverlay(theme, FOCUSED_CELL_BACKGROUND_ALPHA),
    boxShadow: (theme: Theme) => getDataGridCellFocusRing(theme),
  },
  '& .MuiDataGrid-columnHeaderTitleContainer': {
    minWidth: 0,
  },
  '& .ofp-cell-error': {
    boxShadow: 'none',
  },
  '& .MuiDataGrid-row:hover .ofp-cell-error': {
    boxShadow: 'none',
  },
  '& .MuiDataGrid-cell.ofp-cell-error:focus, & .MuiDataGrid-cell.ofp-cell-error:focus-within': {
    boxShadow: (theme: Theme) => getDataGridCellFocusRing(theme),
  },
  '& .ofp-cell-dirty': {
    backgroundColor: (theme: Theme) => getPrimaryOverlay(theme, DIRTY_CELL_BACKGROUND_ALPHA),
  },
  '& .MuiDataGrid-row:hover .ofp-cell-dirty': {
    backgroundColor: (theme: Theme) => getPrimaryOverlay(theme, DIRTY_CELL_BACKGROUND_ALPHA),
  },
  '& .ofp-row-editing, & .MuiDataGrid-row--editing': {
    backgroundColor: (theme: Theme) => getPrimaryOverlay(theme, EDITING_ROW_BACKGROUND_ALPHA),
  },
  [EDITING_ROW_CELL_SELECTOR]: {
    backgroundColor: (theme: Theme) => getPrimaryOverlay(theme, EDITING_ROW_BACKGROUND_ALPHA),
  },
  [`& .${CALCULATED_COLUMN_HEADER_CLASS}`]: {
    backgroundColor: CALCULATED_COLUMN_BACKGROUND,
    color: CALCULATED_COLUMN_TEXT,
  },
  [`& .${CALCULATED_COLUMN_HEADER_CLASS}:hover`]: {
    backgroundColor: CALCULATED_COLUMN_BACKGROUND,
  },
  [`& .${CALCULATED_COLUMN_CELL_CLASS}`]: {
    backgroundColor: CALCULATED_COLUMN_BACKGROUND,
    color: CALCULATED_COLUMN_TEXT,
  },
  [`& .MuiDataGrid-row:hover .${CALCULATED_COLUMN_CELL_CLASS}`]: {
    backgroundColor: 'surface.surfaceHoverBackground',
  },
  [EDITING_ROW_HOVER_CELL_SELECTOR]: {
    backgroundColor: (theme: Theme) => getPrimaryOverlay(theme, EDITING_ROW_BACKGROUND_ALPHA),
  },
  // Row "selection" here only tracks which row keyboard shortcuts (delete,
  // duplicate, etc.) act on — it is not a visible multi-select feature, so a
  // selected row must look identical to any other row except while actually
  // hovered or its cell is focused. The rules below undo MUI DataGrid's
  // built-in persistent `.Mui-selected` background, then restore the
  // specific backgrounds (calculated column, editable cell, hover) that a
  // plain cell would otherwise still have.
  [SELECTED_ROW_SELECTOR]: {
    backgroundColor: 'transparent',
  },
  [SELECTED_ROW_CELL_SELECTOR]: {
    backgroundColor: 'transparent',
  },
  [SELECTED_ROW_FOCUS_CELL_SELECTOR]: {
    backgroundColor: 'transparent',
    boxShadow: (theme: Theme) => getDataGridCellFocusRing(theme),
  },
  [SELECTED_ROW_HOVER_SELECTOR]: {
    backgroundColor: 'surface.surfaceHoverBackground',
  },
  [SELECTED_ROW_EDITABLE_CELL_SELECTOR]: {
    bgcolor: (theme: Theme) =>
      theme.palette.mode === 'dark'
        ? '#383838'
        : (theme.palette.surface?.surfaceBackground ?? theme.palette.background.paper),
  },
  [SELECTED_ROW_EDITABLE_CELL_HOVER_SELECTOR]: {
    backgroundColor: 'surface.surfaceHoverBackground',
  },
  [SELECTED_ROW_CALCULATED_CELL_SELECTOR]: {
    backgroundColor: CALCULATED_COLUMN_BACKGROUND,
    color: CALCULATED_COLUMN_TEXT,
  },
  [SELECTED_ROW_CALCULATED_CELL_HOVER_SELECTOR]: {
    backgroundColor: 'surface.surfaceHoverBackground',
  },
};

/**
 * Common styles for footer containers in DataGrid
 */
export const dataGridFooterSx = {
  p: 1,
  display: 'flex',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 1,
  borderTop: '1px solid',
  borderColor: 'divider',
  position: 'sticky',
  bottom: 0,
  backgroundColor: 'surface.surfaceBackground',
  zIndex: 2,
};

/**
 * Subtle, row-like "add" action shown in the DataGrid footer — deliberately not
 * styled as a primary/contained button so it reads as a table affordance rather
 * than competing with the page's main call-to-action button.
 */
export const dataGridAddRowButtonSx = {
  color: 'text.secondary',
  textTransform: 'none',
  fontWeight: 400,
  justifyContent: 'flex-start',
  minHeight: 44,
  minWidth: 44,
  px: 1.5,
  borderRadius: 1,
  '&:hover': {
    backgroundColor: 'surface.surfaceHoverBackground',
    color: 'primary.main',
  },
};

/**
 * Common styles for delete action IconButtons
 */
export const deleteIconButtonSx = {
  color: 'error.main',
  '&:hover': {
    backgroundColor: (theme: Theme) => alpha(theme.palette.error.main, 0.08),
  },
};

/**
 * The bold label inside a custom `renderHeader`, matching what the DataGrid
 * renders for a plain `headerName`.
 */
export const dataGridHeaderLabelSx = { fontWeight: 600 };
