import { cloneElement, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactElement, type SyntheticEvent } from 'react';
import { Tooltip, type TooltipProps } from '@mui/material';
import useEventCallback from '@mui/utils/useEventCallback';
import { useContextMenuOpenSnapshot } from './contextMenu/contextMenuOpenState';
import { claimGridTooltip, dismissGridTooltip, isCurrentGridTooltipRequest, useGridTooltipScope } from './data-grid/gridTooltipState';

const EXPLANATORY_HOVER_DELAY = 600;

type AppTooltipProps = TooltipProps & {
  explanatory?: boolean;
  cellHasFocus?: boolean;
  allowedDuringEdit?: boolean;
  isEligible?: (anchor: HTMLElement) => boolean;
};

export function AppTooltip({ allowedDuringEdit, isEligible, ...props }: AppTooltipProps) {
  const scope = useGridTooltipScope();
  return scope
    ? <GridAppTooltip {...props} scope={scope} allowedDuringEdit={allowedDuringEdit} isEligible={isEligible} />
    : <StandaloneAppTooltip {...props} />;
}

/**
 * The app's tooltip. Use this everywhere instead of MUI's `Tooltip` (enforced
 * by the `no-restricted-imports` rule in eslint.config.js) — it behaves
 * exactly like MUI's, including all delays, but is suppressed while any
 * context menu is open so a tooltip can never cover the menu.
 *
 * Suppression is real, not visual: an open tooltip closes, MUI's hover/focus/
 * touch listeners are disabled, and a tooltip whose enter delay elapses while
 * the menu is open never opens. An uncontrolled tooltip remembers *which*
 * menu generation it was opened in (`openSequence`), so a menu opening
 * invalidates it for good — closing the menu leaves no stale tooltip behind,
 * and the next hover, focus or long press opens one again as usual.
 */
function StandaloneAppTooltip({
  open,
  onOpen,
  onClose,
  disableHoverListener,
  disableFocusListener,
  disableTouchListener,
  explanatory,
  cellHasFocus = false,
  enterDelay,
  enterNextDelay,
  ...props
}: Omit<AppTooltipProps, 'allowedDuringEdit' | 'isEligible'>) {
  const { open: contextMenuOpen, openSequence } = useContextMenuOpenSnapshot();
  const [openedInSequence, setOpenedInSequence] = useState<number | null>(null);

  const uncontrolledOpen = cellHasFocus || openedInSequence === openSequence;
  const effectiveOpen = contextMenuOpen ? false : (open ?? uncontrolledOpen);

  return (
    <Tooltip
      {...props}
      open={effectiveOpen}
      enterDelay={enterDelay ?? (explanatory ? EXPLANATORY_HOVER_DELAY : undefined)}
      enterNextDelay={enterNextDelay ?? (explanatory ? EXPLANATORY_HOVER_DELAY : undefined)}
      onOpen={(event) => {
        if (contextMenuOpen) {
          return;
        }
        setOpenedInSequence(openSequence);
        onOpen?.(event);
      }}
      onClose={(event) => {
        setOpenedInSequence(null);
        onClose?.(event);
      }}
      disableHoverListener={contextMenuOpen || disableHoverListener}
      disableFocusListener={contextMenuOpen || disableFocusListener}
      disableTouchListener={contextMenuOpen || disableTouchListener}
    />
  );
}

function GridAppTooltip({
  scope,
  open,
  onOpen,
  onClose,
  title,
  children,
  explanatory,
  cellHasFocus,
  allowedDuringEdit = false,
  isEligible,
  enterDelay,
  enterNextDelay,
  disableHoverListener,
  disableFocusListener,
  disableTouchListener,
  slotProps,
  ...props
}: AppTooltipProps & { scope: NonNullable<ReturnType<typeof useGridTooltipScope>> }) {
  const id = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const wasControlledOpen = useRef(false);
  const [intent, setIntent] = useState<'idle' | 'pending' | 'open'>('idle');
  const child = children as ReactElement<HTMLAttributes<HTMLElement>>;
  const openFromFocus = cellHasFocus || open === true;

  const request = (anchor: HTMLElement, event?: Event) => (
    (isEligible ? isEligible(anchor) : Boolean(title) || title === 0)
    && claimGridTooltip({ id, scope, anchor, allowedDuringEdit, event, dismiss: () => setIntent('idle') })
  );
  const requestFromFocus = useEventCallback(() => {
    const anchor = anchorRef.current;
    const focused = anchor?.ownerDocument.activeElement;
    if (!anchor || !focused || (scope.isRestoringFocus() && !allowedDuringEdit)) return;
    const cell = anchor.closest('[role="gridcell"], [role="columnheader"]');
    if (focused === cell || anchor.contains(focused)) {
      if ((allowedDuringEdit || focused.matches(':focus-visible')) && request(anchor)) {
        setIntent('open');
      }
    }
  });
  useLayoutEffect(() => {
    if (openFromFocus && !disableFocusListener) requestFromFocus();
  }, [disableFocusListener, openFromFocus, requestFromFocus]);
  useLayoutEffect(() => {
    if (wasControlledOpen.current && open === false) dismissGridTooltip(id);
    wasControlledOpen.current = open === true;
  }, [id, open]);
  useLayoutEffect(() => () => dismissGridTooltip(id), [id]);

  const reserve = (event: SyntheticEvent<HTMLElement>): void => {
    if (request(event.currentTarget, event.nativeEvent)) {
      setIntent(previous => previous === 'idle' ? 'pending' : previous);
    }
  };
  const effectiveOpen = intent !== 'idle' && (open ?? intent === 'open');
  return (
    <Tooltip
      {...props}
      ref={anchorRef}
      title={title}
      open={effectiveOpen}
      enterDelay={enterDelay ?? (explanatory ? EXPLANATORY_HOVER_DELAY : undefined)}
      enterNextDelay={enterNextDelay ?? (explanatory ? EXPLANATORY_HOVER_DELAY : undefined)}
      disableHoverListener={disableHoverListener}
      disableFocusListener={disableFocusListener}
      disableTouchListener={disableTouchListener}
      onOpen={event => {
        if (!isCurrentGridTooltipRequest(id, event.nativeEvent)) return;
        setIntent('open');
        onOpen?.(event);
      }}
      onClose={event => {
        dismissGridTooltip(id);
        onClose?.(event);
      }}
      slotProps={{
        ...slotProps,
        popper: ownerState => {
          const popper = typeof slotProps?.popper === 'function' ? slotProps.popper(ownerState) : slotProps?.popper;
          return {
            ...popper,
            'data-ofp-grid-tooltip': id,
            // MUI leaves the portal mounted while the exit transition runs.
            style: { ...popper?.style, ...(effectiveOpen ? {} : { visibility: 'hidden' }) },
          };
        },
      }}
    >
      {cloneElement(child, {
        // Managed tooltips use the MUI popup and its aria description.
        ...(props.describeChild && { title: undefined }),
        onMouseOver: event => {
          if (!disableHoverListener && !scope.isStationaryHover(event.nativeEvent)) reserve(event);
          child.props.onMouseOver?.(event);
        },
        onMouseLeave: event => {
          if (!effectiveOpen) dismissGridTooltip(id);
          child.props.onMouseLeave?.(event);
        },
        onFocus: event => {
          if (!disableFocusListener && (!scope.isRestoringFocus() || allowedDuringEdit)
            && event.target.matches(':focus-visible')) reserve(event);
          child.props.onFocus?.(event);
        },
        onBlur: event => {
          if (!effectiveOpen) dismissGridTooltip(id);
          child.props.onBlur?.(event);
        },
        onTouchStart: event => {
          if (!disableTouchListener) reserve(event);
          child.props.onTouchStart?.(event);
        },
        onClick: event => {
          // Some controlled previews (for example a carried-over plan's
          // season) deliberately open on a click or touch.
          if (open !== undefined && child.props.onClick) reserve(event);
          child.props.onClick?.(event);
        },
      })}
    </Tooltip>
  );
}
