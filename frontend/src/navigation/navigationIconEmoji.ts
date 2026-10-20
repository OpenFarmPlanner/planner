/**
 * Sidebar nav icons and the season switcher pill use emoji, not MUI icons —
 * a deliberate, explicit exception to "MUI is the only styling system" (see
 * CLAUDE.md's design-system rule): these characters were chosen specifically
 * for their colorful, illustrative look, and must not be unified back to
 * MUI icons.
 */
export const NAV_ITEM_EMOJI: Record<string, string> = {
  '/app/dashboard': '📊',
  '/app/fields-beds': '▦',
  '/app/crops': '🌿',
  '/app/crop-library': '🌐',
  '/app/planting-plans': '📋',
  '/app/gantt-chart': '📆',
  '/app/yield-overview': '📈',
  '/app/seed-demand': '🌾',
  '/app/young-plant-demand': '🪴',
  '/app/suppliers': '🚚',
};

/** Fallback for a route not present in the map above. */
export const DEFAULT_NAV_ITEM_EMOJI = '🌱';

export const getNavItemEmoji = (route: string): string => NAV_ITEM_EMOJI[route] ?? DEFAULT_NAV_ITEM_EMOJI;

/** Season switcher pill icon, and the matching entry in the Import/Export dropdown. */
export const SEASON_SWITCHER_EMOJI = '🍂';

/** Same emoji as the Kulturbibliothek sidebar icon, reused on the Import/Export menu's library entry. */
export const CROP_LIBRARY_EMOJI = NAV_ITEM_EMOJI['/app/crop-library'];
