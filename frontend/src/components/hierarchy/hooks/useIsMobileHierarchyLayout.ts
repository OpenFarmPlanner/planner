import { useMediaQuery, useTheme } from "@mui/material";

/**
 * Below this viewport height, a phone in landscape gets the touch list even
 * at tablet-width breakpoints: the DataGrid's header + row chrome leaves no
 * room for content once the on-screen keyboard appears, and the notes column
 * is already clipped off-screen at that aspect ratio.
 */
const MOBILE_HIERARCHY_MAX_HEIGHT_PX = 500;

/**
 * Single source of truth for when the Anbauflächen hierarchy switches from
 * the desktop DataGrid to the touch-friendly list + bottom sheet (see
 * `docs/datagrid-architecture.md`, "Mobile layout (< sm)"). Narrower than
 * `sm` covers portrait phones; the height check additionally covers phones
 * in landscape, which are wider than `sm` but too short for the grid.
 */
export function useIsMobileHierarchyLayout(): boolean {
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down("sm"));
  const isShort = useMediaQuery(`(max-height:${MOBILE_HIERARCHY_MAX_HEIGHT_PX - 1}px)`);
  return isNarrow || isShort;
}
