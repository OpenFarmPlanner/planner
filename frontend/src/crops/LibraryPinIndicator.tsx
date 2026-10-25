import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import type { TFunction } from 'i18next';
import { AppTooltip } from '../components/AppTooltip';
import { getLibraryPinTooltip } from './libraryFieldPin';

interface LibraryPinIndicatorProps {
  /** The linked library entry's value, formatted; absent when it is not known. */
  libraryValue?: string;
  t: TFunction;
}

/**
 * The read-view counterpart of `LibraryPinButton`: the same filled pin and
 * tooltip after a pinned value, without an action. It is focusable so the
 * tooltip is reachable by keyboard, and a tap opens it on touch.
 */
export function LibraryPinIndicator({ libraryValue, t }: LibraryPinIndicatorProps) {
  const tooltip = getLibraryPinTooltip(libraryValue, t);
  return (
    <AppTooltip title={tooltip} enterTouchDelay={0}>
      <Box
        component="span"
        role="img"
        tabIndex={0}
        aria-label={tooltip}
        data-testid="crop-detail-library-pin"
        sx={{
          display: 'inline-flex',
          flexShrink: 0,
          color: 'libraryLocal.main',
          borderRadius: 1,
        }}
      >
        <PushPinIcon fontSize="small" />
      </Box>
    </AppTooltip>
  );
}

/**
 * A detail value followed by its pin. Without a pin the value renders
 * unchanged, so its layout and the variety highlight stay as they are.
 */
export function ValueWithLibraryPin({ pin, children }: { pin?: ReactNode; children: ReactNode }) {
  if (!pin) {
    return <>{children}</>;
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      {children}
      {pin}
    </Box>
  );
}
