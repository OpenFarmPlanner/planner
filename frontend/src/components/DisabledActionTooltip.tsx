import type { ReactElement, ReactNode } from 'react';
import { Box } from '@mui/material';

import { AppTooltip } from './AppTooltip';

interface DisabledActionTooltipProps {
  children: ReactElement;
  title: ReactNode;
  fullWidth?: boolean;
}

/** Keeps explanatory tooltips reachable when a disabled control swallows events. */
export function DisabledActionTooltip({ children, title, fullWidth = false }: DisabledActionTooltipProps) {
  return (
    <AppTooltip title={title} describeChild>
      <Box component="span" sx={{ display: 'inline-flex', width: fullWidth ? '100%' : undefined }}>
        {children}
      </Box>
    </AppTooltip>
  );
}

/** Block wrapper for disabled menu items, which do not emit hover events. */
export function DisabledMenuItemTooltip({ children, title }: DisabledActionTooltipProps) {
  return (
    <AppTooltip title={title} describeChild>
      <Box component="span" sx={{ display: 'block' }}>
        {children}
      </Box>
    </AppTooltip>
  );
}
