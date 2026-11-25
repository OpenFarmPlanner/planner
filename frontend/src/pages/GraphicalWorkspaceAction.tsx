import { useRef, useState, type ReactNode } from 'react';
import { Box, Button, type ButtonProps } from '@mui/material';
import { AppTooltip } from '../components/AppTooltip';
import { ACTION_LABEL_BREAKPOINT, getStandardActionButtonSx } from '../components/buttons/segmentedControlStyles';

interface GraphicalWorkspaceActionProps extends Omit<ButtonProps, 'children' | 'sx'> {
  label: string;
  icon: ReactNode;
  help?: string;
  disabledReason?: string;
}

export function GraphicalWorkspaceAction({
  label, icon, help, disabledReason, onClick, ...buttonProps
}: GraphicalWorkspaceActionProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const activated = useRef(false);
  const description = buttonProps.disabled ? disabledReason : help;
  const allowTooltip = () => { activated.current = false; };

  return (
    <AppTooltip
      title={description ? <>{label}<Box>{description}</Box></> : label}
      open={tooltipOpen}
      onOpen={() => { if (!activated.current) setTooltipOpen(true); }}
      onClose={() => setTooltipOpen(false)}
      describeChild
      disableInteractive
      leaveTouchDelay={0}
    >
      <Box component="span" sx={{ display: 'inline-flex' }} onPointerLeave={allowTooltip} onBlur={allowTooltip}>
        <Button
          {...buttonProps}
          aria-label={label}
          onClick={event => {
            activated.current = true;
            setTooltipOpen(false);
            onClick?.(event);
          }}
          sx={theme => ({
            ...getStandardActionButtonSx(true),
            minHeight: 44,
            minWidth: 44,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            '& [data-graphical-action-label]': { display: 'none' },
            '@container workspace-topbar (min-width: 70rem)': {
              [theme.breakpoints.up(ACTION_LABEL_BREAKPOINT)]: {
                px: 1.5,
                gap: 0.75,
                '& [data-graphical-action-label]': { display: 'inline' },
              },
            },
          })}
        >
          {icon}
          <Box component="span" data-graphical-action-label aria-hidden="true">{label}</Box>
        </Button>
      </Box>
    </AppTooltip>
  );
}
