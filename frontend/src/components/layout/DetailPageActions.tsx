import { Box, Button, Stack, useMediaQuery, useTheme } from '@mui/material';
import { memo, type MouseEvent, type ReactNode } from 'react';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { ACTION_LABEL_BREAKPOINT, getStandardActionButtonSx } from '../buttons/segmentedControlStyles';
import { AppTooltip } from '../AppTooltip';

export interface DetailPagePrimaryAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  variant?: 'contained' | 'outlined';
}

/**
 * What an action's button says on hover. An icon-only button has to name
 * itself, the same way a disabled one has to explain itself — so below the
 * label breakpoint the label and the (optional) reason are stacked rather than
 * the reason replacing a label that is nowhere on screen.
 */
function buildActionTooltip(action: DetailPagePrimaryAction, iconOnly: boolean): ReactNode {
  if (!iconOnly) {
    return action.tooltip ?? '';
  }
  if (!action.tooltip) {
    return action.label;
  }
  return (
    <>
      <span style={{ display: 'block' }}>{action.label}</span>
      <span style={{ display: 'block', marginTop: 4 }}>{action.tooltip}</span>
    </>
  );
}

interface DetailPageActionsProps {
  primaryActions: DetailPagePrimaryAction[];
  overflowLabel?: string;
  onOpenOverflow?: (event: MouseEvent<HTMLElement>) => void;
  compact?: boolean;
  suppressTooltips?: boolean;
}

export const DetailPageActions = memo(function DetailPageActions({
  primaryActions,
  overflowLabel,
  onOpenOverflow,
  compact = false,
  suppressTooltips = false,
}: DetailPageActionsProps) {
  const theme = useTheme();
  // Decides the tooltip *text* only — never the layout. Whether a label is on
  // screen is settled by the responsive `sx` below (plain CSS), so the header
  // renders at its final size on the first paint instead of reflowing once a
  // media query resolves.
  const labelsCollapsed = useMediaQuery(theme.breakpoints.down(ACTION_LABEL_BREAKPOINT));
  const iconOnly = compact || labelsCollapsed;

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ flexShrink: 0, minWidth: 'auto',
            flexWrap: 'nowrap',
            justifyContent: compact ? 'flex-start' : { xs: 'flex-start', sm: 'flex-end' }, }}
    >
      {primaryActions.map((action) => {
        const button = (
          <Button
            key={action.label}
            variant={action.variant ?? 'outlined'}
            size="medium"
            aria-label={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
            sx={getStandardActionButtonSx(compact, ACTION_LABEL_BREAKPOINT)}
          >
            <Box
              component="span"
              aria-hidden="true"
              sx={{ display: 'inline-flex', mr: compact ? 0 : { xs: 0, [ACTION_LABEL_BREAKPOINT]: 0.75 } }}
            >
              {action.icon}
            </Box>
            <Box
              component="span"
              data-testid="detail-page-action-label"
              sx={{ display: compact ? 'none' : { xs: 'none', [ACTION_LABEL_BREAKPOINT]: 'inline' } }}
            >
              {action.label}
            </Box>
          </Button>
        );

        // The wrapper is rendered unconditionally, with an empty title where
        // there is nothing to say: making it conditional would change the
        // element type at the breakpoint, remounting the Button and dropping
        // keyboard focus on a resize. MUI renders no tooltip for an empty title.
        return (
          <AppTooltip key={action.label} title={buildActionTooltip(action, iconOnly)}
            open={suppressTooltips ? false : undefined}
            disableHoverListener={suppressTooltips} disableFocusListener={suppressTooltips} disableTouchListener={suppressTooltips}>
            <span>{button}</span>
          </AppTooltip>
        );
      })}
      {overflowLabel && onOpenOverflow ? (
        <AppTooltip title={overflowLabel} open={suppressTooltips ? false : undefined}
          disableHoverListener={suppressTooltips} disableFocusListener={suppressTooltips} disableTouchListener={suppressTooltips}>
          <Button
            aria-label={overflowLabel}
            onClick={onOpenOverflow}
            variant="outlined"
            size="medium"
            sx={{
              alignSelf: 'center',
              minHeight: 40,
              minWidth: compact ? 40 : { xs: 40, [ACTION_LABEL_BREAKPOINT]: 48 },
              px: compact ? 0.75 : { xs: 0.75, [ACTION_LABEL_BREAKPOINT]: 1.25 },
              width: 'auto',
            }}
          >
            <MoreVertIcon fontSize="small" />
          </Button>
        </AppTooltip>
      ) : null}
    </Stack>
  );
});
