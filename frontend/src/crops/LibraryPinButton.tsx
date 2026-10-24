import { useId, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { Box, Button, IconButton, Popover, Typography } from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import type { TFunction } from 'i18next';
import { AppTooltip } from '../components/AppTooltip';

interface LibraryPinButtonProps {
  /** The linked library entry's value, formatted; absent when it is not known. */
  libraryValue?: string;
  onUnpin: () => void;
  t: TFunction;
}

/**
 * The filled pin at the end of a pinned field. Pinning itself happens only in
 * the sync dialogs; here the pin shows the library value (tooltip) and opens a
 * small popover whose "Fixierung lösen" releases the pin in the form state.
 * A click never releases directly: touch has no hover, and a stray tap must
 * not undo a deliberate decision.
 */
export function LibraryPinButton({ libraryValue, onUnpin, t }: LibraryPinButtonProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const popoverId = useId();
  const unpinButtonRef = useRef<HTMLButtonElement>(null);
  const hasValue = libraryValue !== undefined;
  const tooltip = hasValue
    ? t('library.pin.tooltip', { value: libraryValue })
    : t('library.pin.tooltipPending');
  const ariaLabel = hasValue
    ? t('library.pin.ariaLabel', { value: libraryValue })
    : t('library.pin.ariaLabelPending');

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);
  const handleUnpin = () => {
    handleClose();
    onUnpin();
  };

  // The pin sits inside a field that has its own help tooltip. React bubbles
  // events through portals, so hover and focus on the pin or in its popover
  // would open that tooltip over the popover; they stop here.
  const stop = (event: SyntheticEvent) => event.stopPropagation();

  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex' }}
      onMouseOver={stop}
      onMouseLeave={stop}
      onFocus={stop}
      onBlur={stop}
      onTouchStart={stop}
      onTouchEnd={stop}
    >
      <AppTooltip title={tooltip} open={anchorEl ? false : undefined}>
        <IconButton
          size="small"
          edge="end"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={anchorEl ? true : undefined}
          aria-controls={anchorEl ? popoverId : undefined}
          onClick={handleOpen}
          onMouseDown={(event) => event.preventDefault()}
          data-testid="crop-form-library-pin"
          sx={{ color: 'libraryLocal.main' }}
        >
          <PushPinIcon fontSize="small" />
        </IconButton>
      </AppTooltip>
      <Popover
        id={popoverId}
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        // MUI's own autofocus scrolls the surrounding crop dialog back to its
        // top on a phone; focusing the action without scrolling keeps the
        // field in view and the popover keyboard-ready.
        disableAutoFocus
        slotProps={{
          paper: { role: 'dialog', 'aria-label': t('library.pin.popoverTitle') },
          transition: { onEntered: () => unpinButtonRef.current?.focus({ preventScroll: true }) },
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, maxWidth: (theme) => theme.spacing(40) }} data-testid="crop-form-library-pin-popover">
          <Typography variant="subtitle2" sx={{ color: 'libraryLocal.main' }}>
            {t('library.pin.popoverTitle')}
          </Typography>
          {hasValue ? (
            <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
              {t('library.pin.popoverLibraryValue', { value: libraryValue })}
            </Typography>
          ) : null}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button ref={unpinButtonRef} size="small" onClick={handleUnpin}>
              {t('library.pin.unpin')}
            </Button>
          </Box>
        </Box>
      </Popover>
    </Box>
  );
}
