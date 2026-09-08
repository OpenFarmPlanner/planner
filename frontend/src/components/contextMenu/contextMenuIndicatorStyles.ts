import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

/** Applied to the `ContextMenuIndicator` button itself, to reveal it. */
export const CONTEXT_MENU_INDICATOR_CLASS = 'ofp-context-menu-indicator';

/** The class every "actions overlay" host targets to reveal its indicator(s). */
const revealOnHoverOrFocus = {
  opacity: 1,
  pointerEvents: 'auto' as const,
};

/**
 * Spread into a hoverable/focusable ancestor's `sx` (e.g. a Gantt bar, a
 * chart segment, a sidebar tree row) so any `ContextMenuIndicator` rendered
 * inside it fades in on hover/focus-within. On touch devices it stays
 * hidden at all times — a long press opens the context menu directly
 * instead of relying on the icon.
 *
 * Both `:hover` and `:focus-within` are wrapped in `@media (hover: hover)`
 * — a touch device reports `(hover: none)` even while a finger is actually
 * pressed on the element, but *tapping* a focusable row (this component
 * always sets `tabIndex`) still satisfies plain `:focus-within` on any
 * device. Without the media guard, a single tap on touch would focus the
 * row and reveal the icon exactly like a real hover would on desktop.
 * Use this for simple cases with no adjacent truncated text to mask — for
 * data-grid-style rows, use `contextMenuActionsOverlaySx` instead.
 */
export const contextMenuIndicatorHostSx: SystemStyleObject<Theme> = {
  '@media (hover: hover)': {
    [`&:hover .${CONTEXT_MENU_INDICATOR_CLASS}, &:focus-within .${CONTEXT_MENU_INDICATOR_CLASS}`]: revealOnHoverOrFocus,
  },
};

/**
 * The positioned, gradient-masked overlay panel used by table-style rows
 * (DataGrid, hierarchy tree, Suppliers, SeedDemand) to host one or more
 * inline action buttons (including a `ContextMenuIndicator`) at the right
 * edge of a cell whose text would otherwise be truncated underneath it.
 * `hoverSelector` is the CSS selector (relative to the row) that reveals
 * the overlay — e.g. `.MuiDataGrid-row:hover &` for DataGrid-based rows, or
 * `tr:hover &` for a plain MUI `<TableRow>`. `focusWithinSelector` is an
 * optional extra reveal condition for keyboard users on plain tables that
 * don't already have DataGrid's own cell-focus handling — it only toggles
 * opacity/pointer-events, skipping the background/gradient touch-up
 * `hoverSelector` gets. Prefer `tr:has(:focus-visible) &` over
 * `tr:focus-within &` when the row contains a link or other control that
 * takes focus on a plain mouse click: `:focus-within` would latch the
 * overlay open until the user clicks elsewhere (e.g. after clicking an
 * external homepage link), while `:focus-visible` still reveals it for
 * keyboard navigation.
 *
 * Like `contextMenuIndicatorHostSx`, this stays hidden at all times on
 * touch devices — a long press opens the same context menu directly, so
 * the overlay's icons (edit, delete, the `ContextMenuIndicator`) would
 * otherwise sit on top of the row permanently and truncate its text for no
 * reachability benefit. Every reveal rule below is wrapped in
 * `@media (hover: hover)`: a touch device reports `(hover: none)` even
 * while actively pressed, but a *tap* on this row (every caller sets
 * `tabIndex` on it) still satisfies plain `:focus-within` on any device —
 * without the media guard, one tap on touch would focus the row and reveal
 * the icons exactly like a real desktop hover would.
 */
/**
 * The cell content wrapper that hosts a `contextMenuActionsOverlaySx` panel:
 * it establishes the positioning context the absolutely-positioned overlay
 * needs and clips the text the overlay slides over. Used by the plain
 * `<TableRow>` tables (Suppliers, SeedDemand); the DataGrid and hierarchy rows
 * bring their own wrappers.
 */
export const contextMenuActionsCellSx: SystemStyleObject<Theme> = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  width: '100%',
  overflow: 'hidden',
};

/** The truncated cell text inside `contextMenuActionsCellSx`. */
export const contextMenuActionsCellTextSx: SystemStyleObject<Theme> = {
  display: 'block',
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export function contextMenuActionsOverlaySx(
  hoverSelector: string,
  focusWithinSelector?: string,
): SystemStyleObject<Theme> {
  return {
    position: 'absolute',
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.5,
    py: 0.25,
    pl: 0.25,
    pr: 0.25,
    borderRadius: 1,
    bgcolor: 'background.paper',
    opacity: 0,
    pointerEvents: 'none',
    transition: 'background-color 120ms ease-in-out, opacity 120ms ease-in-out',
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      right: '100%',
      width: 16,
      pointerEvents: 'none',
      background: (theme: Theme) =>
        `linear-gradient(90deg, ${alpha(theme.palette.background.paper, 0)} 0%, ${theme.palette.background.paper} 100%)`,
    },
    '@media (hover: hover)': {
      [hoverSelector]: {
        bgcolor: 'surface.surfaceHoverBackground',
        ...revealOnHoverOrFocus,
      },
      [`${hoverSelector}::before`]: {
        background: (theme: Theme) => {
          const hoverBackground = theme.palette.surface?.surfaceHoverBackground ?? theme.palette.action.hover;
          return `linear-gradient(90deg, ${alpha(hoverBackground, 0)} 0%, ${hoverBackground} 100%)`;
        },
      },
      // A nested ContextMenuIndicator hides itself by default (for the
      // simple-host case elsewhere), so it needs its own reveal rule here
      // too — the panel's own opacity/pointer-events above don't override a
      // child's explicitly-set opacity:0/pointer-events:none.
      [`${hoverSelector} .${CONTEXT_MENU_INDICATOR_CLASS}`]: revealOnHoverOrFocus,
      ...(focusWithinSelector
        ? {
            [focusWithinSelector]: revealOnHoverOrFocus,
            [`${focusWithinSelector} .${CONTEXT_MENU_INDICATOR_CLASS}`]: revealOnHoverOrFocus,
          }
        : {}),
    },
  };
}
