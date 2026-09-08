import type { ReactElement, ReactNode } from 'react';
import { Box } from '@mui/material';

import { AppTooltip } from './AppTooltip';

interface DisabledActionTooltipProps {
  children: ReactElement;
  title: ReactNode;
}

/** Keeps explanatory tooltips reachable when a disabled control swallows events. */
export function DisabledActionTooltip({ children, title }: DisabledActionTooltipProps) {
  return (
    <AppTooltip title={title} describeChild>
      <Box component="span" sx={{ display: 'inline-flex' }}>
        {children}
      </Box>
    </AppTooltip>
  );
}
