import { Box, Typography } from '@mui/material';
import { varietySpecificValueHighlightSx } from './varietyValueAccent';

interface VarietyValueLegendProps {
  sampleLabel: string;
  description: string;
}

/**
 * One flowing sentence ("<sample> = description") rather than two flex items,
 * so on narrow screens it wraps word by word instead of dropping the whole
 * description onto a line of its own.
 */
export function VarietyValueLegend({ sampleLabel, description }: VarietyValueLegendProps) {
  return (
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      <Box component="span" sx={varietySpecificValueHighlightSx}>
        {sampleLabel}
      </Box>
      {` = ${description}`}
    </Typography>
  );
}
