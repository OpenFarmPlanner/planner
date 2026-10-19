import type { Theme } from '@mui/material/styles';

/** Width of the side navigation column on the settings pages. */
export const SETTINGS_SIDE_NAV_WIDTH = 232;

/** Readable maximum width of the settings content column. */
export const SETTINGS_CONTENT_MAX_WIDTH = 820;

/** Minimum touch target height for settings navigation links and actions. */
const MIN_TOUCH_TARGET = 44;

/**
 * Keeps a section heading clear of the sticky topbar when a navigation link or
 * deep link scrolls it into view.
 */
export const settingsSectionScrollMarginSx = { scrollMarginTop: 80 } as const;

/** Info hints inside settings sections are flat: the theme's toast shadow would read as a floating card. */
export const settingsFlatAlertSx = { boxShadow: 'none' } as const;

/**
 * Full-width buttons and fields on phones, intrinsic width from `sm` up.
 * Applied to the footer actions and standalone buttons of every section.
 */
export const settingsActionButtonSx = { width: { xs: '100%', sm: 'auto' }, minHeight: MIN_TOUCH_TARGET } as const;

/**
 * MUI's disabled button colours (`action.disabled`, 26% black) fall well below
 * a readable contrast. A disabled Save is the normal resting state of a
 * settings form, so its label has to stay legible.
 */
export const settingsReadableDisabledButtonsSx = {
  '& .MuiButton-root.Mui-disabled': {
    color: 'text.secondary',
  },
  '& .MuiButton-outlined.Mui-disabled': {
    borderColor: 'divider',
  },
} as const;

/** Shared look of a settings navigation link; palette paths keep it theme-driven. */
export const settingsNavLinkBaseSx = {
  display: 'flex',
  alignItems: 'center',
  minHeight: MIN_TOUCH_TARGET,
  boxSizing: 'border-box',
  textDecoration: 'none',
  fontSize: '0.95rem',
  whiteSpace: 'nowrap',
  '&:hover': { bgcolor: 'navigation.hoverBackground', textDecoration: 'none' },
  '&:focus-visible': {
    outline: (theme: Theme) => `2px solid ${theme.palette.primary.main}`,
    outlineOffset: -2,
  },
} as const;
