import type { Crop } from '../api/types';

/** The `#RRGGBB` form a crop's display color is stored and exchanged in. */
export const DISPLAY_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const INHERIT_DISPLAY_COLOR = 'inherit';
export const FALLBACK_CROP_DISPLAY_COLOR = '#3b82f6';

export function getCropDisplayColor(crop?: Pick<Crop, 'effective_display_color' | 'display_color'> | null) {
  return crop?.effective_display_color || crop?.display_color;
}
