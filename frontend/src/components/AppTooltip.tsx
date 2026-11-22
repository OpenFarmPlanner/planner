import { useState } from 'react';
import { Tooltip, type TooltipProps } from '@mui/material';
import { useContextMenuOpenSnapshot } from './contextMenu/contextMenuOpenState';

const EXPLANATORY_HOVER_DELAY = 600;

/**
 * The app's tooltip. Use this everywhere instead of MUI's `Tooltip` (enforced
 * by the `no-restricted-imports` rule in eslint.config.js) — it behaves
 * exactly like MUI's, including all delays, but is suppressed while any
 * context menu is open so a tooltip can never cover the menu.
 *
 * Suppression is real, not visual: an open tooltip closes, MUI's hover/focus/
 * touch listeners are disabled, and a tooltip whose enter delay elapses while
 * the menu is open never opens. An uncontrolled tooltip remembers *which*
 * menu generation it was opened in (`openSequence`), so a menu opening
 * invalidates it for good — closing the menu leaves no stale tooltip behind,
 * and the next hover, focus or long press opens one again as usual.
 */
export function AppTooltip({
  open,
  onOpen,
  onClose,
  disableHoverListener,
  disableFocusListener,
  disableTouchListener,
  explanatory,
  enterDelay,
  enterNextDelay,
  ...props
}: TooltipProps & { explanatory?: boolean }) {
  const { open: contextMenuOpen, openSequence } = useContextMenuOpenSnapshot();
  const [openedInSequence, setOpenedInSequence] = useState<number | null>(null);

  const uncontrolledOpen = openedInSequence === openSequence;
  const effectiveOpen = contextMenuOpen ? false : (open ?? uncontrolledOpen);

  return (
    <Tooltip
      {...props}
      open={effectiveOpen}
      enterDelay={enterDelay ?? (explanatory ? EXPLANATORY_HOVER_DELAY : undefined)}
      enterNextDelay={enterNextDelay ?? (explanatory ? EXPLANATORY_HOVER_DELAY : undefined)}
      onOpen={(event) => {
        if (contextMenuOpen) {
          return;
        }
        setOpenedInSequence(openSequence);
        onOpen?.(event);
      }}
      onClose={(event) => {
        setOpenedInSequence(null);
        onClose?.(event);
      }}
      disableHoverListener={contextMenuOpen || disableHoverListener}
      disableFocusListener={contextMenuOpen || disableFocusListener}
      disableTouchListener={contextMenuOpen || disableTouchListener}
    />
  );
}
