import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

/**
 * The brief green flash that points the user at a row or card the app just
 * brought into view (a jump target on the fields page, a newly created
 * planting plan). Matches the app's "selected" green rather than a yellow
 * marker. With reduced motion the tint holds and then disappears in one step
 * instead of fading.
 */
export const HIGHLIGHT_FLASH_DURATION_MS = 2500;

const flashName = 'ofp-highlight-flash';
const holdName = 'ofp-highlight-hold';

export const highlightFlashKeyframesSx = {
  [`@keyframes ${flashName}`]: {
    '0%': { backgroundColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.22) },
    '70%': { backgroundColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.14) },
    '100%': { backgroundColor: 'transparent' },
  },
  [`@keyframes ${holdName}`]: {
    '0%, 99%': { backgroundColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.18) },
    '100%': { backgroundColor: 'transparent' },
  },
} as const;

/** Spread into the `sx` of the element that flashes (keyframes must be in scope, see above). */
export const highlightFlashAnimationSx = {
  animation: `${flashName} ${HIGHLIGHT_FLASH_DURATION_MS}ms ease-out`,
  '@media (prefers-reduced-motion: reduce)': {
    animation: `${holdName} ${HIGHLIGHT_FLASH_DURATION_MS}ms steps(1, end)`,
  },
} as const;
