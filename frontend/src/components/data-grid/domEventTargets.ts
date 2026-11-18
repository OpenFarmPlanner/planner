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

const LISTBOX_POPUP_ROOT_SELECTOR = '.MuiModal-root, .MuiPopover-root, .MuiPopper-root';

/**
 * The element inside `container` whose listbox popup (a select's or
 * autocomplete's option list, rendered by MUI in a portal outside the grid)
 * contains the target, through its `aria-controls`. The target may be the
 * list itself or the popup's backdrop around it; null for anything else.
 */
export const findListboxPopupOpener = (target: EventTarget | null, container: Element): HTMLElement | null => {
  if (!(target instanceof Element)) {
    return null;
  }
  const popup = target.closest('[role="listbox"][id]') ?? target.closest(LISTBOX_POPUP_ROOT_SELECTOR);
  const listbox = popup?.matches('[role="listbox"][id]') ? popup : popup?.querySelector('[role="listbox"][id]');
  if (!listbox) {
    return null;
  }
  return Array.from(container.querySelectorAll<HTMLElement>('[aria-controls]')).find((opener) =>
    opener.getAttribute('aria-controls')?.split(/\s+/).includes(listbox.id),
  ) ?? null;
};
