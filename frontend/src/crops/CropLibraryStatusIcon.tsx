import { Box, IconButton } from '@mui/material';
import { alpha, darken, type Theme } from '@mui/material/styles';
import type { SxProps } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CheckIcon from '@mui/icons-material/Check';
import SyncDisabledOutlinedIcon from '@mui/icons-material/SyncDisabledOutlined';
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import { useTranslation } from '../i18n';
import { AppTooltip } from '../components/AppTooltip';
import type { Crop } from '../api/types';
import {
  resolveCropLibraryAction,
  resolveCropLibraryStatusVisual,
  type CropLibraryStatusVisual,
  type CropLibraryTrigger,
} from './cropLibraryAction';
import { CROP_LIBRARY_STATUS_ICON_SLOT } from './cropHierarchyRowSx';

const CIRCLE_SIZE = 18;

const GLYPHS: Record<CropLibraryStatusVisual, SvgIconComponent | null> = {
  notLinked: null,
  upToDate: CheckIcon,
  push: ArrowUpwardIcon,
  pull: ArrowDownwardIcon,
  rejected: SyncDisabledOutlinedIcon,
  unavailable: LinkOffOutlinedIcon,
  pending: ScheduleOutlinedIcon,
};

function statusColor(theme: Theme, visual: CropLibraryStatusVisual): string {
  switch (visual) {
    case 'upToDate':
      return theme.palette.success.main;
    case 'push':
      return theme.palette.warning.main;
    case 'pull':
      return theme.palette.info.main;
    case 'pending':
      // Yellowish brown: kept apart from the orange push state.
      return darken(theme.palette.warning.light, 0.4);
    case 'rejected':
    case 'unavailable':
    case 'notLinked':
      return theme.palette.text.disabled;
  }
}

function circleSx(visual: CropLibraryStatusVisual): SxProps<Theme> {
  return (theme: Theme) => {
    const color = statusColor(theme, visual);
    return {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: '50%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      boxSizing: 'border-box',
      color,
      ...(visual === 'notLinked'
        ? { border: `1.5px dashed ${color}` }
        // "Aktuell" is the resting state of most synced rows, so it shows the
        // check without a filled circle to keep the list quiet.
        : { bgcolor: visual === 'upToDate' ? 'transparent' : alpha(color, 0.14) }),
    };
  };
}

interface CropLibraryStatusIconProps {
  crop: Crop;
  /** Opens the same dialog the detail badge row's button would for this crop. */
  onActivate: (trigger: CropLibraryTrigger) => void;
}

/**
 * Compact per-row form of `CropLibraryActionButton` for the crop list. Same
 * state resolution (`resolveCropLibraryAction`), same tooltips and the same
 * dialog targets; only the presentation is an 18px status circle.
 */
export function CropLibraryStatusIcon({ crop, onActivate }: CropLibraryStatusIconProps) {
  const { t } = useTranslation('crops');
  const action = resolveCropLibraryAction(crop);
  const visual = resolveCropLibraryStatusVisual(action);
  const label = t(`library.${action.labelKey}`);
  const tooltip = action.tooltipKey ? t(`library.${action.tooltipKey}`) : label;
  const Glyph = GLYPHS[visual];
  const circle = (
    <Box component="span" sx={circleSx(visual)}>
      {Glyph ? <Glyph sx={{ fontSize: 12 }} /> : null}
    </Box>
  );
  const dataProps = {
    'data-testid': 'crop-list-library-status',
    'data-status': visual,
    'data-action-kind': action.kind,
  };

  const { trigger } = action;
  if (trigger === null || action.disabled) {
    // Inert states still explain themselves. The frozen (moderation) state is
    // keyboard-focusable like the detail button's disabled wrapper; "Aktuell"
    // stays out of the tab order so synced rows add no extra tab stops.
    return (
      <AppTooltip title={tooltip}>
        <Box
          component="span"
          role="img"
          aria-label={tooltip}
          aria-disabled={action.disabled || undefined}
          tabIndex={action.disabled ? 0 : undefined}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          {...dataProps}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: CROP_LIBRARY_STATUS_ICON_SLOT,
            height: CROP_LIBRARY_STATUS_ICON_SLOT,
            flexShrink: 0,
            borderRadius: 1,
            '&:focus-visible': { outline: (theme) => `2px solid ${theme.palette.primary.main}` },
          }}
        >
          {circle}
        </Box>
      </AppTooltip>
    );
  }

  return (
    // Named by the tooltip, not the short label: the detail badge row already
    // has a button with that label for the selected crop.
    <AppTooltip title={tooltip}>
      <IconButton
        size="small"
        aria-label={tooltip}
        {...dataProps}
        // Keeps focus on the row instead of moving it to the icon on click,
        // like the row's chevron.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onActivate(trigger);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        sx={{
          width: CROP_LIBRARY_STATUS_ICON_SLOT,
          height: CROP_LIBRARY_STATUS_ICON_SLOT,
          minWidth: CROP_LIBRARY_STATUS_ICON_SLOT,
          p: 0,
          flexShrink: 0,
        }}
      >
        {circle}
      </IconButton>
    </AppTooltip>
  );
}
