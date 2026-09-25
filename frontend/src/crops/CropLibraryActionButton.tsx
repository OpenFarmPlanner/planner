import { Box, Button, Chip, CircularProgress } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import SyncDisabledOutlinedIcon from '@mui/icons-material/SyncDisabledOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import { useTranslation } from '../i18n';
import { AppTooltip } from '../components/AppTooltip';
import type { Crop } from '../api/types';
import type { PublicCropUpdateController } from './usePublicCropUpdate';
import { resolveCropLibraryAction, type CropLibraryActionKind } from './cropLibraryAction';

function chipIcon(kind: CropLibraryActionKind) {
  if (kind === 'updateRejected') return <SyncDisabledOutlinedIcon fontSize="small" />;
  if (kind === 'proposalPending') return <ScheduleOutlinedIcon fontSize="small" />;
  return <SyncOutlinedIcon fontSize="small" />;
}

interface CropLibraryActionButtonProps {
  crop: Crop;
  controller: PublicCropUpdateController;
  /** Opens the publishing wizard (also the entry point for updating an owned entry). */
  onPublish: () => void;
  /** True while a publish/push request the wizard started is in flight. */
  isPublishing: boolean;
}

/**
 * The permanent public-library control in the crop detail badge row. See
 * `resolveCropLibraryAction`: the states with work to do render a button
 * (publish / pull / push), while "nothing to do" and "update declined" render
 * a status chip instead — the declined one clickable, so the diff behind the
 * decision stays reachable without offering an action that is no longer due.
 * Every state carries a tooltip, shown on hover and on keyboard focus.
 */
export function CropLibraryActionButton({
  crop,
  controller,
  onPublish,
  isPublishing,
}: CropLibraryActionButtonProps) {
  const { t } = useTranslation('crops');
  const action = resolveCropLibraryAction(crop, controller);
  const label = t(`library.${action.labelKey}`);
  const tooltip = action.tooltipKey ? t(`library.${action.tooltipKey}`) : '';

  const handleClick = () => {
    if (action.trigger === 'publish') {
      onPublish();
    } else if (action.trigger === 'diff' && !controller.isLoading) {
      controller.openDiff();
    }
  };

  if (action.variant === 'chip') {
    // Whether the chip is interactive must not depend on `isLoading`: the two
    // branches below differ structurally, so flipping it mid-click would
    // remount the chip the user just activated and drop keyboard focus (and
    // leave the tooltip open, since the unmounted chip never fires its
    // mouse-leave). The in-flight request is handled inside `handleClick`
    // instead, and shows as a spinner in the chip's icon slot.
    const interactive = action.trigger !== null && !action.disabled;
    const chip = (
      <Chip
        size="small"
        variant="outlined"
        color={action.color}
        disabled={action.disabled}
        icon={controller.isLoading && interactive
          ? <CircularProgress size={14} color="inherit" />
          : chipIcon(action.kind)}
        label={label}
        onClick={interactive ? handleClick : undefined}
        data-testid="crop-detail-library-status"
        data-action-kind={action.kind}
        // A chip is the smallest control in the badge row; the interactive one
        // gets a touch-sized target rather than the 24px default.
        sx={interactive ? { minHeight: 32 } : undefined}
      />
    );

    // A clickable chip is a focusable button itself; an inert one needs the
    // focusable wrapper so its tooltip is reachable by keyboard.
    return interactive ? (
      <AppTooltip title={tooltip} describeChild>{chip}</AppTooltip>
    ) : (
      <AppTooltip title={tooltip}>
        <Box component="span" tabIndex={0} aria-label={tooltip} sx={{ display: 'inline-flex' }}>
          {chip}
        </Box>
      </AppTooltip>
    );
  }

  const loading = action.trigger === 'diff' ? controller.isLoading : isPublishing;
  // Direction of the sync: down = pull from the library, up = publish/push to it.
  const Icon = action.kind === 'pullUpdate' ? ArrowDownwardIcon : ArrowUpwardIcon;

  const button = (
    <Button
      size="small"
      variant="outlined"
      color={action.color === 'default' ? 'inherit' : action.color}
      data-testid="crop-detail-publish-action"
      data-action-kind={action.kind}
      startIcon={loading
        ? <CircularProgress size={14} color="inherit" />
        : <Icon fontSize="small" />}
      disabled={action.disabled || loading}
      onClick={handleClick}
      // Compact next to the header's "Bearbeiten" / "Anbauplan hinzufügen":
      // the theme's default 24px side padding is too wide here, so tighten the
      // sides to one 8px step and drop the label a touch. Height is unchanged.
      // 1 line at its natural width where there is room; wraps (never overflows)
      // when the badge row gets too narrow for the long German labels.
      sx={{
        px: 1,
        py: 0.25,
        fontSize: '0.75rem',
        flexShrink: 0,
        maxWidth: '100%',
        whiteSpace: 'normal',
        lineHeight: 1.25,
      }}
    >
      {label}
    </Button>
  );

  // A disabled <button> is not focusable, so its tooltip hangs off a focusable
  // wrapper that also carries it as an accessible name (hover + keyboard). An
  // enabled button is focusable itself and needs no extra wrapper.
  //
  // `describeChild` keeps the button's visible label as its accessible name;
  // without it MUI turns the tooltip text into an `aria-label` that shadows the
  // label. The tooltip stays available as an `aria-describedby` description.
  if (action.disabled) {
    return (
      <AppTooltip title={tooltip}>
        <Box
          component="span"
          tabIndex={0}
          aria-label={tooltip}
          sx={{
            display: 'inline-flex',
            flexShrink: 0,
            maxWidth: '100%',
            borderRadius: 1,
            '&:focus-visible': { outline: (theme) => `2px solid ${theme.palette.primary.main}` },
          }}
        >
          {button}
        </Box>
      </AppTooltip>
    );
  }

  return <AppTooltip title={tooltip} describeChild>{button}</AppTooltip>;
}
