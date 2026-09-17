/**
 * Single-line text that ellipsises at its container's width and reveals the
 * full value in a tooltip — but only while it is actually cut off.
 *
 * The truncation styles and the overflow detection belong together: a bare
 * `textOverflow: 'ellipsis'` leaves the hidden text unreadable, and an
 * unconditional tooltip repeats text the user can already see. Reach for this
 * before writing either half by hand.
 */

import type { ElementType, ReactNode } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import { OverflowTooltip, type OverflowTooltipProps } from './OverflowTooltip';

const truncatedTextSx: SxProps<Theme> = {
  display: 'block',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export interface TruncatedTextWithTooltipProps
  extends Pick<OverflowTooltipProps, 'arrow' | 'placement' | 'enterDelay' | 'slotProps'> {
  /** The full text. Rendered as the content unless `children` overrides it, and used as the tooltip title. */
  text: string;
  /** Optional decorated rendering (highlighting, adornments) for the same `text`. */
  children?: ReactNode;
  /** The rendered element. Defaults to a `span`. */
  component?: ElementType;
  /**
   * Put the text in the tab order so the tooltip also opens on keyboard focus.
   * Off by default: the element is usually inside something already focusable
   * (a button, a MenuItem, a grid cell), and a focus event on that ancestor
   * does not reach this element — so making every truncated label focusable
   * would add a tab stop per label rather than fix that. Opt in where the text
   * is the only thing worth landing on. Mirrors `FullCellTooltip`'s prop.
   */
  focusable?: boolean;
  className?: string;
  'data-testid'?: string;
  sx?: SxProps<Theme>;
}

export function TruncatedTextWithTooltip({
  text,
  children,
  component = 'span',
  focusable = false,
  className,
  sx,
  arrow,
  placement,
  enterDelay,
  slotProps,
  'data-testid': dataTestId,
}: TruncatedTextWithTooltipProps) {
  return (
    <OverflowTooltip title={text} arrow={arrow} placement={placement} enterDelay={enterDelay} slotProps={slotProps}>
      <Box
        component={component}
        tabIndex={focusable ? 0 : undefined}
        className={className}
        data-testid={dataTestId}
        sx={[truncatedTextSx, ...(Array.isArray(sx) ? sx : [sx])]}
      >
        {children ?? text}
      </Box>
    </OverflowTooltip>
  );
}
