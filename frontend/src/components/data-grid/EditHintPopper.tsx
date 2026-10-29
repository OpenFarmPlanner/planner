import { useEffect } from 'react';
import { Box, ClickAwayListener, Popper } from '@mui/material';
import { useTranslation } from '../../i18n';
import { ContextMenuHint } from './ContextMenuHint';
import type { EditHintControls } from './useEditHint';

const EDIT_HINT_AUTO_HIDE_MS = 6000;
const ARROW_SIZE_PX = 16;

type EditHintPopperProps = Pick<EditHintControls, 'anchorEl' | 'close' | 'dismiss'>;

/**
 * The table edit hint, pointing at the cell the user just clicked. It looks
 * like the right-click tip above the tables (ContextMenuHint) so both tips
 * read as one family. It leaves on its own after a few seconds, on the next
 * click, on scrolling and on Escape; only the close button retires it.
 */
export function EditHintPopper({ anchorEl, close, dismiss }: EditHintPopperProps) {
  const { t } = useTranslation('common');
  const open = anchorEl !== null;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const timer = window.setTimeout(close, EDIT_HINT_AUTO_HIDE_MS);
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    // Capture: the grid scrolls inside its own container, not the window.
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [close, open]);

  return (
    <Popper
      open={open}
      anchorEl={anchorEl}
      placement="bottom-start"
      modifiers={[
        { name: 'offset', options: { offset: [0, ARROW_SIZE_PX / 2 + 2] } },
        { name: 'flip', options: { fallbackPlacements: ['top-start'] } },
        { name: 'arrow', options: { element: '[data-edit-hint-arrow]', padding: 12 } },
      ]}
      sx={{
        zIndex: (theme) => theme.zIndex.tooltip,
        maxWidth: 'calc(100vw - 16px)',
        '&[data-popper-placement^="bottom"] [data-edit-hint-arrow]': {
          top: -ARROW_SIZE_PX / 2,
          '&::before': { top: '100%' },
        },
        '&[data-popper-placement^="top"] [data-edit-hint-arrow]': {
          bottom: -ARROW_SIZE_PX / 2,
          '&::before': { top: 0 },
        },
      }}
    >
      <ClickAwayListener onClickAway={close}>
        <Box role="status" aria-live="polite" sx={{ position: 'relative' }}>
          {/* A solid triangle in the bubble's accent green (a white arrow
              would vanish on the white table). Popper positions this element
              and overwrites its transform, so the rotated square is a
              pseudo-element, clipped to its outer half — MUI Tooltip's arrow
              technique. */}
          <Box
            data-edit-hint-arrow=""
            aria-hidden="true"
            sx={{
              position: 'absolute',
              left: 0,
              width: ARROW_SIZE_PX,
              height: ARROW_SIZE_PX / 2,
              overflow: 'hidden',
              // A diamond whose diagonal equals the arrow width, centred on
              // the bubble's edge: its outer half is the triangle.
              '&::before': {
                content: '""',
                position: 'absolute',
                left: '50%',
                width: ARROW_SIZE_PX / Math.SQRT2,
                height: ARROW_SIZE_PX / Math.SQRT2,
                bgcolor: 'success.main',
                transform: 'translate(-50%, -50%) rotate(45deg)',
              },
            }}
          />
          <ContextMenuHint
            message={t('messages.tableEditHint')}
            onClose={dismiss}
            closeLabel={t('messages.tableEditHintDismiss')}
            prominent
            // Unlike the banner above the table, this one floats over cells,
            // so it needs an opaque surface and a lift.
            sx={{ bgcolor: 'background.paper', boxShadow: 3, whiteSpace: { xs: 'normal', sm: 'nowrap' } }}
          />
        </Box>
      </ClickAwayListener>
    </Popper>
  );
}
