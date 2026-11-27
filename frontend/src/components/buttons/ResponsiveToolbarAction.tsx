import { useRef, useState, type ReactNode, type Ref } from 'react';
import { Box, Button, type ButtonProps } from '@mui/material';
import type { Breakpoint } from '@mui/material/styles';
import { AppTooltip } from '../AppTooltip';
import { getStandardActionButtonSx } from './segmentedControlStyles';

interface ResponsiveToolbarActionProps extends Omit<ButtonProps, 'children' | 'sx' | 'startIcon'> {
  label: string;
  icon: ReactNode;
  labelQuery?: string;
  labelBreakpoint?: Breakpoint;
  iconOnly?: boolean;
  ref?: Ref<HTMLButtonElement>;
  help?: string;
  disabledReason?: string;
}

export const LIST_TOOLBAR_LABEL_QUERY = '@container list-toolbar (min-width: 52rem)';
export const WORKSPACE_TOOLBAR_LABEL_QUERY = '@container workspace-topbar (min-width: 70rem)';
export const TOOLBAR_ACTION_MIN_HEIGHT = 44;

export function ResponsiveToolbarAction({
  label, icon, labelQuery, labelBreakpoint, iconOnly, help, disabledReason, onClick, ref, ...buttonProps
}: ResponsiveToolbarActionProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const activated = useRef(false);
  const suppressRestoredFocus = useRef(false);
  const description = buttonProps.disabled ? disabledReason : help;
  const labelledSx = { px: 1.5, gap: 0.75, '& [data-toolbar-action-label]': { display: 'inline' } };
  const allowTooltip = () => { activated.current = false; };

  return (
    <AppTooltip
      title={description ? <>{label}<Box>{description}</Box></> : label}
      open={tooltipOpen}
      onOpen={event => {
        if (event.type === 'focus' && suppressRestoredFocus.current) {
          suppressRestoredFocus.current = false;
          return;
        }
        if (!activated.current) setTooltipOpen(true);
      }}
      onClose={() => setTooltipOpen(false)}
      describeChild
      disableInteractive
      leaveTouchDelay={0}
    >
      <Box component="span" sx={{ display: 'inline-flex' }} onPointerLeave={allowTooltip} onBlur={allowTooltip}>
        <Button
          ref={ref}
          {...buttonProps}
          aria-label={buttonProps['aria-label'] ?? label}
          onClick={event => {
            activated.current = true;
            suppressRestoredFocus.current = Boolean(buttonProps['aria-haspopup']);
            setTooltipOpen(false);
            onClick?.(event);
          }}
          sx={theme => ({
            ...getStandardActionButtonSx(true),
            minHeight: TOOLBAR_ACTION_MIN_HEIGHT,
            minWidth: 44,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            ...(iconOnly ? { '& [data-toolbar-action-label]': { display: 'none' } } : labelQuery ? {
              '& [data-toolbar-action-label]': { display: 'none' },
              [labelQuery]: labelBreakpoint ? { [theme.breakpoints.up(labelBreakpoint)]: labelledSx } : labelledSx,
            } : labelledSx),
          })}
        >
          {icon}
          <Box component="span" data-toolbar-action-label aria-hidden="true">{label}</Box>
        </Button>
      </Box>
    </AppTooltip>
  );
}
