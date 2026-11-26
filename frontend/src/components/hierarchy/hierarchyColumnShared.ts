// Shared types and constants for the hierarchy grid columns and their row
// action buttons.

import type { KeyboardEvent, MouseEvent, PointerEvent, TouchEvent } from 'react';
import type { HierarchyRow } from './utils/types';
import type { HierarchyLevelButtonsProps } from './HierarchyLevelToggle';

// Tooltip props that keep the popper from intercepting pointer events, so
// hovering an action icon never blocks the row underneath it.
export const NON_BLOCKING_TOOLTIP_PROPS = {
  disableInteractive: true,
  slotProps: {
    popper: {
      style: { pointerEvents: 'none' as const },
    },
  },
};

export interface NameCellCallbacks {
  onToggleExpand: (rowId: string | number) => void;
  onAddBed: (fieldId: number) => void;
  onDeleteBed: (bedId: number) => void;
  onAddField: (locationId?: number) => void;
  onDeleteField: (fieldId: number) => void;
  onDeleteLocation: (locationId: number) => void;
  onCreatePlantingPlan: (bedId: number) => void;
  onOpenContextMenu: (
    event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement> | TouchEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    row: HierarchyRow,
  ) => void;
  onOpenContextMenuFromButton?: (row: HierarchyRow, origin: HTMLElement) => void;
}

export interface HierarchyColumnOptions {
  disableInlineHoverActions?: boolean;
  onOpenContextMenuFromButton?: (row: HierarchyRow, origin: HTMLElement) => void;
  showPersistentContextMenuButton?: boolean;
  showInlineIndividualCount?: boolean;
  /**
   * When provided, renders the expand/collapse-one-level buttons directly in
   * the "Name" column header (see HierarchyLevelButtons) instead of the
   * caller having to render a separate row above the table.
   */
  levelToggle?: HierarchyLevelButtonsProps;
}
