import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

/**
 * Style definitions for the page shells.
 *
 * Kept next to PageContainer rather than inlined so that the few places which
 * render a page shell without going through the component (FieldsBedsHierarchy)
 * cannot drift away from it.
 */

/**
 * Below `sm` the fixed gutter gives way to the device safe-area insets, so
 * content clears a notch in landscape.
 *
 * These are `paddingLeft`/`paddingRight` rather than the logical
 * `paddingInlineStart`/`End` on purpose: `env(safe-area-inset-left)` describes
 * the physical left edge of the device, so a logical property would move the
 * left inset to the right edge once the document direction is RTL.
 */
const SAFE_AREA_LEFT = 'env(safe-area-inset-left, 0px)';
const SAFE_AREA_RIGHT = 'env(safe-area-inset-right, 0px)';

/** Horizontal page gutter, replaced by the safe-area insets below `sm`. */
const pageGutter = {
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: { xs: SAFE_AREA_LEFT, sm: 2 },
  paddingRight: { xs: SAFE_AREA_RIGHT, sm: 2 },
} as const;

/** Centers the shell in the viewport, edge to edge below `sm`. */
const centered = {
  marginTop: 0,
  marginBottom: 0,
  marginLeft: { xs: 0, sm: 'auto' },
  marginRight: { xs: 0, sm: 'auto' },
} as const;

const shell = {
  width: '100%',
  boxSizing: 'border-box',
} as const;

const centeredPage = {
  ...shell,
  ...pageGutter,
  ...centered,
  maxWidth: 1360,
} as const;

/**
 * Full workspace width for data-heavy pages. RootLayout's <main> owns the page
 * gutter from `md` up, so the shell adds none there; below `md` the gutter comes
 * back, which is what the previous stylesheet's `max-width: 900px` block did.
 */
const workspacePage = {
  ...shell,
  ...pageGutter,
  paddingLeft: { xs: SAFE_AREA_LEFT, sm: 2, md: 0 },
  paddingRight: { xs: SAFE_AREA_RIGHT, sm: 2, md: 0 },
  margin: 0,
  maxWidth: 'none',
} as const;

/**
 * Opt-in content inset below `sm` for pages whose content would otherwise run
 * edge to edge on a phone (e.g. the task board). Keeps the safe-area inset when
 * it is larger than the 16px gutter, so a notch in landscape is still cleared.
 * From `sm` up the regular page gutter applies unchanged.
 */
export const MOBILE_INSET_SX = (theme: Theme): SystemStyleObject<Theme> => ({
  [theme.breakpoints.down('sm')]: {
    paddingLeft: `max(${theme.spacing(2)}, ${SAFE_AREA_LEFT})`,
    paddingRight: `max(${theme.spacing(2)}, ${SAFE_AREA_RIGHT})`,
  },
});

export type PageContainerVariant =
  | 'standardCenteredPage'
  | 'compactCenteredPage'
  | 'workspacePage'
  | 'standard'
  | 'wide'
  | 'workspace'
  | 'xwide'
  | 'full'
  | 'wideWorkspace'
  | 'compactCenteredTable';

export const PAGE_CONTAINER_SX: Record<PageContainerVariant, SystemStyleObject<Theme>> = {
  // Recommended categories:
  // - standardCenteredPage: default readable centered page width
  // - compactCenteredPage: compact, centered pages (e.g. Suppliers)
  // - workspacePage: full workspace width for data-heavy pages (e.g. Planting Plans, Gantt)
  standardCenteredPage: centeredPage,
  workspacePage,
  compactCenteredPage: centeredPage,
  // Legacy aliases kept for compatibility with older pages.
  wideWorkspace: workspacePage,
  compactCenteredTable: centeredPage,
  standard: centeredPage,
  wide: { ...centeredPage, maxWidth: 1800 },
  workspace: { ...centeredPage, maxWidth: 'min(1800px, calc(100vw - 48px))' },
  xwide: { ...centeredPage, maxWidth: 1900 },
  full: { ...shell, ...pageGutter },
};
