import type { ReactElement, ReactNode } from 'react';
import { Box, Paper } from '@mui/material';

export type TableSizingMode = 'compact' | 'contentFit' | 'fullWorkspace';

interface TableSurfaceProps {
  sizingMode: TableSizingMode;
  children: ReactNode;
}

const shellByMode: Record<TableSizingMode, Record<string, unknown>> = {
  compact: { width: '100%', display: 'flex', justifyContent: 'center', overflowX: 'auto' },
  contentFit: { width: '100%', display: 'flex', justifyContent: 'center', overflowX: 'auto' },
  fullWorkspace: { width: '100%', display: 'block', overflowX: 'auto' },
};

const paperByMode: Record<TableSizingMode, Record<string, unknown>> = {
  compact: { width: 'fit-content', maxWidth: '100%' },
  contentFit: { width: 'fit-content', maxWidth: '100%' },
  fullWorkspace: { width: '100%', maxWidth: '100%' },
};

const innerByMode: Record<TableSizingMode, Record<string, unknown>> = {
  compact: { display: 'block', width: 'fit-content', minWidth: 0, maxWidth: '100%' },
  contentFit: { display: 'block', width: 'fit-content', minWidth: 0, maxWidth: '100%' },
  fullWorkspace: { display: 'block', width: '100%', minWidth: 0, maxWidth: '100%' },
};

export default function TableSurface({ sizingMode, children }: TableSurfaceProps): ReactElement {
  return (
    <Box sx={shellByMode[sizingMode]}>
      <Paper
        variant="outlined"
        sx={{
          ...paperByMode[sizingMode],
          borderRadius: 2,
          boxShadow: 1,
          '& .MuiTableContainer-root': { width: 'fit-content', maxWidth: '100%' },
          '& .MuiTable-root': { width: 'auto' },
          '& .MuiTableCell-head': { fontWeight: 600 },
        }}
      >
        <Box sx={innerByMode[sizingMode]}>
          {children}
        </Box>
      </Paper>
    </Box>
  );
}
