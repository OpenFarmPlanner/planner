import type { ReactNode } from 'react';
import {
  ListItemIcon,
  ListItemText,
  MenuItem,
  Typography,
  type MenuItemProps,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type ContextMenuActionColor = 'error' | 'primary';

interface ContextMenuActionItemProps extends Omit<MenuItemProps, 'children'> {
  label: ReactNode;
  icon?: ReactNode;
  color?: ContextMenuActionColor;
  emphasized?: boolean;
  shortcutHint?: ReactNode;
  disabledReason?: string;
  renderPlainWhenUnadorned?: boolean;
}

function mergeSx(
  base: SxProps<Theme> | undefined,
  sx: SxProps<Theme> | undefined,
): SxProps<Theme> | undefined {
  if (!base) {
    return sx;
  }

  if (!sx) {
    return base;
  }

  return (Array.isArray(sx) ? [base, ...sx] : [base, sx]) as SxProps<Theme>;
}

export function ContextMenuActionItem({
  label,
  icon,
  color,
  emphasized = false,
  shortcutHint,
  disabledReason,
  renderPlainWhenUnadorned = false,
  sx,
  ...menuItemProps
}: ContextMenuActionItemProps) {
  const resolvedColor = color === 'error'
    ? 'error.main'
    : color === 'primary'
      ? 'primary.main'
      : undefined;
  const shouldRenderPlain = renderPlainWhenUnadorned && !icon && !shortcutHint && !emphasized && !disabledReason;

  if (shouldRenderPlain) {
    return (
      <MenuItem
        {...menuItemProps}
        sx={mergeSx(resolvedColor ? { color: resolvedColor } : undefined, sx)}
      >
        {label}
      </MenuItem>
    );
  }

  return (
    <MenuItem
      {...menuItemProps}
      aria-label={typeof label === 'string' && disabledReason ? label : menuItemProps['aria-label']}
      aria-description={disabledReason ?? menuItemProps['aria-description']}
      sx={mergeSx(resolvedColor ? { color: resolvedColor } : undefined, sx)}
    >
      {icon ? (
        <ListItemIcon sx={resolvedColor ? { color: resolvedColor } : undefined}>
          {icon}
        </ListItemIcon>
      ) : null}
      <ListItemText
        primary={label}
        secondary={disabledReason}
        slotProps={{
          primary: {
            sx: {
              color: resolvedColor,
              fontWeight: emphasized ? 600 : undefined,
            },
          },
        }}
      />
      {shortcutHint ? (
        <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto', pl: 3 }}>
          {shortcutHint}
        </Typography>
      ) : null}
    </MenuItem>
  );
}
