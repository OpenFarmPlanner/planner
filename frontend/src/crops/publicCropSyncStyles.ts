import { alpha, darken, getContrastRatio } from '@mui/material/styles';
import type { PaletteColor, Theme } from '@mui/material/styles';
import type { PublicCropSyncChoice } from './publicCropSync';

/**
 * Each column of the library sync speaks the colour of its direction, the same
 * one the crop list's status icon and the library button use: taking the
 * library value is pull (`info`, blue), sharing mine is push (`warning`,
 * orange), and "Nur lokal" is the pin colour (`libraryLocal`, violet).
 */
export const SYNC_COLUMN_PALETTE = {
  library: 'info',
  mine: 'warning',
  local: 'libraryLocal',
} as const satisfies Record<PublicCropSyncChoice, keyof Theme['palette']>;

const MIN_TEXT_CONTRAST = 4.5;
// Headroom for the light column tint the text may sit on.
const TINT_CONTRAST_MARGIN = 0.5;

function syncColumnPaletteColor(theme: Theme, choice: PublicCropSyncChoice): PaletteColor {
  const color = theme.palette[SYNC_COLUMN_PALETTE[choice]] as PaletteColor | undefined;
  // Isolated tests may render without the app palette.
  return color ?? theme.palette.primary;
}

/** The column's tint behind a chosen value (and, lighter, on hover). */
export function syncColumnTint(theme: Theme, choice: PublicCropSyncChoice, opacity = theme.palette.action.selectedOpacity): string {
  return alpha(syncColumnPaletteColor(theme, choice).main, opacity);
}

/**
 * The column colour for text and icons: its `dark` shade, darkened further
 * until it reads at ≥ 4.5:1 on the column's tint (MUI's `warning.dark` alone
 * stays below that on white).
 */
export function syncColumnTextColor(theme: Theme, choice: PublicCropSyncChoice): string {
  const paletteColor = syncColumnPaletteColor(theme, choice);
  const background = theme.palette.background.paper;
  let color = choice === 'local' ? paletteColor.main : paletteColor.dark;
  for (let step = 0; step < 10 && getContrastRatio(color, background) < MIN_TEXT_CONTRAST + TINT_CONTRAST_MARGIN; step += 1) {
    color = darken(color, 0.1);
  }
  return color;
}

/** The column's border and check-mark colour for a chosen value. */
export function syncColumnAccent(theme: Theme, choice: PublicCropSyncChoice): string {
  return syncColumnPaletteColor(theme, choice).main;
}
