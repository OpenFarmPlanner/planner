import { Box, Link, Stack, Typography } from '@mui/material';
import type { PlantHealthSource } from './types';

export function SourceLinks({ sources }: { sources: PlantHealthSource[] }) {
  return <Stack spacing={0.5}>{sources.map((source, index) => <Box key={index}>
    <Link href={source.url} target="_blank" rel="noopener noreferrer" sx={{ overflowWrap: 'anywhere' }}>{source.title || source.url}</Link>
    {source.evidence ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.evidence}</Typography> : null}
  </Box>)}</Stack>;
}
