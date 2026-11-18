// Pure DOM-target helpers for EditableDataGrid's keyboard/pointer handling.
// Extracted from DataGrid.tsx; all functions only inspect the event target,
// they hold no grid state.
import type { GridRowId } from '@mui/x-data-grid';
import { closestContextMenuElement } from '../../utils/contextMenu';

export const editModeEditorArrowKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export const isComboboxInteractionTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"]'),
  );
};

export const isEnterSaveInputTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && !isComboboxInteractionTarget(target);

export const getRowIdFromElement = (target: EventTarget | null): GridRowId | null => {
  const rowElement = closestContextMenuElement(target, '[role="row"][data-id]');
  return rowElement?.dataset.id ?? null;
};

/**
 * Whether the target lies in a listbox popup (a select's or autocomplete's
 * option list, which MUI renders in a portal outside the grid) whose opener
 * inside `container` controls it via `aria-controls`. Click-outside handlers
 * treat such targets as inside, so picking an option does not end the edit.
 */
export const isInListboxControlledFrom = (target: EventTarget | null, container: Element): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }
  const listboxId = target.closest('[role="listbox"][id]')?.id;
  if (!listboxId) {
    return false;
  }
  return Array.from(container.querySelectorAll('[aria-controls]')).some((opener) =>
    opener.getAttribute('aria-controls')?.split(/\s+/).includes(listboxId),
  );
};
