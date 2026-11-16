import { useState } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ClickAwayListener, IconButton } from '@mui/material';

import { AppTooltip } from '../components/AppTooltip';

interface FieldInfoButtonProps {
  /** The help text shown in the tooltip. */
  title: string;
  /** The button's accessible name, e.g. "Info about Growth duration (days)". */
  ariaLabel: string;
  /** Heading help also opens on hover/focus, with a larger touch target. */
  contextual?: boolean;
}

/**
 * The info icon at the end of a form field. Unlike `FieldInfoIcon` (headings
 * and labels) its default opens only on click, tap or keyboard, so
 * hovering or focusing the field itself shows nothing. Escape, a click
 * elsewhere or moving focus away closes it. It stays active inside a disabled
 * field, where it explains why the field is disabled. Contextual heading help
 * additionally supports hover/focus; a click keeps it open until dismissed.
 */
export function FieldInfoButton({ title, ariaLabel, contextual = false }: FieldInfoButtonProps) {
  const [openKind, setOpenKind] = useState<'hover' | 'focus' | 'click' | null>(null);
  const open = openKind !== null;
  const close = () => setOpenKind(null);

  return (
    <ClickAwayListener onClickAway={close}>
      <span style={{ display: 'inline-flex' }}>
        <AppTooltip
          title={title}
          open={open}
          onOpen={event => setOpenKind(previous => previous ?? (event.type === 'focus' ? 'focus' : 'hover'))}
          onClose={event => { if (openKind !== 'click' || event.type === 'keydown') close(); }}
          describeChild
          disableHoverListener={!contextual}
          disableFocusListener={!contextual}
          disableTouchListener
          slotProps={contextual ? { tooltip: { sx: {
            typography: 'body2', maxWidth: 'min(360px, calc(100vw - 32px))',
            maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
          } } } : undefined}
        >
          <IconButton
            size={contextual ? 'large' : 'small'}
            aria-label={ariaLabel}
            aria-expanded={open}
            data-testid="field-info-button"
            onClick={(event) => {
              // A click inside the field must not move focus into its input.
              event.stopPropagation();
              setOpenKind(current => current === 'click' ? null : 'click');
            }}
            onKeyDown={(event) => {
              // Escape closes an open tooltip only, not the dialog around the field.
              if (event.key === 'Escape' && open) {
                event.stopPropagation();
                close();
              }
            }}
            onBlur={close}
            sx={{ color: 'text.secondary', pointerEvents: 'auto' }}
          >
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </AppTooltip>
      </span>
    </ClickAwayListener>
  );
}
