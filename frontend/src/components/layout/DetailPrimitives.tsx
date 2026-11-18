import type { ReactNode } from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { varietySpecificValueHighlightSx } from '../../crops/varietyValueAccent';

export interface DetailRowProps {
  label: string;
  value: string;
  source?: 'fromCrop' | 'ownValue' | null;
  /** Secondary line under the value, e.g. where an inherited value comes from. */
  caption?: string | null;
  testId?: string;
}

/** Label/value pair of a detail section (crop library, growing-area details). */
export function DetailRow({ label, value, source = null, caption = null, testId }: DetailRowProps) {
  const ownValueSx = source === 'ownValue' ? varietySpecificValueHighlightSx : undefined;

  return (
    <Box data-testid={testId}>
      <Typography variant="body2" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={[{ overflowWrap: 'anywhere' }, ...(ownValueSx ? [ownValueSx] : [])]}>
        {value}
      </Typography>
      {caption ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {caption}
        </Typography>
      ) : null}
    </Box>
  );
}

export interface DetailSectionProps {
  title: string;
  children: ReactNode;
  outlined?: boolean;
  showHeaderDivider?: boolean;
}

export function DetailSection({ title, children, outlined = false, showHeaderDivider = false }: DetailSectionProps) {
  const titleElement = (
    <Typography variant="h6" gutterBottom={!showHeaderDivider}>
      {title}
    </Typography>
  );

  return (
    <Box sx={outlined ? { p: { xs: 1.25, sm: 2 }, border: '1px solid', borderColor: 'divider', borderRadius: 2 } : undefined}>
      {showHeaderDivider ? (
        <Stack spacing={2}>
          <Box>
            {titleElement}
            <Divider />
          </Box>
          <Box>{children}</Box>
        </Stack>
      ) : (
        <>
          {titleElement}
          {children}
        </>
      )}
    </Box>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
      {children}
    </Box>
  );
}
