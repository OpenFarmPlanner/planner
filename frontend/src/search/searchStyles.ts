import type { SxProps, Theme } from '@mui/material';

/** A search hit inside visible text. */
export const searchMarkSx: SxProps<Theme> = {
  bgcolor: 'searchHighlight.background',
  color: 'inherit',
  borderRadius: 0.5,
  fontWeight: 'inherit',
};

/** Text read by screen readers only, in place of the visually marked copy. */
export const visuallyHiddenSx: SxProps<Theme> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  p: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};
