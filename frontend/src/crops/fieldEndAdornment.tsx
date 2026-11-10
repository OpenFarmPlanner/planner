import type { ReactNode } from 'react';
import { InputAdornment } from '@mui/material';

import type { LibraryFieldPinProps } from './libraryFieldPinProps';

/**
 * A field's end adornment: its info button (if any) followed by its library
 * pin (if pinned), so the two always sit in the same order. Without an info
 * button the pin's own adornment is used unchanged.
 */
export function buildFieldEndAdornment(
  info: ReactNode,
  pin: LibraryFieldPinProps | null | undefined,
): ReactNode {
  if (!info) {
    return pin?.endAdornment;
  }
  return (
    <InputAdornment position="end" sx={{ gap: 0.25 }}>
      {info}
      {pin?.button}
    </InputAdornment>
  );
}
