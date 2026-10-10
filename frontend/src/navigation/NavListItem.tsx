/**
 * Shared rendering for a single sidebar/drawer navigation entry.
 *
 * Centralizes the disabled-during-onboarding behavior (no active project yet)
 * so it is implemented once and applied consistently everywhere navigation
 * items are rendered, rather than special-cased per route or per render site:
 *   - renders as a non-navigating element (no `to`/`href` at all, so no click
 *     or keyboard activation can trigger navigation — relying on `disabled`
 *     alone is not enough, since a React Router `<Link>` attaches its own
 *     click handler independent of MUI's disabled styling);
 *   - exposes `aria-disabled` via MUI's built-in disabled handling for a
 *     non-native-button root (role="button", aria-disabled, tabIndex=-1);
 *   - shows an explanatory tooltip on hover/focus even though the control
 *     itself no longer receives pointer events once disabled (wrapped in a
 *     `<span>` per MUI's documented pattern for disabled Tooltip children).
 */

import { ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type React from 'react';
import type { ComponentProps } from 'react';
import { Link as RouterLink } from 'react-router';
import { AppTooltip } from '../components/AppTooltip';

type ListItemTextPrimaryProps = NonNullable<ComponentProps<typeof ListItemText>['slotProps']>['primary'];

export interface NavListItemProps {
  to: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  disabled: boolean;
  disabledTooltip: string;
  itemSx: SxProps<Theme>;
  iconSx: SxProps<Theme>;
  /** Present only when the label text is rendered alongside the icon. */
  textProps?: ListItemTextPrimaryProps;
  /** Tooltip shown when NOT disabled, e.g. the label in a collapsed sidebar. */
  enabledTooltip?: string;
  enabledTooltipPlacement?: 'right' | 'top' | 'bottom' | 'left';
  onNavigate?: () => void;
}

export default function NavListItem({
  to,
  label,
  icon,
  isActive,
  disabled,
  disabledTooltip,
  itemSx,
  iconSx,
  textProps,
  enabledTooltip,
  enabledTooltipPlacement = 'right',
  onNavigate,
}: NavListItemProps): React.ReactElement {
  const button = (
    <ListItemButton
      component={disabled ? 'div' : (RouterLink as React.ElementType)}
      {...(disabled ? {} : { to })}
      disabled={disabled}
      selected={isActive}
      onClick={disabled ? undefined : onNavigate}
      sx={itemSx}
    >
      <ListItemIcon sx={iconSx}>{icon}</ListItemIcon>
      {textProps ? <ListItemText primary={label} slotProps={{
        primary: textProps
      }} /> : null}
    </ListItemButton>
  );

  if (disabled) {
    return (
      // `width: fit-content` shrink-wraps the span to the button's actual
      // rendered size (plain `block` would stretch it to the full-width list
      // row, anchoring the tooltip far to the right of the icon/label instead
      // of right next to them) while keeping `display: block` so the item
      // still starts its own line — `inline-block` would let short-labeled
      // items (e.g. "Fields", "Crops") sit side by side instead of stacking
      // like the enabled items do.
      <AppTooltip title={disabledTooltip} placement={enabledTooltipPlacement}>
        <span style={{ display: 'block', width: 'fit-content' }}>{button}</span>
      </AppTooltip>
    );
  }

  if (enabledTooltip) {
    return (
      <AppTooltip title={enabledTooltip} placement={enabledTooltipPlacement}>
        {button}
      </AppTooltip>
    );
  }

  return button;
}
