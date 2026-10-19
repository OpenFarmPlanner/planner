// Shared styling for the topbar action menus (ProjectMenu, GlobalMenu):
// the leading icon column and the icon size used inside their menu items.

export const ACTION_MENU_ITEM_ICON_SX = { minWidth: 32, color: 'text.secondary' } as const;
export const ACTION_MENU_ICON_PROPS = { fontSize: 'small' } as const;

// Count badges anchored to a topbar IconButton (moderation queue, "Mehr"/more
// actions, the notification bell). MUI's default anchor centers the badge on
// the button's top edge, which sits close enough to the very top of the page
// that half the badge pokes past it; nudging the anchor down keeps it a
// complete, unclipped circle. See commit a2a2f6fd for why the ancestors'
// `overflow` can't be the fix instead.
export const TOPBAR_BADGE_SX = { '& .MuiBadge-badge': { top: 6 } } as const;

// Section label rows inside the topbar menus ("APP", "ACCOUNT",
// "BENACHRICHTIGUNGEN", "PROJEKTAKTIONEN"). They are `MenuItem`s only so MUI
// keeps them in the list it renders; as labels they are never a touch target,
// so the item's default minimum height is dropped in favour of compact padding.
export const MENU_SECTION_LABEL_SX = {
  opacity: 1,
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  minHeight: 0,
  py: 0.25,
} as const;
