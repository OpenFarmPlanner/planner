// Shared `sx` for the notification surfaces: the two dropdown entry points
// (topbar bell, compact "Mehr" menu) and the full history page.

import type { SxProps, Theme } from '@mui/material/styles';

/**
 * One notification row inside a dropdown. Deliberately tighter than a default
 * menu row: the dropdown lists only unread entries, so it should read as a
 * short glanceable stack rather than as a page.
 */
export const NOTIFICATION_DROPDOWN_ROW_SX: SxProps<Theme> = {
  alignItems: 'flex-start',
  display: 'block',
  px: 2,
  py: 0.75,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '&:last-of-type': { borderBottom: 'none' },
};

/** The bell dropdown's title row: title left, "mark all as read" right. */
export const NOTIFICATION_MENU_HEADER_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
  pl: 2,
  pr: 1,
  py: 0.5,
};

/**
 * "Mark all as read" as a compact text action inside the dropdown's title row.
 * Coloured and weighted like the text `Button` that carries the same action on
 * the history page (`MuiButton` in theme.ts), so it reads as clickable at rest;
 * only the size stays `body2` to keep the title row on one line. Disabled, it
 * keeps the plain text colour, dimmed by `MenuItem`'s own disabled opacity.
 */
export const NOTIFICATION_MENU_HEADER_ACTION_SX: SxProps<Theme> = {
  minHeight: 0,
  px: 1,
  py: 0.5,
  borderRadius: 1,
  typography: 'body2',
  fontWeight: 600,
  color: 'primary.main',
  '&.Mui-disabled': { color: 'text.primary' },
};

/** The subtle "nothing new" hint that replaces the list when all is read. */
export const NOTIFICATION_HINT_SX: SxProps<Theme> = { px: 2, py: 1 };

/** Accent dot marking an unread row, in the dropdown and on the history page. */
export const NOTIFICATION_UNREAD_DOT_SX = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
  // Kept in the layout when read so switching a row to read does not shift its text.
  mt: 0.75,
} as const;
