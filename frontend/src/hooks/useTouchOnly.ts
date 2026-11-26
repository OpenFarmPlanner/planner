import { useMediaQuery } from '@mui/material';

/** A touch pointer with no connected input that can hover. */
export function useTouchOnly(): boolean {
  return useMediaQuery('(any-pointer: coarse) and (any-hover: none)');
}
