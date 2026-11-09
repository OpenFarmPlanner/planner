import type { ReactElement, ReactNode } from 'react';
import Box from '@mui/material/Box';
import { MOBILE_INSET_SX, PAGE_CONTAINER_SX, type PageContainerVariant } from './pageContainerStyles';

export type { PageContainerVariant };

interface PageContainerProps {
  children: ReactNode;
  variant?: PageContainerVariant;
  /** Adds a 16px horizontal inset below `sm` instead of running edge to edge. */
  mobileInset?: boolean;
}

function PageContainer({
  children,
  variant = 'standard',
  mobileInset = false,
}: PageContainerProps): ReactElement {
  return (
    <Box sx={mobileInset ? [PAGE_CONTAINER_SX[variant], MOBILE_INSET_SX] : PAGE_CONTAINER_SX[variant]}>
      {children}
    </Box>
  );
}

export default PageContainer;
