import type { KeyboardEvent, KeyboardEventHandler, ReactNode, Ref } from 'react';
import { Menu, type MenuProps } from '@mui/material';

import { handleContextMenuKeyboardNavigation } from './contextMenuFocus';

interface CustomContextMenuProps extends Omit<
  MenuProps,
  'anchorPosition' | 'anchorReference' | 'children' | 'hideBackdrop' | 'open' | 'slotProps' | 'sx'
> {
  open: boolean;
  mouseX?: number;
  mouseY?: number;
  anchorEl?: MenuProps['anchorEl'];
  listRef?: Ref<HTMLUListElement>;
  listLabel?: string;
  onListKeyDown?: KeyboardEventHandler<HTMLUListElement>;
  /**
   * Wire the shared roving keyboard navigation (arrows, Home/End, typeahead,
   * Escape) onto the menu and its list, focusing the list on open. Menus that
   * are reachable by keyboard want this; a pure pointer menu does not. It
   * supplies `autoFocus`, `disableAutoFocusItem` and both key handlers, so a
   * caller's own `onListKeyDown`/`onKeyDown` are ignored while it is set.
   */
  keyboardNavigation?: boolean;
  children: ReactNode;
}

export function CustomContextMenu({
  open,
  mouseX,
  mouseY,
  anchorEl,
  listRef,
  listLabel,
  onListKeyDown,
  keyboardNavigation = false,
  children,
  ...menuProps
}: CustomContextMenuProps) {
  const hasAnchorPosition = mouseX !== undefined && mouseY !== undefined;
  const { onClose } = menuProps;
  const navigate = (event: KeyboardEvent<Element>): void => {
    handleContextMenuKeyboardNavigation(event, onClose ? () => onClose({}, 'escapeKeyDown') : undefined);
  };
  const resolvedListKeyDown = keyboardNavigation ? navigate : onListKeyDown;

  return (
    <Menu
      {...menuProps}
      {...(keyboardNavigation ? { autoFocus: true, disableAutoFocusItem: false, onKeyDown: navigate } : {})}
      open={open}
      hideBackdrop
      sx={{ pointerEvents: 'none' }}
      slotProps={{
        paper: {
          className: 'ofp-custom-context-menu',
          sx: { pointerEvents: 'auto' },
        },
        ...(listRef || listLabel || resolvedListKeyDown
          ? {
              list: {
                'aria-label': listLabel,
                autoFocus: true,
                ref: listRef,
                onKeyDown: resolvedListKeyDown,
              },
            }
          : {}),
      }}
      anchorEl={anchorEl}
      anchorReference={anchorEl ? 'anchorEl' : 'anchorPosition'}
      anchorPosition={hasAnchorPosition ? { top: mouseY, left: mouseX } : undefined}
    >
      {children}
    </Menu>
  );
}
