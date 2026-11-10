import { useState } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ClickAwayListener, IconButton } from '@mui/material';

import { AppTooltip } from '../components/AppTooltip';

interface FieldInfoButtonProps {
  /** The help text shown in the tooltip. */
  title: string;
  /** The button's accessible name, e.g. "Info about Growth duration (days)". */
  ariaLabel: string;
}

/**
 * The info icon at the end of a form field. Unlike `FieldInfoIcon` (headings
 * and labels) it opens only on click, tap or keyboard, never on hover, so
 * hovering or focusing the field itself shows nothing. Escape, a click
 * elsewhere or moving focus away closes it. It stays active inside a disabled
 * field, where it explains why the field is disabled.
 */
export function FieldInfoButton({ title, ariaLabel }: FieldInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <ClickAwayListener onClickAway={close}>
      <span style={{ display: 'inline-flex' }}>
        <AppTooltip
          title={title}
          open={open}
          onClose={close}
          describeChild
          disableHoverListener
          disableFocusListener
          disableTouchListener
        >
          <IconButton
            size="small"
            aria-label={ariaLabel}
            aria-expanded={open}
            data-testid="field-info-button"
            onClick={(event) => {
              // A click inside the field must not move focus into its input.
              event.stopPropagation();
              setOpen((current) => !current);
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
