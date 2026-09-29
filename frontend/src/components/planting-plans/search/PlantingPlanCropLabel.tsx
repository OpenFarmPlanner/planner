import { Box, Chip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

import { useTranslation } from '../../../i18n';
import { SearchHighlightedText } from '../../../search/SearchHighlightedText';
import { TruncatedTextWithTooltip } from '../../TruncatedTextWithTooltip';
import { usePlantingPlanSearchMatch } from './plantingPlanSearchMatchContext';

interface PlantingPlanCropLabelProps {
  planId: number;
  text: string;
  /** Grid cells truncate the name; cards let it wrap. */
  truncate?: boolean;
}

const synonymUnderlineSx = {
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationColor: (theme: Theme) => theme.palette.searchHighlight.underline,
  textDecorationThickness: 2,
  textUnderlineOffset: 3,
} as const;

const synonymChipSx: SxProps<Theme> = {
  flexShrink: 0,
  height: 20,
  bgcolor: 'searchHighlight.background',
  color: 'text.primary',
  fontWeight: 400,
  '& .MuiChip-label': { px: 0.75 },
};

/**
 * The crop name of a plan with its search marks. When the plan matched only
 * through a species synonym, the name gets a dotted yellow underline and a
 * small "Synonym: …" hint, so the hit is never unexplained.
 */
export function PlantingPlanCropLabel({ planId, text, truncate = false }: PlantingPlanCropLabelProps) {
  const { t } = useTranslation('plantingPlans');
  const synonym = usePlantingPlanSearchMatch(planId)?.synonym ?? null;
  const nameSx = synonym ? synonymUnderlineSx : undefined;
  const name = truncate ? (
    <TruncatedTextWithTooltip text={text} sx={{ flex: '0 1 auto', ...nameSx }}>
      <SearchHighlightedText text={text} />
    </TruncatedTextWithTooltip>
  ) : (
    <Box component="span" sx={nameSx}>
      <SearchHighlightedText text={text} />
    </Box>
  );

  if (!synonym) {
    return name;
  }

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        minWidth: 0,
        maxWidth: '100%',
        flexWrap: truncate ? 'nowrap' : 'wrap',
      }}
    >
      {name}
      <Chip size="small" label={t('search.synonymHint', { name: synonym })} sx={synonymChipSx} />
    </Box>
  );
}
