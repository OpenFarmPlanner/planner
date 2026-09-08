import { alpha, type Theme } from '@mui/material/styles';

export const cropChevronButtonSx = {
  width: 30,
  height: 30,
  minWidth: 30,
  p: 0,
  mr: 0.5,
  color: 'text.primary',
  opacity: 0.72,
  flexShrink: 0,
  '&:hover': {
    opacity: 1,
    bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.08),
  },
} as const;

export const desktopCropChevronButtonSx = {
  ...cropChevronButtonSx,
  mt: -0.375,
} as const;

// Used by CropHierarchyRow (the shared compact row) — dimmer at rest so the
// variety-count badge reads as the primary signal, only picking up full
// contrast on hover/focus.
export const compactCropChevronButtonSx = {
  ...cropChevronButtonSx,
  width: 24,
  height: 24,
  minWidth: 24,
  opacity: 0.4,
  '&:hover': {
    opacity: 1,
    bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.08),
  },
} as const;

/** Minimum touch target size for the mobile selector dialogs, in pixels. */
export const MOBILE_TOUCH_TARGET_SIZE = 44;

/** Minimum row height for the mobile selector dialogs, in pixels. */
export const MOBILE_ROW_MIN_HEIGHT = 48;

// Used by the fullscreen mobile selector dialogs: the chevron keeps its small
// icon, but the button spans the full mobile touch target so the toggle stays
// tappable next to the (row-wide) select target.
export const mobileCropChevronButtonSx = {
  ...cropChevronButtonSx,
  width: MOBILE_TOUCH_TARGET_SIZE,
  height: MOBILE_TOUCH_TARGET_SIZE,
  minWidth: MOBILE_TOUCH_TARGET_SIZE,
  mr: 0.25,
} as const;
