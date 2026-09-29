import { useCallback, useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { OverflowTooltip } from '../OverflowTooltip';
import { SearchHighlightedText } from '../../search/SearchHighlightedText';

interface CompactAreaCellProps {
  label: string;
  hasFocus?: boolean;
  /**
   * Turns the cell into the trigger for its own editor. Passing this makes a
   * single left click (and Enter/Space on the focused cell) open the editor
   * directly, without the grid's inline edit mode in between.
   */
  onOpen?: () => void;
  /** Shown instead of `label` while no area is assigned yet. */
  placeholder?: string;
  /** Accessible name for the trigger; only used together with `onOpen`. */
  triggerLabel?: string;
  /** Increment to move focus back to the trigger after an external editor closes. */
  focusRequest?: number;
  /** Keeps focus where it is while the editor itself is open. */
  suppressFocus?: boolean;
}

export function CompactAreaCell({
  label,
  hasFocus = false,
  onOpen,
  placeholder,
  triggerLabel,
  focusRequest = 0,
  suppressFocus = false,
}: CompactAreaCellProps) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const focusRestoreHandlesRef = useRef<{ frames: number[]; timeouts: number[] }>({ frames: [], timeouts: [] });
  const displayText = label || placeholder || '';

  const clearFocusRestore = useCallback(() => {
    focusRestoreHandlesRef.current.frames.forEach((frame) => cancelAnimationFrame(frame));
    focusRestoreHandlesRef.current.timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    focusRestoreHandlesRef.current = { frames: [], timeouts: [] };
  }, []);

  const scheduleTriggerFocus = useCallback(() => {
    clearFocusRestore();
    const focusTrigger = () => {
      triggerRef.current?.focus();
    };

    const firstFrame = requestAnimationFrame(() => {
      focusTrigger();
      const secondFrame = requestAnimationFrame(focusTrigger);
      focusRestoreHandlesRef.current.frames.push(secondFrame);
    });
    focusRestoreHandlesRef.current = {
      frames: [firstFrame],
      timeouts: [
        window.setTimeout(focusTrigger, 10),
        window.setTimeout(focusTrigger, 50),
      ],
    };
  }, [clearFocusRestore]);

  useEffect(() => clearFocusRestore, [clearFocusRestore]);

  useEffect(() => {
    if (!hasFocus || suppressFocus) {
      return undefined;
    }

    scheduleTriggerFocus();
    return clearFocusRestore;
  }, [clearFocusRestore, hasFocus, scheduleTriggerFocus, suppressFocus]);

  useEffect(() => {
    if (focusRequest <= 0 || suppressFocus) {
      return undefined;
    }

    scheduleTriggerFocus();
    return clearFocusRestore;
  }, [clearFocusRestore, focusRequest, scheduleTriggerFocus, suppressFocus]);

  return (
    <OverflowTooltip title={displayText}>
      <Box
        ref={triggerRef}
        role={onOpen ? 'button' : undefined}
        aria-label={onOpen ? triggerLabel : undefined}
        aria-haspopup={onOpen ? 'dialog' : undefined}
        onClick={onOpen}
        onKeyDown={onOpen ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
          }
        } : undefined}
        sx={{
          width: '100%',
          minWidth: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          height: '100%',
          ...(onOpen
            ? {
              cursor: 'pointer',
              borderRadius: 0.5,
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: '1px',
              },
            }
            : {}),
        }}
        tabIndex={hasFocus ? 0 : -1}
      >
        <Typography
          variant="body2"
          noWrap
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: label ? 'text.primary' : 'text.disabled',
          }}
        >
          {label ? <SearchHighlightedText text={label} /> : displayText}
        </Typography>
      </Box>
    </OverflowTooltip>
  );
}
