import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

export const varietySpecificValueHighlightSx = {
  display: 'inline-block',
  width: 'fit-content',
  maxWidth: '100%',
  px: 0.5,
  py: 0.125,
  mx: -0.5,
  borderRadius: 0.75,
  backgroundColor: (theme: Theme) => alpha(theme.palette.primary.light, 0.1),
  color: 'inherit',
  overflowWrap: 'anywhere',
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
} as const;

/**
 * Same highlight color/background as `varietySpecificValueHighlightSx`, adapted for
 * form inputs (TextField/Select) instead of static text. Applies to the input's own
 * background so it stays visible even when the field is disabled/read-only.
 */
export const varietySpecificFieldHighlightSx = {
  borderRadius: 1,
  '& .MuiOutlinedInput-root, & .MuiFilledInput-root, & .MuiInputBase-root': {
    backgroundColor: (theme: Theme) => alpha(theme.palette.primary.light, 0.1),
  },
} as const;

/**
 * Combines a field's base layout `sx` with the highlight `sx` values that apply
 * (the variety highlight, the locally-pinned border), skipping absent ones.
 */
export function mergeVarietyFieldSx(
  base: SxProps<Theme>,
  ...overrides: (SxProps<Theme> | undefined)[]
): SxProps<Theme> {
  const present = overrides.filter((overrideSx): overrideSx is SxProps<Theme> => Boolean(overrideSx));
  if (present.length === 0) return base;
  return [base, ...present].flatMap((sx) => (Array.isArray(sx) ? sx : [sx])) as SxProps<Theme>;
}
